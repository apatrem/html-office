import {
  validateCell,
  parseAddress,
  address,
  fingerprint,
} from "../model/workbook.mjs";
import { readModel, writeModel } from "./document-model.mjs";
import { EngineClient } from "./client.mjs";
import { preview, touchPreview } from "./view.mjs";
const $ = (id) => document.getElementById(id);
let book = readModel($("workbook").textContent),
  sheetId = book.sheets[0].id,
  selected = "B2",
  session = null,
  loading = null,
  sequence = 0;
const history = [];
const config = JSON.parse($("engine-config").textContent);
const status = (text) => {
  $("status").textContent = text;
};
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
  $("cancel").disabled = !loading;
  $("save").disabled = !!loading;
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
async function apply() {
  if (loading) return;
  const epoch = ++sequence,
    controller = new AbortController();
  let touchedEngine = false,
    loadMetrics = null;
  try {
    const ref = $("cell-address").value,
      cell = enteredCell(),
      target = sheetId;
    parseAddress(ref);
    validateCell(cell); // Validate before downloading or mutating the engine.
    loading = controller;
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
      if (epoch !== sequence) return;
    }
    if (epoch !== sequence) return;
    await session.edit(target, ref, cell);
    const result = await session.calculate();
    if (epoch !== sequence) return;
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
    sheet.cells[ref] = cell;
    touchPreview(sheet.cells, ref);
    for (const r of result.results)
      book.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    book.snapshot = result.snapshot;
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
    if (epoch === sequence) {
      if (touchedEngine) {
        session?.dispose();
        session = null;
      }
      status(
        `${error.message} Your attempted edit remains in the form; retry Apply edit.`,
      );
    }
  } finally {
    if (epoch === sequence) {
      loading = null;
      render();
    }
  }
}
$("apply").onclick = apply;
$("cancel").onclick = () => {
  ++sequence;
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
  render();
  status("Formatting changed. Unsaved changes.");
};
$("save").onclick = () => {
  if (loading) {
    status("Finish or cancel the pending calculation before saving.");
    return;
  }
  const copy = document.documentElement.cloneNode(true);
  copy.querySelector("#workbook").textContent = writeModel(book);
  // Saved form state should reflect its actual default when the copy is reopened.
  copy.querySelector("#status").textContent = "Checking saved results…";
  const url = URL.createObjectURL(
    new Blob(["<!doctype html>\n" + copy.outerHTML], {
      type: "text/html;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${book.id}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Copy download requested. Open the downloaded HTML to verify it.");
};
render();
choose(selected);
status(
  book.snapshot?.fingerprint === (await fingerprint(book))
    ? "Saved results are current."
    : "Saved results are stale or missing. Apply an edit to recalculate.",
);
