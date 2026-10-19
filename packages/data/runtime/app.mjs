import { validateCell, parseAddress, address } from "../model/workbook.mjs";
import { readModel } from "./document-model.mjs";
import { EngineClient } from "./client.mjs";
import { setupPersistence } from "./saving.mjs";
import { snapshotState, CalculationRevision } from "../model/snapshots.mjs";
import { preview, touchPreview } from "./view.mjs";
const $ = (id) => document.getElementById(id);
let book = readModel($("workbook").textContent),
  sheetId = book.sheets[0].id,
  selected = "B2",
  session = null,
  loading = null,
  pendingEdit = null;
const revisions = new CalculationRevision();
const history = [];
const config = JSON.parse($("engine-config").textContent);
const status = (text) => {
  $("status").textContent = text;
};
const persistence = setupPersistence({
  getBook: () => book,
  getPending: () => pendingEdit,
  restore: (recovered) => {
    revisions.cancel();
    session?.dispose();
    session = null;
    loading = null;
    pendingEdit = null;
    book = recovered;
    sheetId = book.sheets[0].id;
    history.length = 0;
    render();
    choose("B2");
    const token = revisions.revision;
    void snapshotState(book).then((value) => {
      if (revisions.current(token))
        status(
          value.state === "current"
            ? "Saved results are current."
            : "Saved results are stale or missing. Apply an edit to recalculate.",
        );
    });
  },
});
function cellEdits(refs) {
  return refs.map(({ sheetId, ref }) => ({
    sheetId,
    ref,
    cell: book.sheets.find((s) => s.id === sheetId).cells[ref] ?? null,
  }));
}
function choose(ref) {
  for (const b of $("grid").querySelectorAll("[data-cell]"))
    b.setAttribute("aria-pressed", String(b.dataset.cell === ref));
  selected = ref;
  $("cell-address").value = ref;
  const cell = book.sheets.find((s) => s.id === sheetId).cells[ref] ?? {},
    value = cell.input ?? { type: "blank" };
  $("cell-type").value = cell.formula ? "formula" : value.type;
  $("cell-value").value =
    cell.formula ?? (value.type === "blank" ? "" : String(value.value));
}
function render() {
  $("sheet-tabs").replaceChildren();
  for (const sheet of book.sheets) {
    const b = document.createElement("button");
    b.textContent = sheet.name;
    b.disabled = !!loading;
    b.setAttribute("aria-pressed", String(sheet.id === sheetId));
    b.onclick = () => {
      sheetId = sheet.id;
      render();
      choose(selected);
    };
    $("sheet-tabs").append(b);
  }
  const sheet = book.sheets.find((s) => s.id === sheetId),
    data = preview(sheet),
    table = document.createElement("table");
  table.setAttribute("aria-label", sheet.name);
  const head = document.createElement("thead"),
    heading = document.createElement("tr");
  for (const label of [
    "",
    ...data.rows[0].map((_, c) => address(1, c + 1).replace(/\d+$/, "")),
  ]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    heading.append(th);
  }
  head.append(heading);
  table.append(head);
  const body = document.createElement("tbody");
  for (const row of data.rows) {
    const tr = document.createElement("tr"),
      rowHeader = document.createElement("th");
    rowHeader.scope = "row";
    rowHeader.textContent = String(parseAddress(row[0].ref).row);
    tr.append(rowHeader);
    for (const { ref, cell, text } of row) {
      const td = document.createElement("td"),
        b = document.createElement("button");
      b.dataset.cell = ref;
      b.disabled = !!loading;
      b.setAttribute("aria-label", `${ref}: ${text || "Empty"}`);
      b.setAttribute("aria-pressed", String(ref === selected));
      b.textContent = text || "\u00a0";
      b.title = `${ref}${cell.formula ? ` · ${cell.formula}` : ""}`;
      b.className = cell.role ?? "normal";
      b.onclick = () => choose(ref);
      td.append(b);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  $("grid").replaceChildren(table);
  $("preview-note").textContent = data.truncated
    ? "Preview shows the first 30 rows and 12 columns. All data remains embedded."
    : "";
  $("undo").disabled = !history.length || !!loading;
  $("apply").disabled = !!loading;
  $("recalculate").disabled = !!loading;
  $("cancel").disabled = !loading;
  $("save").disabled = false;
  $("decimals").disabled = !!loading;
  for (const field of document.querySelectorAll(".fields input,.fields select"))
    field.disabled = !!loading;
}
function enteredCell() {
  const type = $("cell-type").value,
    text = $("cell-value").value;
  const old =
    book.sheets.find((s) => s.id === sheetId).cells[$("cell-address").value] ??
    {};
  const cell = { ...old };
  delete cell.input;
  delete cell.formula;
  delete cell.result;
  if (type === "formula") cell.formula = text;
  else if (type === "blank") cell.input = { type };
  else if (type === "number" || type === "date") {
    if (!text.trim()) throw new Error("Enter a number.");
    cell.input = { type, value: Number(text) };
  } else if (type === "boolean") {
    if (!["TRUE", "FALSE"].includes(text.toUpperCase()))
      throw new Error("Enter TRUE or FALSE.");
    cell.input = { type, value: text.toUpperCase() === "TRUE" };
  } else cell.input = { type, value: text };
  return cell;
}
async function apply({ recalculateOnly = false } = {}) {
  if (loading) return;
  const epoch = revisions.begin(),
    controller = new AbortController();
  let touchedEngine = false,
    loadMetrics = null;
  try {
    const ref = recalculateOnly ? selected : $("cell-address").value,
      cell = recalculateOnly
        ? book.sheets.find((s) => s.id === sheetId).cells[selected]
        : enteredCell(),
      target = sheetId;
    if (!recalculateOnly) {
      parseAddress(ref);
      validateCell(cell);
    } // Validate before downloading or mutating the engine.
    loading = controller;
    if (!recalculateOnly) {
      const prior = pendingEdit;
      pendingEdit = { sheetId: target, ref, cell };
      persistence.changed(cellEdits(prior ? [prior] : []));
    }
    render();
    status(
      config.embedded
        ? "Loading embedded calculation engine…"
        : "Loading verified calculation engine… Your edit is retained.",
    );
    touchedEngine = true;
    if (!session) {
      session = new EngineClient(config, $("worker-source").textContent);
      loadMetrics = await session.load(book);
      if (!revisions.current(epoch)) return;
    }
    if (!revisions.current(epoch)) return;
    if (!recalculateOnly) await session.edit(target, ref, cell);
    const result = await session.calculate();
    if (!revisions.current(epoch)) return;
    const sheet = book.sheets.find((s) => s.id === target);
    const previous = {
      target,
      ref,
      cell: sheet.cells[ref],
      snapshot: book.snapshot,
      results: result.results.map((r) => ({
        sheetId: r.sheetId,
        ref: r.ref,
        result: book.sheets.find((s) => s.id === r.sheetId).cells[r.ref]
          ?.result,
      })),
    };
    if (!recalculateOnly) {
      sheet.cells[ref] = cell;
      touchPreview(sheet.cells, ref);
    }
    for (const r of result.results)
      book.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    book.snapshot = result.snapshot;
    if (!recalculateOnly) pendingEdit = null;
    persistence.changed(
      cellEdits([{ sheetId: target, ref }, ...result.results]),
    );
    history.push(previous);
    status("Calculated locally. Unsaved changes.");
    dispatchEvent(
      new CustomEvent("html-data:calculated", {
        detail: {
          loadMetrics,
          calculateMS: result.calculateMS,
          wasmMemoryBytes: result.wasmMemoryBytes,
        },
      }),
    );
  } catch (error) {
    if (revisions.current(epoch)) {
      if (touchedEngine) {
        session?.dispose();
        session = null;
      }
      status(
        `${error.message} Your attempted edit remains in the form; retry Apply edit.`,
      );
    }
  } finally {
    if (revisions.current(epoch)) {
      loading = null;
      render();
    }
  }
}
$("apply").onclick = apply;
$("recalculate").onclick = () => apply({ recalculateOnly: true });
$("cancel").onclick = () => {
  revisions.cancel();
  loading?.abort();
  loading = null;
  session?.dispose();
  session = null;
  render();
  status(
    "Calculation cancelled. Your attempted edit is retained; retry Apply edit.",
  );
};
$("undo").onclick = () => {
  if (loading || !history.length) return;
  const previous = history.pop(),
    sheet = book.sheets.find((s) => s.id === previous.target);
  if (previous.cell === undefined) delete sheet.cells[previous.ref];
  else sheet.cells[previous.ref] = previous.cell;
  for (const r of previous.results ?? []) {
    const cell = book.sheets.find((s) => s.id === r.sheetId).cells[r.ref];
    if (!cell) continue;
    if (r.result === undefined) delete cell.result;
    else cell.result = r.result;
  }
  if (previous.snapshot === undefined) delete book.snapshot;
  else book.snapshot = previous.snapshot;
  // Keep the loaded engine in its worker; synchronise it before the next edit.
  const current = session;
  current?.load(book).catch(() => {
    if (session === current) {
      current.dispose();
      session = null;
    }
  });
  const prior = pendingEdit;
  pendingEdit = null;
  persistence.changed(
    cellEdits([
      ...(prior ? [prior] : []),
      { sheetId: previous.target, ref: previous.ref },
      ...(previous.results ?? []),
    ]),
  );
  render();
  choose(selected);
  status("Undo restored the previous workbook.");
};
$("decimals").onclick = () => {
  if (loading) return;
  const sheet = book.sheets.find((s) => s.id === sheetId),
    old = sheet.cells[selected] ?? {};
  history.push({
    target: sheetId,
    ref: selected,
    cell: old,
    snapshot: book.snapshot,
  });
  sheet.cells[selected] = {
    ...old,
    format: {
      ...old.format,
      kind: old.format?.kind ?? "number",
      digits: Math.min(15, (old.format?.digits ?? 0) + 1),
    },
  };
  // Formatting is browser-owned and excluded from the calculation fingerprint.
  persistence.changed(cellEdits([{ sheetId, ref: selected }]));
  render();
  status("Formatting changed. Unsaved changes.");
};

render();
choose(selected);
const initialRevision = revisions.revision;
const initialState = await snapshotState(book);
if (revisions.current(initialRevision))
  status(
    initialState.state === "current"
      ? "Saved results are current."
      : "Saved results are stale or missing. Apply an edit to recalculate.",
  );
