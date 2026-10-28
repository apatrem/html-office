// XLSX import dialog (T15), part of the import chunk. The workbook is read in
// a worker (xlsx-reader.mjs); the person chooses the sheets, sees their first
// rows and everything Data will not keep, then imports them as one step.
import { readXLSX } from "./xlsx-reader.mjs";
import { mapWorkbook, importable, differences } from "../model/xlsx.mjs";
import { columnFingerprints, fileDigest } from "../model/source-digest.mjs";
import { address } from "../model/csv.mjs";

const PREVIEW_ROWS = 20,
  PREVIEW_COLUMNS = 30;
const plural = (n, one, many) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
function select(h, id, choices, value) {
  const s = h("select", { id });
  for (const [v, label] of choices) {
    const o = h("option", { value: v }, label);
    o.selected = v === value;
    s.append(o);
  }
  return s;
}
// The source description of one imported sheet.
export async function xlsxSource(file, sha256, sheet, original) {
  const ref = `A1:${address(sheet.height, sheet.width)}`,
    digests = await columnFingerprints(sheet.cells, ref);
  return {
    ref,
    kind: "xlsx",
    file: {
      name: file.name.slice(0, 255),
      bytes: file.size,
      ...(file.lastModified
        ? { modified: new Date(file.lastModified).toISOString() }
        : {}),
      sha256,
    },
    importedAt: new Date().toISOString(),
    options: { sheet: original, header: sheet.header },
    columns: sheet.columns.map((column, c) => ({
      name: column.name.slice(0, 255),
      type: "auto",
      fingerprint: digests[c],
    })),
  };
}

