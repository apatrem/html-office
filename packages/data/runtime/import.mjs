// CSV import dialog (T15). This module is a separate chunk, embedded as inert
// text (script#import-source) and loaded only when the person imports a file.
// The file is read in this page; nothing is sent anywhere. Shell components
// come from the main bundle (deps), so popovers and dialogs share one layer.
import {
  readCSV,
  ENCODINGS,
  DELIMITERS,
  COLUMN_TYPES,
  CSV_LIMITS,
} from "../model/csv.mjs";
import { columnFingerprints, fileDigest } from "../model/source-digest.mjs";
import { address } from "../model/csv.mjs";

const PREVIEW_ROWS = 20,
  PREVIEW_COLUMNS = 30;
const TYPE_LABEL = {
  auto: "Automatic",
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "TRUE/FALSE",
};
// Sheet name from the file name: Excel's forbidden characters removed, at
// most 31 characters, unique in the workbook.
export function sheetName(fileName, sheets) {
  let base =
    fileName
      .replace(/\.(csv|tsv|txt)$/i, "")
      .replace(/[\\/*?:[\]]/g, " ")
      .replace(/^'+|'+$/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Imported";
  const taken = new Set(sheets.map((s) => s.name.toLowerCase()));
  let name = base.slice(0, 31).trim(),
    n = 1;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${++n})`;
    name = base.slice(0, 31 - suffix.length).trim() + suffix;
  }
  return name;
}
const option = (value, label, selected) => {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
};
function select(id, choices, value) {
  const s = document.createElement("select");
  s.id = id;
  for (const [v, label] of choices) s.append(option(v, label, v === value));
  return s;
}
// Opens the dialog for a picked file. onImport({name, cells, height, width,
// source}) commits and resolves true when the workbook changed.
export async function openCSVImport({ file, book, deps, onImport }) {
  const { h, modal, field, display } = deps;
  if (file.size > CSV_LIMITS.bytes)
    throw new Error(
      `${file.name} is larger than ${CSV_LIMITS.bytes / 1024 / 1024} MB, the import limit.`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const options = {
    encoding: "auto",
    delimiter: "auto",
    header: "auto",
    decimal: "auto",
    dates: "auto",
    columns: [],
  };
  let result = null;
  const encoding = select(
      "import-encoding",
      [["auto", "Automatic"], ...ENCODINGS],
      "auto",
    ),
    delimiter = select(
      "import-delimiter",
      [["auto", "Automatic"], ...DELIMITERS],
      "auto",
    ),
    header = select(
      "import-header",
      [
        ["auto", "Automatic"],
        ["yes", "Column names"],
        ["no", "Data"],
      ],
      "auto",
    ),
    decimal = select(
      "import-decimal",
      [
        ["auto", "Automatic"],
        ["point", "Point: 1,234.56"],
        ["comma", "Comma: 1 234,56"],
      ],
      "auto",
    ),
    dates = select(
      "import-dates",
      [
        ["auto", "Automatic"],
        ["dmy", "Day first: 28/10/2026"],
        ["mdy", "Month first: 10/28/2026"],
      ],
      "auto",
    ),
    name = h("input", {
      id: "import-name",
      maxlength: "31",
      value: sheetName(file.name, book.sheets),
    }),
    summary = h("p", { class: "imp-summary", id: "import-summary" }),
    alerts = h("ul", {
      class: "imp-alerts",
      id: "import-alerts",
      role: "alert",
    }),
    preview = h("div", { class: "imp-preview", id: "import-preview" }),
    notes = h("ul", { class: "imp-notes", id: "import-notes" }),
    apply = h(
      "button",
      { type: "button", class: "sh-b sh-t sh-primary", id: "import-apply" },
      "Import",
    ),
    cancel = h(
      "button",
      { type: "button", class: "sh-b sh-t", id: "import-cancel" },
      "Cancel",
    );
  const body = h(
    "div",
    { class: "imp-body" },
    summary,
    h(
      "div",
      { class: "imp-options" },
      field("Encoding", encoding),
      field("Delimiter", delimiter),
      field("First row", header),
      field("Decimal separator", decimal),
      field("Date order", dates),
      field("New sheet name", name),
    ),
    alerts,
    preview,
    notes,
  );
  const dialog = modal(`Import ${file.name}`, body, [apply, cancel]);
  dialog.classList.add("imp-dialog");
  cancel.onclick = () => dialog.close();

  function draw() {
    alerts.replaceChildren();
    notes.replaceChildren();
    for (const s of [decimal, dates]) s.removeAttribute("aria-invalid");
    try {
      result = readCSV(bytes, options);
    } catch (error) {
      result = null;
      summary.textContent = `${file.name} cannot be imported: ${error.message}`;
      preview.replaceChildren();
      apply.disabled = true;
      return;
    }
    const delimiterName =
      DELIMITERS.find(([d]) => d === result.delimiter)?.[1] ?? result.delimiter;
    summary.textContent = `${result.height.toLocaleString("en-US")} rows × ${result.width.toLocaleString("en-US")} columns · ${ENCODINGS.find(([e]) => e === result.encoding)[1]} · ${delimiterName.toLowerCase()}-separated${result.header ? " · first row holds column names" : ""}.`;
    for (const a of result.ambiguity) {
      alerts.append(h("li", {}, a.message));
      (a.kind === "decimal" ? decimal : dates).setAttribute(
        "aria-invalid",
        "true",
      );
    }
    for (const text of result.diagnostics) notes.append(h("li", {}, text));
    preview.replaceChildren(table(result));
    apply.disabled = result.ambiguity.length > 0;
  }
  // The first rows as they will be stored: typed values shown with the
  // workbook locale (dates in long form, so the order can be checked), the
  // column type above each column, and values that stay text flagged.
  function table({ cells, columns, height, header }) {
    const width = Math.min(columns.length, PREVIEW_COLUMNS),
      rows = Math.min(height, PREVIEW_ROWS + (header ? 1 : 0)),
      t = h("table", { "aria-label": "Import preview" }),
      head = h("tr", {}, h("th", {}, ""));
    for (let c = 0; c < width; c++) {
      const column = columns[c],
        s = select(
          `import-type-${c}`,
          COLUMN_TYPES.map((type) => [
            type,
            type === "auto"
              ? `Automatic: ${TYPE_LABEL[column.detected]}`
              : TYPE_LABEL[type],
          ]),
          column.type,
        );
      s.setAttribute(
        "aria-label",
        `Type of column ${column.letter} (${column.name})`,
      );
      s.onchange = () => {
        options.columns[c] = s.value;
        draw();
        document.getElementById(`import-type-${c}`)?.focus();
      };
      head.append(h("th", { scope: "col" }, h("span", {}, column.letter), s));
    }
    t.append(h("thead", {}, head));
    const tbody = h("tbody");
    for (let r = 1; r <= rows; r++) {
      const tr = h("tr", {}, h("th", { scope: "row" }, String(r)));
      for (let c = 0; c < width; c++) {
        const cell = cells[address(r, c + 1)],
          td = h("td");
        if (cell) {
          const shown =
            cell.input.type === "date"
              ? { ...cell, format: { kind: "date", dateStyle: "long" } }
              : cell;
          td.textContent = display(shown, book.locale);
          td.dataset.type = cell.input.type;
          if (cell.cellStyle === "header") td.className = "imp-header";
          else if (
            cell.input.type === "text" &&
            columns[c].detected !== "text"
          ) {
            td.className = "imp-exception";
            td.title = `Stays text: not ${TYPE_LABEL[columns[c].detected]}`;
          }
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    t.append(tbody);
    const more = [];
    if (height > rows)
      more.push(`${(height - rows).toLocaleString("en-US")} more rows`);
    if (columns.length > width)
      more.push(
        `${(columns.length - width).toLocaleString("en-US")} more columns`,
      );
    return h(
      "div",
      {},
      t,
      more.length
        ? h("p", { class: "imp-more" }, `Not shown: ${more.join(", ")}.`)
        : null,
    );
  }
  encoding.onchange = () => {
    options.encoding = encoding.value;
    draw();
  };
  delimiter.onchange = () => {
    options.delimiter = delimiter.value;
    options.columns = [];
    draw();
  };
  header.onchange = () => {
    options.header = header.value === "auto" ? "auto" : header.value === "yes";
    draw();
  };
  decimal.onchange = () => {
    options.decimal = decimal.value;
    draw();
  };
  dates.onchange = () => {
    options.dates = dates.value;
    draw();
  };
  apply.onclick = async () => {
    if (!result || result.ambiguity.length) return;
    const sheetName = name.value.trim();
    apply.disabled = true;
    try {
      const ref = `A1:${address(result.height, result.width)}`,
        digests = await columnFingerprints(result.cells, ref),
        source = {
          ref,
          kind: "csv",
          file: {
            name: file.name.slice(0, 255),
            bytes: file.size,
            ...(file.lastModified
              ? { modified: new Date(file.lastModified).toISOString() }
              : {}),
            sha256: await fileDigest(bytes),
          },
          importedAt: new Date().toISOString(),
          options: {
            encoding: result.encoding,
            delimiter: result.delimiter,
            header: result.header,
            decimal: result.conventions.decimal,
            dates: result.conventions.dates,
          },
          columns: result.columns.map((column, c) => ({
            name: column.name.slice(0, 255),
            type: column.type,
            fingerprint: digests[c],
          })),
        };
      const done = await onImport({
        name: sheetName,
        cells: result.cells,
        height: result.height,
        width: result.width,
        source,
        diagnostics: result.diagnostics,
      });
      if (done) dialog.close();
      else apply.disabled = false;
    } catch (error) {
      alerts.replaceChildren(h("li", {}, error.message));
      apply.disabled = false;
    }
  };
  draw();
  return dialog;
}
