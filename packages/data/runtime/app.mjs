import { validateCell, parseAddress } from "../model/workbook.mjs";
import { readModel } from "./document-model.mjs";
import { EngineClient } from "./client.mjs";
import { setupPersistence } from "./saving.mjs";
import { snapshotState, CalculationRevision } from "../model/snapshots.mjs";
import { touchPreview } from "./view.mjs";
import { createGrid } from "./grid.mjs";
import { setupClipboard } from "./clipboard.mjs";
import {
  validateStructure,
  shiftWorkbook,
  captureHead,
} from "../model/structure.mjs";
import { EditHistory, captureCells } from "../model/history.mjs";
const $ = (id) => document.getElementById(id);
let book = readModel($("workbook").textContent),
  sheetId = book.sheets[0].id,
  selected = "B2",
  session = null,
  loading = null,
  pendingEdits = [];
const revisions = new CalculationRevision();
const history = new EditHistory();
const config = JSON.parse($("engine-config").textContent);
const status = (text) => {
  $("status").textContent = text;
};
const persistence = setupPersistence({
  getBook: () => book,
  getPending: () => (pendingEdits.length ? pendingEdits : null),
  restore: (recovered) => {
    revisions.cancel();
    session?.dispose();
    session = null;
    loading = null;
    pendingEdits = [];
    book = recovered;
    sheetId = book.sheets[0].id;
    history.clear();
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
const grid = createGrid($("grid"), {
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  busy: () => !!loading,
  onSelect: (ref) => choose(ref, false),
  onCommand: (event) => {
    const key = event.key.toLowerCase();
    if (["z", "y"].includes(key)) {
      event.preventDefault();
      void moveHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    }
  },
  onEdit: (initial) => {
    if (initial !== undefined) {
      $("cell-type").value =
        initial === "="
          ? "formula"
          : /[0-9.+-]/.test(initial)
            ? "number"
            : "text";
      $("cell-value").value = initial;
    }
    if (initial === undefined && $("cell-type").value === "blank")
      $("cell-type").value = "text";
    $("cell-value").focus();
    if (initial === undefined) $("cell-value").select();
  },
});
function choose(ref, updateGrid = true) {
  if (updateGrid) grid.select(ref, { notify: false });
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
  grid.draw();
  $("preview-note").textContent =
    "Arrow keys navigate · Shift selects a rectangle · F2 edits · Enter applies in the formula bar · Escape cancels form changes";
  $("undo").disabled = !history.canUndo || !!loading;
  $("redo").disabled = !history.canRedo || !!loading;
  $("apply").disabled = !!loading;
  $("recalculate").disabled = !!loading;
  $("cancel").disabled = !loading;
  $("save").disabled = false;
  $("retry-range").hidden = !pendingEdits.some((edit) => edit.range);
  $("retry-range").disabled = !!loading;
  $("decimals").disabled = !!loading;
  for (const id of [
    "paste-table",
    "fill-down",
    "fill-right",
    "insert-row",
    "delete-row",
    "insert-column",
    "delete-column",
  ])
    $(id).disabled = !!loading;
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
  else if (type === "blank") {
    if (text)
      throw new Error(
        "Choose a text or number input type for nonempty content.",
      );
    cell.input = { type };
  } else if (type === "number" || type === "date") {
    if (!text.trim()) throw new Error("Enter a number.");
    cell.input = { type, value: Number(text) };
  } else if (type === "boolean") {
    if (!["TRUE", "FALSE"].includes(text.toUpperCase()))
      throw new Error("Enter TRUE or FALSE.");
    cell.input = { type, value: text.toUpperCase() === "TRUE" };
  } else cell.input = { type, value: text };
  return cell;
}
async function apply({ recalculateOnly = false, edits, selectionAfter } = {}) {
  if (loading) return;
  const epoch = revisions.begin(),
    controller = new AbortController();
  let touchedEngine = false,
    loadMetrics = null;
  try {
    if (!recalculateOnly) {
      edits ??= [
        { sheetId, ref: $("cell-address").value, cell: enteredCell() },
      ];
      for (const edit of edits) {
        parseAddress(edit.ref);
        if (!book.sheets.some((s) => s.id === edit.sheetId))
          throw new Error("Unknown sheet ID");
        if (edit.cell !== null) validateCell(edit.cell);
      }
      if (!edits.length) return;
    } else edits = [];
    loading = controller;
    if (!recalculateOnly) {
      const prior = pendingEdits;
      pendingEdits = edits;
      persistence.changed(cellEdits(prior));
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
    if (!recalculateOnly) await session.editMany(edits);
    const result = await session.calculate();
    if (!revisions.current(epoch)) return;
    const refs = [...edits, ...result.results],
      before = captureCells(book, refs),
      snapshotBefore = book.snapshot,
      selectionBefore = { sheetId, ...grid.selection };
    for (const edit of edits) {
      const sheet = book.sheets.find((s) => s.id === edit.sheetId);
      if (edit.cell === null) delete sheet.cells[edit.ref];
      else sheet.cells[edit.ref] = edit.cell;
      touchPreview(sheet.cells, edit.ref);
    }
    for (const r of result.results)
      book.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    book.snapshot = result.snapshot;
    if (!recalculateOnly) {
      pendingEdits = [];
      if (selectionAfter) {
        sheetId = selectionAfter.sheetId;
        grid.select(selectionAfter.anchor, { notify: false });
        grid.select(selectionAfter.focus, { extend: true, notify: false });
        choose(selectionAfter.focus, false);
      } else {
        sheetId = edits[0].sheetId;
        choose(edits[0].ref);
      }
    }
    persistence.changed(cellEdits(refs));
    history.record({
      before,
      after: captureCells(book, refs),
      snapshotBefore,
      snapshotAfter: book.snapshot,
      selectionBefore,
      selectionAfter: { sheetId, ...grid.selection },
      calculate: true,
    });
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
    return true;
  } catch (error) {
    if (revisions.current(epoch)) {
      if (touchedEngine) {
        session?.dispose();
        session = null;
      }
      status(
        `${error.message} ${pendingEdits.some((edit) => edit.range) ? "The attempted range is retained; use Retry pending range or Save a copy." : "Your attempted edit remains in the form; retry Apply edit."}`,
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
$("retry-range").onclick = () => {
  if (!pendingEdits.length || loading) return;
  const edits = structuredClone(pendingEdits),
    first = edits[0],
    last = edits.at(-1);
  void apply({
    edits,
    selectionAfter: {
      sheetId: first.sheetId,
      anchor: first.ref,
      focus: last.ref,
    },
  });
};
$("cell-value").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const applied = await apply();
    if (!loading) $(applied ? "grid" : "cell-value").focus();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (
      pendingEdits.some(
        (edit) => edit.sheetId === sheetId && edit.ref === selected,
      )
    ) {
      const cancelled = pendingEdits;
      pendingEdits = [];
      persistence.changed(cellEdits(cancelled));
      status("Attempted edit discarded. The committed cell is restored.");
    }
    choose(selected);
    $("grid").focus();
  }
});
$("cell-address").addEventListener("change", () => {
  try {
    parseAddress($("cell-address").value);
    choose($("cell-address").value);
  } catch (error) {
    status(error.message);
  }
});
$("recalculate").onclick = () => apply({ recalculateOnly: true });
$("cancel").onclick = () => {
  const structural = loading?.operation === "structure";
  revisions.cancel();
  loading?.abort();
  loading = null;
  session?.dispose();
  session = null;
  render();
  status(
    structural
      ? "Row/column operation cancelled. Your previous work is retained."
      : !pendingEdits.length
        ? "Calculation cancelled. Your workbook remains open."
        : pendingEdits.some((edit) => edit.range)
          ? "Calculation cancelled. Your attempted range is retained; use Retry pending range or Save a copy."
          : "Calculation cancelled. Your attempted edit is retained; retry Apply edit.",
  );
};
async function applyStructure(axis, action) {
  if (loading) return;
  const selectedRange = grid.selection,
    command = {
      sheetId,
      axis,
      action,
      index: axis === "row" ? selectedRange.top : selectedRange.left,
      count:
        axis === "row"
          ? selectedRange.bottom - selectedRange.top + 1
          : selectedRange.right - selectedRange.left + 1,
    };
  const epoch = revisions.begin();
  try {
    validateStructure(command, book);
    loading = new AbortController();
    loading.operation = "structure";
    render();
    status("Updating row/column references and recalculating…");
    if (!session) {
      session = new EngineClient(config, $("worker-source").textContent);
      await session.load(book);
    }
    if (!revisions.current(epoch)) return;
    const result = await session.structure(command);
    if (!revisions.current(epoch)) return;
    const before = captureCells(book, result.beforeRefs),
      headBefore = captureHead(book),
      snapshotBefore = book.snapshot,
      selectionBefore = { sheetId, ...grid.selection },
      priorRestoration = cellEdits(pendingEdits),
      next = shiftWorkbook(book, command);
    for (const f of result.formulas) {
      const cells = next.sheets.find((s) => s.id === f.sheetId).cells;
      cells[f.ref] = { ...cells[f.ref], formula: f.formula };
    }
    for (const r of result.results)
      next.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    next.snapshot = result.snapshot;
    book = next;
    pendingEdits = [];
    const after = captureCells(book, result.formulas),
      headAfter = captureHead(book);
    history.record({
      structure: command,
      before,
      after,
      headBefore,
      headAfter,
      snapshotBefore,
      snapshotAfter: book.snapshot,
      selectionBefore,
      selectionAfter: selectionBefore,
      calculate: true,
    });
    persistence.changed(cellEdits(result.formulas), {
      beforeEdits: priorRestoration,
      structure: command,
      head: headAfter,
    });
    render();
    choose(selected, false);
    status("Row/column references updated. Unsaved changes.");
  } catch (error) {
    if (revisions.current(epoch)) {
      session?.dispose();
      session = null;
      status(
        `Row/column operation not applied: ${error.message}. Your previous work is retained.`,
      );
    }
  } finally {
    if (revisions.current(epoch)) {
      loading = null;
      render();
    }
  }
}
for (const axis of ["row", "column"])
  for (const action of ["insert", "delete"])
    $(action + "-" + axis).onclick = () => applyStructure(axis, action);
async function moveHistory(direction) {
  if (loading) return;
  const priorRestoration = cellEdits(pendingEdits);
  const moved = history[direction](book);
  if (!moved) return;
  const epoch = revisions.begin();
  pendingEdits = [];
  if (moved.selection) {
    sheetId = moved.selection.sheetId;
    grid.select(moved.selection.anchor, { notify: false });
    grid.select(moved.selection.focus, { extend: true, notify: false });
    choose(moved.selection.focus, false);
  }
  for (const edit of moved.edits)
    touchPreview(
      book.sheets.find((s) => s.id === edit.sheetId).cells,
      edit.ref,
    );
  persistence.changed(cellEdits(moved.edits), {
    beforeEdits: priorRestoration,
    structure: moved.structure,
    head: moved.head,
  });
  // Restore canonical known state immediately, then recalculate in the same adapter.
  if (!moved.calculate) {
    render();
    status(
      `${direction === "undo" ? "Undo" : "Redo"} restored the previous workbook.`,
    );
    return;
  }
  loading = new AbortController();
  render();
  status("Restored workbook. Recalculating…");
  try {
    session ??= new EngineClient(config, $("worker-source").textContent);
    await session.load(book);
    const result = await session.calculate();
    if (!revisions.current(epoch)) return;
    for (const r of result.results)
      book.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    book.snapshot = result.snapshot;
    persistence.changed(cellEdits(result.results));
    status(
      `${direction === "undo" ? "Undo" : "Redo"} restored the previous workbook.`,
    );
  } catch (error) {
    if (revisions.current(epoch)) {
      session?.dispose();
      session = null;
      status(
        `Workbook restored from history; recalculation unavailable: ${error.message}`,
      );
    }
  } finally {
    if (revisions.current(epoch)) {
      loading = null;
      render();
    }
  }
}
$("undo").onclick = () => moveHistory("undo");
$("redo").onclick = () => moveHistory("redo");
$("decimals").onclick = () => {
  if (loading) return;
  const sheet = book.sheets.find((s) => s.id === sheetId),
    old = sheet.cells[selected] ?? {};
  const refs = [{ sheetId, ref: selected }],
    before = captureCells(book, refs),
    selection = { sheetId, ...grid.selection };
  sheet.cells[selected] = {
    ...old,
    format: {
      ...old.format,
      kind: old.format?.kind ?? "number",
      digits: Math.min(15, (old.format?.digits ?? 0) + 1),
    },
  };
  for (const attempt of pendingEdits) {
    if (
      attempt.sheetId === sheetId &&
      attempt.ref === selected &&
      attempt.cell !== null
    )
      attempt.cell = { ...attempt.cell, format: sheet.cells[selected].format };
  }
  history.record({
    before,
    after: captureCells(book, refs),
    snapshotBefore: book.snapshot,
    snapshotAfter: book.snapshot,
    selectionBefore: selection,
    selectionAfter: selection,
    calculate: false,
  });
  // Formatting is browser-owned and excluded from the calculation fingerprint.
  persistence.changed(cellEdits([{ sheetId, ref: selected }]));
  render();
  status("Formatting changed. Unsaved changes.");
};

setupClipboard({
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  getSelection: () => grid.selection,
  busy: () => !!loading,
  apply,
  status,
  cancel: () => $("cancel").click(),
});
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
