// Refresh dialog (T16), part of the import chunk. The replacement file is read
// the way the source was (its saved options), compared with the source range
// as it is now, and nothing changes until the person has settled every
// missing column, seen what a refresh overwrites and confirmed it. An XLSX
// source is refreshed from one worksheet of the replacement workbook.
import { readCSV, ENCODINGS, DELIMITERS, CSV_LIMITS } from "../model/csv.mjs";
import { columnFingerprints, fileDigest } from "../model/source-digest.mjs";
import { planRefresh, dependents } from "../model/refresh.mjs";
import { mapSheet, importable, diagnostics } from "../model/xlsx.mjs";
import { readXLSX } from "./xlsx-reader.mjs";

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
// Column types chosen at import follow their column by name.
function typesFor(source, names) {
  return names.map(
    (name) => source.columns.find((c) => c.name === name)?.type ?? "auto",
  );
}
// Formulas of a refreshed XLSX sheet read other sheets by their names in the
// file: each maps to the Data sheet imported from it (by its source), the
// refreshed sheet to itself; any other is not imported.
function sheetNames(book, source, workbook, index) {
  const names = new Map(
    workbook.sheets.map((s) => [s.name.toLowerCase(), null]),
  );
  for (const other of book.sources ?? []) {
    if (other.kind !== "xlsx" || other.id === source.id) continue;
    const key = other.options.sheet.toLowerCase();
    if (!names.has(key)) continue;
    const data = book.sheets.find((s) => s.id === other.sheetId).name;
    if (names.get(key) === null || other.file.name === source.file.name)
      names.set(key, data);
  }
  names.set(
    workbook.sheets[index].name.toLowerCase(),
    book.sheets.find((s) => s.id === source.sheetId).name,
  );
  return names;
}
export async function openRefresh({ file, book, source, deps, onRefresh }) {
  const { h, modal, field, display } = deps;
  if (source.kind === "csv" && file.size > CSV_LIMITS.bytes)
    throw new Error(
      `${file.name} is larger than ${CSV_LIMITS.bytes / 1024 / 1024} MB, the import limit.`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer()),
    sheet = book.sheets.find((s) => s.id === source.sheetId),
    options = { ...source.options },
    resolutions = {};
  // Columns edited by hand since the import (or since the last refresh).
  let edited = [];
  if (source.ref !== "#REF!") {
    const now = await columnFingerprints(sheet.cells, source.ref);
    edited =
      now.length === source.columns.length
        ? now.flatMap((digest, i) =>
            digest === source.columns[i].fingerprint ? [] : [i],
          )
        : now.map((_, i) => i);
  }
  const reshaped =
    source.ref !== "#REF!" &&
    (await columnFingerprints(sheet.cells, source.ref)).length !==
      source.columns.length;
  const xlsx = source.kind === "xlsx",
    worksheet = h("select", { id: "refresh-sheet", disabled: true }),
    encoding = select(h, "refresh-encoding", ENCODINGS, options.encoding),
    delimiter = select(h, "refresh-delimiter", DELIMITERS, options.delimiter),
    decimal = select(
      h,
      "refresh-decimal",
      [
        ["point", "Point: 1,234.56"],
        ["comma", "Comma: 1 234,56"],
      ],
      options.decimal,
    ),
    dates = select(
      h,
      "refresh-dates",
      [
        ["dmy", "Day first: 28/10/2026"],
        ["mdy", "Month first: 10/28/2026"],
      ],
      options.dates,
    ),
    summary = h("p", { class: "imp-summary", id: "refresh-summary" }),
    alerts = h("ul", {
      class: "imp-alerts",
      id: "refresh-alerts",
      role: "alert",
    }),
    columns = h("div", { class: "imp-preview", id: "refresh-columns" }),
    impact = h("ul", { class: "imp-notes", id: "refresh-impact" }),
    confirm = h("input", { type: "checkbox", id: "refresh-confirm" }),
    confirmLabel = h(
      "label",
      { class: "sh-chk", id: "refresh-confirm-label", hidden: true },
      confirm,
      h("span", { id: "refresh-confirm-text" }),
    ),
    apply = h(
      "button",
      { type: "button", class: "sh-b sh-t sh-primary", id: "refresh-apply" },
      "Refresh",
    ),
    cancel = h(
      "button",
      { type: "button", class: "sh-b sh-t", id: "refresh-cancel" },
      "Cancel",
    );
  const dialog = modal(
    `Refresh "${sheet.name}" from ${file.name}`,
    h(
      "div",
      { class: "imp-body" },
      summary,
      h(
        "div",
        { class: "imp-options" },
        ...(xlsx
          ? [field("Sheet in the new file", worksheet)]
          : [
              field("Encoding", encoding),
              field("Delimiter", delimiter),
              field("Decimal separator", decimal),
              field("Date order", dates),
            ]),
      ),
      alerts,
      columns,
      impact,
      confirmLabel,
    ),
    [apply, cancel],
  );
  dialog.classList.add("imp-dialog");
  cancel.onclick = () => dialog.close();
  let plan = null,
    fresh = null,
    workbook = null;
  if (xlsx) {
    const reading = new AbortController();
    dialog.addEventListener("close", () => reading.abort());
    apply.disabled = true;
    summary.textContent = `Reading ${file.name}…`;
    try {
      workbook = await readXLSX(bytes, {
        name: file.name,
        signal: reading.signal,
      });
    } catch (error) {
      if (!reading.signal.aborted)
        summary.textContent = `${file.name} cannot be used: ${error.message.replace(`${file.name} cannot be read: `, "")}`;
      return dialog;
    }
    if (!dialog.open) return dialog;
    const usable = workbook.sheets
      .map((s, i) => [s, i])
      .filter(([s]) => importable(s));
    if (!usable.length) {
      summary.textContent = `${file.name} has no worksheet with data.`;
      return dialog;
    }
    for (const [s, i] of usable)
      worksheet.append(h("option", { value: String(i) }, s.name));
    // The worksheet with the source's name, else the first one.
    worksheet.value = String(
      (usable.find(([s]) => s.name === source.options.sheet) ??
        usable.find(
          ([s]) => s.name.toLowerCase() === source.options.sheet.toLowerCase(),
        ) ??
        usable[0])[1],
    );
    worksheet.disabled = false;
    worksheet.onchange = draw;
  }
  function read() {
    if (xlsx) {
      const index = Number(worksheet.value),
        mapped = mapSheet(workbook, index, {
          sheets: sheetNames(book, source, workbook, index),
          header: source.options.header,
        }),
        name = workbook.sheets[index].name;
      return {
        ...mapped,
        ambiguity: [],
        diagnostics: diagnostics(
          workbook,
          [{ index, original: name, name, ...mapped }],
          [index],
          [],
          false,
        ),
      };
    }
    const first = readCSV(bytes, { ...options, header: options.header });
    return readCSV(bytes, {
      ...options,
      header: options.header,
      columns: typesFor(
        source,
        first.columns.map((c) => c.name),
      ),
    });
  }
  function draw() {
    alerts.replaceChildren();
    impact.replaceChildren();
    plan = null;
    try {
      fresh = read();
      plan = planRefresh({ sheet, source, fresh, resolutions, edited });
    } catch (error) {
      summary.textContent = `${file.name} cannot be used: ${error.message}`;
      columns.replaceChildren();
      confirmLabel.hidden = true;
      apply.disabled = true;
      return;
    }
    const changed = plan.columns.reduce((n, c) => n + c.changed, 0);
    summary.textContent = `${source.file.name} (imported ${new Date(source.importedAt).toLocaleString("en-US")}) → ${file.name}. Rows: ${plan.rows.before.toLocaleString("en-US")} → ${plan.rows.after.toLocaleString("en-US")}. ${plural(changed, "value changes", "values change")}; range ${source.ref} → ${plan.ref}.`;
    for (const a of fresh.ambiguity) alerts.append(h("li", {}, a.message));
    for (const c of plan.unresolved)
      alerts.append(
        h(
          "li",
          {},
          `Column ${plan.columns.find((p) => p.index === c.index).letter} "${c.name}" is not in the new file. Choose a column for it, clear it or keep its values.`,
        ),
      );
    if (plan.conflicts.length)
      alerts.append(
        h(
          "li",
          {},
          `The new rows or columns would overwrite cells outside the source range (${plan.conflicts.slice(0, 5).join(", ")}${plan.conflicts.length > 5 ? "…" : ""}). Move those cells first.`,
        ),
      );
    if (reshaped)
      alerts.append(
        h(
          "li",
          {},
          "Columns were inserted or deleted in the source range since the import; columns are matched by their header.",
        ),
      );
    columns.replaceChildren(table());
    const d = dependents(book, source.sheetId);
    for (const f of d.formulas)
      impact.append(
        h(
          "li",
          {},
          `${plural(f.count, "formula", "formulas")} on ${f.sheetName} will recalculate.`,
        ),
      );
    if (d.pivots.length)
      impact.append(
        h(
          "li",
          {},
          `${plural(d.pivots.length, "pivot table reads", "pivot tables read")} this sheet and will be out of date until refreshed (Data › Refresh all pivot tables).`,
        ),
      );
    if (d.charts.length)
      impact.append(
        h(
          "li",
          {},
          `${plural(d.charts.length, "chart reads", "charts read")} this sheet and will be redrawn.`,
        ),
      );
    if (d.conditional)
      impact.append(
        h(
          "li",
          {},
          `${plural(d.conditional, "conditional formatting rule applies", "conditional formatting rules apply")} to this sheet.`,
        ),
      );
    if (d.dropdowns)
      impact.append(
        h(
          "li",
          {},
          `${plural(d.dropdowns, "dropdown uses", "dropdowns use")} this sheet.`,
        ),
      );
    for (const text of fresh.diagnostics) impact.append(h("li", {}, text));
    // Hand edits the refresh would replace need an explicit confirmation.
    const overwritten = plan.columns.filter(
      (c) => c.edited && c.status !== "kept" && c.changed,
    );
    confirmLabel.hidden = !overwritten.length;
    if (!overwritten.length) confirm.checked = false;
    document.getElementById("refresh-confirm-text").textContent =
      `Replace the edits made by hand in ${overwritten.map((c) => `column ${c.letter} "${c.name}"`).join(", ")}.`;
    apply.disabled =
      !!plan.unresolved.length ||
      !!plan.conflicts.length ||
      !!fresh.ambiguity.length ||
      (overwritten.length > 0 && !confirm.checked);
  }
  const STATUS = {
    matched: "Same column",
    renamed: "Renamed",
    added: "New column",
    cleared: "Cleared",
    kept: "Values kept",
    missing: "Not in the new file",
  };
  function table() {
    const t = h(
      "table",
      { "aria-label": "Columns of the refresh" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...[
            "Column",
            "Name",
            "From the new file",
            "Changed values",
            "Examples",
          ].map((label) => h("th", { scope: "col" }, label)),
        ),
      ),
    );
    const body = h("tbody");
    // New-file columns already used by an existing column; added ones
    // remain offered.
    const taken = new Set(
      plan.columns
        .filter((c) => c.index !== null && c.from !== null)
        .map((c) => c.from),
    );
    for (const c of plan.columns) {
      let from;
      if (
        c.index !== null &&
        ["missing", "renamed", "cleared", "kept"].includes(c.status)
      ) {
        const index = c.index,
          choices = [
            ["", "Choose…"],
            ...fresh.columns
              .map((n, j) => [j, n.name])
              .filter(([, name]) => !taken.has(name) || name === c.from)
              .map(([j, name]) => [`map:${j}`, `Use "${name}"`]),
            ["clear", "Clear this column"],
            ["keep", "Keep current values"],
          ],
          r = resolutions[index],
          value = !r ? "" : r.kind === "map" ? `map:${r.to}` : r.kind;
        from = select(h, `refresh-map-${index}`, choices, value);
        from.setAttribute(
          "aria-label",
          `Column ${c.letter} "${c.name}" in the new file`,
        );
        if (!value) from.setAttribute("aria-invalid", "true");
        from.onchange = () => {
          const v = from.value;
          if (!v) delete resolutions[index];
          else if (v.startsWith("map:"))
            resolutions[index] = { kind: "map", to: Number(v.slice(4)) };
          else resolutions[index] = { kind: v };
          draw();
          document.getElementById(`refresh-map-${index}`)?.focus();
        };
      } else from = c.from === null ? "—" : c.from;
      const shown = (cell) =>
        cell?.formula
          ? cell.formula
          : cell?.input
            ? display(cell, book.locale) || "(empty)"
            : "(empty)";
      body.append(
        h(
          "tr",
          { "data-status": c.status },
          h("th", { scope: "row" }, c.letter),
          h(
            "td",
            {},
            c.name,
            c.edited ? h("span", { class: "imp-edited" }, " · edited") : null,
            h("br"),
            h("small", {}, STATUS[c.status]),
          ),
          h("td", {}, from),
          h("td", {}, c.changed.toLocaleString("en-US")),
          h(
            "td",
            {},
            c.samples
              .map((s) => `${s.ref}: ${shown(s.before)} → ${shown(s.after)}`)
              .join("\n"),
          ),
        ),
      );
    }
    t.append(body);
    return t;
  }
  confirm.onchange = draw;
  for (const [control, key] of [
    [encoding, "encoding"],
    [delimiter, "delimiter"],
    [decimal, "decimal"],
    [dates, "dates"],
  ])
    control.onchange = () => {
      options[key] = control.value;
      draw();
    };
  apply.onclick = async () => {
    if (!plan || apply.disabled) return;
    apply.disabled = true;
    try {
      // The new source: where it now is, the file read and the fingerprints
      // of the refreshed columns.
      const cells = { ...sheet.cells };
      for (const { ref, cell } of plan.edits)
        if (cell === null) delete cells[ref];
        else cells[ref] = cell;
      const digests = await columnFingerprints(cells, plan.ref),
        next = {
          ...source,
          ref: plan.ref,
          file: {
            name: file.name.slice(0, 255),
            bytes: file.size,
            ...(file.lastModified
              ? { modified: new Date(file.lastModified).toISOString() }
              : {}),
            sha256: await fileDigest(bytes),
          },
          importedAt: new Date().toISOString(),
          options: xlsx
            ? {
                sheet: workbook.sheets[Number(worksheet.value)].name,
                header: source.options.header,
              }
            : {
                encoding: fresh.encoding,
                delimiter: fresh.delimiter,
                header: source.options.header,
                decimal: fresh.conventions.decimal,
                dates: fresh.conventions.dates,
              },
          columns: plan.columns.map((c, i) => ({
            name:
              c.status === "cleared" ? "" : (c.from ?? c.name).slice(0, 255),
            type:
              source.columns.find((s) => s.name === (c.from ?? c.name))?.type ??
              "auto",
            fingerprint: digests[i],
          })),
        };
      const done = await onRefresh({
        source: next,
        edits: plan.edits.map((e) => ({ sheetId: source.sheetId, ...e })),
        summary: `Refreshed "${sheet.name}" from ${file.name}: ${plural(plan.rows.after, "row", "rows")}, ${plural(
          plan.columns.reduce((n, c) => n + c.changed, 0),
          "value changed",
          "values changed",
        )}.`,
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
