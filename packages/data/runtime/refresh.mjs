// Refresh dialog (T16), part of the import chunk. The replacement file is read
// the way the source was (its saved options), compared with the source range
// as it is now, and nothing changes until the person has settled every
// missing column, seen what a refresh overwrites and confirmed it.
import { readCSV, ENCODINGS, DELIMITERS, CSV_LIMITS } from "../model/csv.mjs";
import { columnFingerprints, fileDigest } from "../model/source-digest.mjs";
import {
  planRefresh,
  dependents,
  overwrittenEdits,
} from "../model/refresh.mjs";

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
// Column types chosen at import follow their column by name; with repeated
// names, the n-th column of a name takes the n-th such column's type. A
// column the person maps to another one (a rename) is read with the type of
// the column it replaces, so the values match the type the source records.
export function typesFor(source, names, resolutions = {}) {
  const seen = new Map();
  const types = names.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return (
      source.columns.filter((c) => !c.inserted && c.name === name)[n]?.type ??
      "auto"
    );
  });
  for (const [index, r] of Object.entries(resolutions))
    if (r.kind === "map" && r.to < types.length && source.columns[index]?.type)
      types[r.to] = source.columns[index].type;
  return types;
}
export async function openRefresh({ file, book, source, deps, onRefresh }) {
  const { h, modal, field, display } = deps;
  if (file.size > CSV_LIMITS.bytes)
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
            source.columns[i].inserted ||
            digest === source.columns[i].fingerprint
              ? []
              : [i],
          )
        : now.map((_, i) => i);
  }
  const reshaped =
    source.ref !== "#REF!" &&
    (await columnFingerprints(sheet.cells, source.ref)).length !==
      source.columns.length;
  const encoding = select(h, "refresh-encoding", ENCODINGS, options.encoding),
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
        field("Encoding", encoding),
        field("Delimiter", delimiter),
        field("Decimal separator", decimal),
        field("Date order", dates),
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
    // The refresh being committed, while Refresh runs.
    committing = null;
  // Cancel, Escape or any other close during the commit stops it.
  dialog.addEventListener("close", () => {
    if (!committing) return;
    committing.cancelled = true;
    deps.cancel?.();
  });
  function read() {
    const first = readCSV(bytes, { ...options, header: options.header });
    return readCSV(bytes, {
      ...options,
      header: options.header,
      columns: typesFor(
        source,
        first.columns.map((c) => c.name),
        resolutions,
      ),
    });
  }
  function draw() {
    // Nothing changes while Refresh commits the plan the person saw.
    if (committing) return;
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
    // Hand edits the refresh would replace or remove (a kept column loses
    // the rows the new file no longer has) need an explicit confirmation.
    const overwritten = overwrittenEdits(plan);
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
    inserted: "Inserted after the import; left alone",
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
        cell?.input ? display(cell, book.locale) || "(empty)" : "(empty)";
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
  // Every control that could change the plan.
  const controls = () => [
    ...dialog.querySelectorAll(".imp-options select"),
    ...columns.querySelectorAll("select"),
    confirm,
    apply,
  ];
  apply.onclick = async () => {
    if (!plan || apply.disabled || committing) return;
    const run = (committing = { cancelled: false, plan, fresh }),
      { plan: chosen } = run;
    for (const control of controls()) control.disabled = true;
    try {
      // The new source: where it now is, the file read and the fingerprints
      // of the refreshed columns.
      const cells = { ...sheet.cells };
      for (const { ref, cell } of chosen.edits)
        if (cell === null) delete cells[ref];
        else cells[ref] = cell;
      const digests = await columnFingerprints(cells, chosen.ref),
        sha256 = await fileDigest(bytes);
      if (run.cancelled) return;
      const next = {
        ...source,
        ref: chosen.ref,
        file: {
          name: file.name.slice(0, 255),
          bytes: file.size,
          ...(file.lastModified
            ? { modified: new Date(file.lastModified).toISOString() }
            : {}),
          sha256,
        },
        importedAt: new Date().toISOString(),
        options: {
          encoding: run.fresh.encoding,
          delimiter: run.fresh.delimiter,
          header: source.options.header,
          decimal: run.fresh.conventions.decimal,
          dates: run.fresh.conventions.dates,
        },
        columns: chosen.columns.map((c, i) =>
          c.status === "inserted"
            ? { inserted: true }
            : {
                name:
                  c.status === "cleared"
                    ? ""
                    : (c.from ?? c.name).slice(0, 255),
                type:
                  c.index === null
                    ? "auto"
                    : (source.columns[c.index]?.type ?? "auto"),
                fingerprint: digests[i],
              },
        ),
      };
      const done = await onRefresh({
        source: next,
        edits: chosen.edits.map((e) => ({ sheetId: source.sheetId, ...e })),
        summary: `Refreshed "${sheet.name}" from ${file.name}: ${plural(chosen.rows.after, "row", "rows")}, ${plural(
          chosen.columns.reduce((n, c) => n + c.changed, 0),
          "value changed",
          "values changed",
        )}.`,
      });
      if (done) dialog.close();
    } catch (error) {
      alerts.replaceChildren(h("li", {}, error.message));
    } finally {
      committing = null;
      if (dialog.open) {
        for (const control of controls()) control.disabled = false;
        draw();
      }
    }
  };
  draw();
  return dialog;
}