export async function openXLSXImport({ file, book, deps, onImport }) {
  const { h, modal, field, display } = deps;
  const summary = h(
      "p",
      { class: "imp-summary", id: "import-summary", role: "status" },
      `Reading ${file.name}…`,
    ),
    header = select(
      h,
      "import-header",
      [
        ["auto", "Automatic"],
        ["yes", "Column names"],
        ["no", "Data"],
      ],
      "auto",
    ),
    shown = h("select", { id: "import-show" }),
    sheetList = h("div", { class: "imp-preview", id: "import-sheets" }),
    alerts = h("ul", {
      class: "imp-alerts",
      id: "import-alerts",
      role: "alert",
    }),
    preview = h("div", { class: "imp-preview", id: "import-preview" }),
    notes = h("ul", { class: "imp-notes", id: "import-notes" }),
    apply = h(
      "button",
      {
        type: "button",
        class: "sh-b sh-t sh-primary",
        id: "import-apply",
        disabled: true,
      },
      "Import",
    ),
    cancel = h(
      "button",
      { type: "button", class: "sh-b sh-t", id: "import-cancel" },
      "Cancel",
    );
  const dialog = modal(
    `Import ${file.name}`,
    h(
      "div",
      { class: "imp-body" },
      summary,
      h(
        "div",
        { class: "imp-options" },
        field("First row", header),
        field("Preview sheet", shown),
      ),
      sheetList,
      alerts,
      preview,
      notes,
    ),
    [apply, cancel],
  );
  dialog.classList.add("imp-dialog");
  for (const control of [header, shown]) control.disabled = true;
  // Reading stops when the dialog closes; the import, once running, too.
  const reading = new AbortController();
  let committing = null;
  dialog.addEventListener("close", () => {
    reading.abort();
    if (!committing) return;
    committing.cancelled = true;
    deps.cancel?.();
  });
  cancel.onclick = () => dialog.close();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let workbook;
  try {
    workbook = await readXLSX(bytes, {
      name: file.name,
      signal: reading.signal,
    });
  } catch (error) {
    if (reading.signal.aborted) return dialog;
    summary.textContent = `${file.name} cannot be imported: ${error.message.replace(`${file.name} cannot be read: `, "")}`;
    return dialog;
  }
  if (!dialog.open) return dialog;
  const usable = workbook.sheets
    .map((s, i) => [s, i])
    .filter(([s]) => importable(s));
  if (!usable.length) {
    summary.textContent = `${file.name} has no worksheet with data to import.`;
    return dialog;
  }
  // Visible sheets are chosen by default; hidden ones can be added.
  const chosen = new Set(usable.filter(([s]) => !s.hidden).map(([, i]) => i));
  if (!chosen.size) chosen.add(usable[0][1]);
  let result = null,
    showing = usable.find(([, i]) => chosen.has(i))[1];
  for (const [s, i] of usable)
    shown.append(h("option", { value: String(i) }, s.name));
  shown.value = String(showing);
  for (const control of [header, shown]) control.disabled = false;
  const cellCount = usable.reduce((n, [s]) => n + s.cells.length, 0);
  summary.textContent = `${plural(usable.length, "worksheet", "worksheets")} with data · ${plural(cellCount, "cell", "cells")}. Choose the sheets to import; each becomes a sheet in Raw Data.`;

  function draw() {
    if (committing) return;
    alerts.replaceChildren();
    notes.replaceChildren();
    const order = [...chosen].sort((a, b) => a - b);
    result = order.length
      ? mapWorkbook(workbook, {
          chosen: order,
          header: header.value === "auto" ? "auto" : header.value === "yes",
          book,
        })
      : null;
    sheetList.replaceChildren(sheetsTable());
    if (!result) {
      alerts.append(h("li", {}, "Choose at least one sheet to import."));
      preview.replaceChildren();
      apply.disabled = true;
      return;
    }
    for (const text of result.diagnostics) notes.append(h("li", {}, text));
    preview.replaceChildren(table());
    apply.disabled = false;
  }
  function sheetsTable() {
    const t = h(
        "table",
        { "aria-label": "Sheets in the file" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ...["Import", "Sheet", "Imported as", "Size", "Formulas"].map(
              (label) => h("th", { scope: "col" }, label),
            ),
          ),
        ),
      ),
      body = h("tbody");
    for (const [s, i] of usable) {
      const box = h("input", {
          type: "checkbox",
          id: `import-sheet-${i}`,
          "aria-label": `Import sheet "${s.name}"`,
        }),
        mapped = result?.sheets.find((m) => m.index === i),
        formulas = s.cells.filter((c) => c[4]).length,
        kept = mapped
          ? Object.values(mapped.kept).reduce((a, b) => a + b, 0)
          : 0;
      box.checked = chosen.has(i);
      box.onchange = () => {
        if (box.checked) chosen.add(i);
        else chosen.delete(i);
        if (box.checked) {
          showing = i;
          shown.value = String(i);
        }
        draw();
        document.getElementById(`import-sheet-${i}`)?.focus();
      };
      body.append(
        h(
          "tr",
          { "data-sheet": s.name },
          h("td", {}, box),
          h(
            "th",
            { scope: "row" },
            s.name,
            s.hidden ? h("small", {}, " · hidden") : null,
          ),
          h("td", {}, mapped ? mapped.name : "—"),
          h(
            "td",
            {},
            `${plural(s.height, "row", "rows")} × ${plural(s.width, "column", "columns")}`,
          ),
          h(
            "td",
            {},
            formulas
              ? `${formulas.toLocaleString("en-US")}${kept ? ` (${kept.toLocaleString("en-US")} kept as values)` : ""}`
              : "—",
          ),
        ),
      );
    }
    t.append(body);
    return t;
  }
  // The first rows and columns of one sheet as they will be stored; formula
  // cells show the value the file saved and their formula on hover.
  function table() {
    const index = Number(shown.value),
      sheet = workbook.sheets[index],
      mapped =
        result.sheets.find((m) => m.index === index) ??
        mapWorkbook(workbook, {
          chosen: [index],
          header: header.value === "auto" ? "auto" : header.value === "yes",
          book,
        }).sheets[0],
      rows = Math.min(sheet.height, PREVIEW_ROWS),
      columns = Math.min(sheet.width, PREVIEW_COLUMNS),
      t = h("table", { "aria-label": `Preview of ${sheet.name}` }),
      head = h("tr", {}, h("th", {}, ""));
    for (let c = 1; c <= columns; c++)
      head.append(h("th", { scope: "col" }, address(1, c).replace(/\d+$/, "")));
    t.append(h("thead", {}, head));
    const body = h("tbody");
    for (let r = 1; r <= rows; r++) {
      const tr = h("tr", {}, h("th", { scope: "row" }, String(r)));
      for (let c = 1; c <= columns; c++) {
        const cell = mapped.cells[address(r, c)],
          td = h("td");
        if (cell) {
          const value = cell.input ?? cell.result;
          td.textContent = value
            ? display(
                cell.formula ? { ...cell, input: cell.result } : cell,
                book.locale,
              )
            : "";
          if (value) td.dataset.type = value.type;
          if (cell.cellStyle === "header") td.className = "imp-header";
          if (cell.formula) {
            td.classList.add("imp-formula");
            td.title = cell.formula;
          }
        }
        tr.append(td);
      }
      body.append(tr);
    }
    t.append(body);
    const more = [];
    if (sheet.height > rows)
      more.push(`${plural(sheet.height - rows, "more row", "more rows")}`);
    if (sheet.width > columns)
      more.push(
        `${plural(sheet.width - columns, "more column", "more columns")}`,
      );
    return h(
      "div",
      {},
      t,
      more.length
        ? h("p", { class: "imp-more" }, `${more.join(" and ")} not shown.`)
        : null,
    );
  }
  header.onchange = draw;
  shown.onchange = () => {
    showing = Number(shown.value);
    draw();
  };
  const controls = () => [
    header,
    shown,
    apply,
    ...sheetList.querySelectorAll("input"),
  ];
  apply.onclick = async () => {
    if (!result || committing) return;
    const chosenResult = result,
      run = (committing = { cancelled: false });
    for (const control of controls()) control.disabled = true;
    try {
      const sha256 = await fileDigest(bytes),
        sheets = [];
      for (const sheet of chosenResult.sheets)
        sheets.push({
          name: sheet.name,
          cells: sheet.cells,
          height: sheet.height,
          width: sheet.width,
          source: await xlsxSource(file, sha256, sheet, sheet.original),
        });
      if (run.cancelled) return;
      const done = await onImport({
        sheets,
        names: chosenResult.names,
        file: file.name,
        diagnostics: chosenResult.diagnostics,
        check: differences,
      });
      if (done) dialog.close();
    } catch (error) {
      alerts.replaceChildren(h("li", {}, error.message));
    } finally {
      committing = null;
      if (dialog.open) {
        for (const control of controls()) control.disabled = false;
        apply.disabled = !result;
      }
    }
  };
  draw();
  return dialog;
}
