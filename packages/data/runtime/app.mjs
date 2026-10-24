import { setupConditionalSettings } from "./conditional-settings.mjs";
import { createConditionalDecorator } from "./conditional.mjs";
import { createCommands } from "../../shared/shell/commands.mjs";
import { mountShell } from "./shell.mjs";
import { setupFormatting } from "./formatting.mjs";
import { setupDropdownSettings } from "./dropdown-settings.mjs";
import { setupDropdowns } from "./dropdowns.mjs";
import { assertScenarioInputs } from "../model/validation.mjs";
import { organizeWorkbook } from "../model/organization.mjs";
import { compactInputs } from "./literals.mjs";
import { setupSheetNavigation } from "./sheets.mjs";
import { validateCell, parseAddress, address } from "../model/workbook.mjs";
import { readModel } from "./document-model.mjs";
import { EngineClient } from "./client.mjs";
import { setupPersistence } from "./saving.mjs";
import { snapshotState, CalculationRevision } from "../model/snapshots.mjs";
import { touchPreview } from "./view.mjs";
import { createGrid } from "./grid.mjs";
import { setupPicture } from "./picture.mjs";
import { setupClipboard } from "./clipboard.mjs";
import {
  validateStructure,
  shiftWorkbook,
  captureHead,
} from "../model/structure.mjs";
import { EditHistory, captureCells } from "../model/history.mjs";
import {
  ownerRects,
  pivotOwner,
  pivotLabel,
  pivotEdits,
  pivotRemovalEdits,
  validatePivots,
  PIVOT_ERROR,
} from "../model/pivot.mjs";
import { setupPivots } from "./pivots.mjs";
import {
  applyLinkEdits,
  FONTS,
  THEMES,
  MAX_LINKS_PER_SHEET,
  validateAxes,
  validateSheetLinks,
} from "../model/formatting.mjs";
// Workbook-level presentation fields a panel may change (FORMAT.md).
function validateBookFields(fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "theme" && !THEMES.includes(value))
      throw new Error(`Invalid theme ${value}`);
    else if (key === "font" && !Object.hasOwn(FONTS, value))
      throw new Error(`Invalid font ${value}`);
    else if (
      key === "locale" &&
      Intl.NumberFormat.supportedLocalesOf([value]).length !== 1
    )
      throw new Error(`Unsupported locale ${value}`);
    else if (!["theme", "font", "locale"].includes(key))
      throw new Error(`Unexpected workbook field ${key}`);
  }
}
import { groupView } from "../model/organization.mjs";
const $ = (id) => document.getElementById(id);
const commands = createCommands();
commands.subscribe(drawCalculationState);
let book = compactInputs(readModel($("workbook").textContent)),
  sheetId = book.sheets[0].id,
  selected = "B2",
  session = null,
  loading = null,
  pendingEdits = [];
let conditionalScales = {};
// Derived pivot freshness from the recovery worker (ADR-014); null while a
// change is being analysed or when the worker is unavailable.
let pivotStates = null;
const revisions = new CalculationRevision();
const history = new EditHistory();
// Reuse verified fingerprints across formatting/history; recovery starts a new trust boundary.
const verifiedSnapshots = new Set();
// A verified workbook without formulas has no snapshot and nothing to calculate.
let formulaFree = false;
function trustSnapshot() {
  formulaFree = !book.snapshot;
  if (book.snapshot) verifiedSnapshots.add(book.snapshot.fingerprint);
}
const config = JSON.parse($("engine-config").textContent);
const status = (text) => {
  $("status").textContent = text;
};
const persistence = setupPersistence({
  getBook: () => book,
  isSnapshotCurrent: () =>
    !!book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint),
  onConditionalScales: (scales) => {
    const repaint =
      Object.keys(conditionalScales).length || Object.keys(scales ?? {}).length;
    conditionalScales = scales ?? {};
    if (repaint) grid.draw();
  },
  onPivotStates: (states) => {
    pivotStates = states;
    grid.draw();
    pivots.draw();
  },
  getPending: () => (pendingEdits.length ? pendingEdits : null),
  restore: (recovered) => {
    revisions.cancel();
    session?.dispose();
    session = null;
    loading = null;
    pendingEdits = [];
    book = compactInputs(recovered);
    verifiedSnapshots.clear();
    formulaFree = false;
    sheetId = book.sheets[0].id;
    history.clear();
    render();
    choose("B2");
    const token = revisions.revision;
    void snapshotState(book).then((value) => {
      if (revisions.current(token)) {
        if (value.state === "current") trustSnapshot();
        dropdowns.draw();
        persistence.refreshConditionalScales();
        grid.draw();
        drawCalculationState();
        status(
          value.state === "current"
            ? "Saved results are current."
            : "Saved results are stale or missing. Apply an edit to recalculate.",
        );
      }
    });
  },
});
function cellEdits(refs) {
  return refs.map(({ sheetId, ref }) => ({
    sheetId,
    ref,
    cell: book.sheets.find((s) => s.id === sheetId)?.cells[ref] ?? null,
  }));
}
const decorateConditional = createConditionalDecorator(
  () => book,
  () => !!book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint),
  () => conditionalScales,
);
// Cells a pivot owns carry a marker, and a second one while it is out of date.
let ownedBy = { pivots: undefined, rects: new Map() };
function decorateCell(element, cellSheetId, ref, cell) {
  decorateConditional(element, cellSheetId, ref, cell);
  if (!book.pivots?.length) return;
  if (ownedBy.pivots !== book.pivots)
    ownedBy = { pivots: book.pivots, rects: ownerRects(book) };
  const pivot = pivotOwner(ownedBy.rects, cellSheetId, ref);
  if (!pivot) return;
  const state = pivotStates?.[pivot.id]?.state,
    stale = ["stale", "unverified", "error", "never"].includes(state);
  element.classList.add("pivot-cell");
  if (stale) element.classList.add("pivot-stale");
  const note = `Pivot table ${pivotLabel(pivot)}${stale ? " (out of date: refresh it from Data › Pivot tables)" : ""}`;
  const previous = element.getAttribute("aria-description");
  element.setAttribute(
    "aria-description",
    previous ? `${previous}. ${note}` : note,
  );
}
const grid = createGrid($("grid"), {
  decorateCell,
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  getLocale: () => book.locale,
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
      $("cell-type").value = inferType(initial);
      $("cell-value").value = initial;
    }
    if (initial === undefined && $("cell-type").value === "blank")
      $("cell-type").value = "text";
    $("cell-value").focus();
    if (initial === undefined) $("cell-value").select();
  },
  // Copy style paints on Enter; Escape cancels it.
  intercept: (event) => {
    if (!formatting.painting()) return false;
    if (event.key === "Enter") formatting.paint();
    else if (event.key === "Escape") formatting.cancelPainter();
    else return false;
    commands.changed();
    event.preventDefault();
    return true;
  },
  onSelectEnd: (event, ref, moved) => {
    if (formatting.painting()) {
      formatting.paint();
      return void commands.changed();
    }
    const link = book.sheets.find((s) => s.id === sheetId).links?.[ref];
    if (!link || moved || event.shiftKey) return;
    if (event.metaKey || event.ctrlKey) formatting.openLink(link);
    else shell.showLink($(`grid-${ref}`), link);
  },
  onContextMenu: ({ kind, element }) => shell.contextMenu(kind, element),
  onResize: (column, width) => formatting.columnWidth(width, column),
  onAutoFit: (column) => formatting.autoFit(column),
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
  dropdowns.draw();
  commands.changed();
}
function render() {
  // The workbook font applies to the whole grid; absent means the charte font.
  $("grid").style.fontFamily = FONTS[book.font] ?? "";
  // A built-in charte overlays the document's own (TH01); absent keeps it.
  if (book.theme) document.documentElement.dataset.theme = book.theme;
  else delete document.documentElement.dataset.theme;
  navigation.draw();
  grid.draw();
  $("apply").disabled = !!loading;
  $("cancel").hidden = !loading;
  $("cancel").disabled = !loading;
  $("retry-range").hidden = !pendingEdits.some((edit) => edit.range);
  $("retry-range").disabled = !!loading;
  for (const field of document.querySelectorAll(
    ".formula-bar input,.formula-bar select,#number-dialog input,#number-dialog select",
  ))
    field.disabled = !!loading;
  dropdowns.draw();
  dropdownSettings.draw();
  conditionalSettings.draw();
  pivots.draw();
  commands.changed();
}
// The formula bar's calculation-state chip; details stay in the status line.
function drawCalculationState() {
  const [text, tone] = loading
    ? ["Calculating…", "busy"]
    : pendingEdits.length
      ? ["Not calculated", "warn"]
      : (
            book.snapshot
              ? verifiedSnapshots.has(book.snapshot.fingerprint)
              : formulaFree
          )
        ? ["Calculated", "ok"]
        : ["Results stale", "warn"];
  $("calc-state").textContent = text;
  $("calc-state").dataset.tone = tone;
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
// Pivot outputs belong to their pivot (ADR-014): ordinary edits are refused.
function assertUnowned(edits) {
  if (!book.pivots?.length) return;
  const rects = ownerRects(book);
  for (const edit of edits) {
    const pivot = pivotOwner(rects, edit.sheetId, edit.ref);
    if (pivot)
      throw new Error(
        `${edit.ref} belongs to pivot table "${pivotLabel(pivot)}". Change the pivot with Data › Pivot tables, or delete it first.`,
      );
  }
}
// `pivots` publishes new pivot definitions with the edits, in one history
// entry; `owner` names the pivot writing its own range; `transient` edits are
// not retained as an attempted draft when calculation fails.
async function apply({
  recalculateOnly = false,
  edits,
  selectionAfter,
  pivots,
  owner,
  transient = false,
} = {}) {
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
        if (edit.cell !== null) validateCell(edit.cell, book);
      }
      assertScenarioInputs(book, edits);
      if (!owner) assertUnowned(edits);
      // A pivot refresh with unchanged cells still publishes its stamp and the
      // recalculated results.
      if (!edits.length && pivots === undefined) return;
    } else edits = [];
    loading = controller;
    if (!recalculateOnly && !transient) {
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
      linkEdits = edits.some((edit) => edit.link !== undefined),
      // Rows holding wrapped cells among the edits and recalculated results
      // are re-measured once the new values are in place.
      wrapped = formatting.wrappedRows(book, [
        ...edits,
        ...result.results.map(({ sheetId, ref }) => ({ sheetId, ref })),
      ]),
      headChange = linkEdits || wrapped.size > 0 || pivots !== undefined,
      headBefore = headChange ? captureHead(book) : undefined,
      snapshotBefore = book.snapshot,
      selectionBefore = { sheetId, ...grid.selection };
    for (const edit of edits) {
      const sheet = book.sheets.find((s) => s.id === edit.sheetId);
      if (edit.cell === null) delete sheet.cells[edit.ref];
      else sheet.cells[edit.ref] = edit.cell;
      touchPreview(sheet.cells, edit.ref);
    }
    // Rich-paste links are published with their cells, in the same history
    // entry (sheet links are part of the captured head).
    if (linkEdits)
      book.sheets = book.sheets.map((sheet) =>
        applyLinkEdits(
          sheet,
          edits.filter((edit) => edit.sheetId === sheet.id),
        ),
      );
    for (const r of result.results)
      book.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    if (pivots !== undefined) {
      if (pivots.length) book.pivots = pivots;
      else delete book.pivots;
    }
    // Wrapped cells resize their rows in the same history entry.
    if (wrapped.size) book = formatting.withRowHeights(book, wrapped);
    const headAfter = headChange ? captureHead(book) : undefined;
    book.snapshot = result.snapshot;
    trustSnapshot();
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
    persistence.changed(
      cellEdits(refs),
      headChange ? { head: headAfter } : undefined,
    );
    history.record({
      before,
      after: captureCells(book, refs),
      ...(headChange ? { headBefore, headAfter } : {}),
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
        transient
          ? `Pivot table not updated: ${error.message} Your previous work is retained.`
          : `${error.message} ${pendingEdits.some((edit) => edit.range) ? "The attempted range is retained; use Retry pending range or Save a copy." : "Your attempted edit remains in the form; retry Apply edit."}`,
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
// Typing into an empty cell's value field picks a type, as typing in the grid does.
function inferType(text) {
  return text.startsWith("=")
    ? "formula"
    : /^[0-9.+-]/.test(text)
      ? "number"
      : "text";
}
$("cell-value").addEventListener("input", () => {
  if ($("cell-type").value === "blank" && $("cell-value").value)
    $("cell-type").value = inferType($("cell-value").value);
});
// The name box takes a cell or a range (B4 or B4:D20, active cell first).
$("cell-address").addEventListener("change", () => {
  try {
    const text = $("cell-address").value.trim().toUpperCase();
    if (text.includes(":")) {
      const [from, to] = text.split(":");
      parseAddress(from);
      parseAddress(to);
      grid.selectRange(to, from);
      choose(from, false);
    } else {
      parseAddress(text);
      choose(text);
    }
  } catch (error) {
    status(error.message);
  }
});
$("cancel").onclick = () => {
  const operation = loading?.operation;
  revisions.cancel();
  loading?.abort();
  loading = null;
  session?.dispose();
  session = null;
  render();
  status(
    operation
      ? `${operation === "structure" ? "Row/column" : operation === "dropdown" ? "Dropdown" : operation === "conditional" ? "Conditional formatting" : operation === "pivot" ? "Pivot table" : "Sheet"} operation cancelled. Your previous work is retained.`
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
  return applyLayout(command, true);
}
async function applyLayout(command, structural = false) {
  if (loading) return;
  const label = structural ? "Row/column" : "Sheet",
    epoch = revisions.begin();
  try {
    if (structural) validateStructure(command, book);
    else organizeWorkbook(book, command);
    loading = new AbortController();
    loading.operation = structural ? "structure" : "sheet";
    render();
    status(
      `Updating ${structural ? "row/column" : "sheet"} references and recalculating…`,
    );
    if (!session) {
      session = new EngineClient(config, $("worker-source").textContent);
      await session.load(book);
    }
    if (!revisions.current(epoch)) return;
    // The worker validates and shifts pivots with the canonical definitions.
    await session.configurePivots(book.pivots ?? []);
    if (!revisions.current(epoch)) return;
    const result =
      await session[structural ? "structure" : "organize"](command);
    if (!revisions.current(epoch)) return;
    const before = captureCells(book, result.beforeRefs),
      headBefore = captureHead(book),
      snapshotBefore = book.snapshot,
      selectionBefore = { sheetId, ...grid.selection },
      priorRestoration = cellEdits(pendingEdits),
      next = structural
        ? shiftWorkbook(book, command)
        : organizeWorkbook(book, command);
    for (const f of result.formulas) {
      const cells = next.sheets.find((s) => s.id === f.sheetId).cells;
      cells[f.ref] = { ...cells[f.ref], formula: f.formula };
    }
    for (const r of result.results)
      next.sheets.find((s) => s.id === r.sheetId).cells[r.ref].result =
        r.result;
    next.snapshot = result.snapshot;
    book = next;
    if (structural) pivots.structure(command, "do");
    trustSnapshot();
    pendingEdits = [];
    const after = captureCells(book, result.formulas),
      headAfter = captureHead(book);
    history.record({
      structure: structural ? command : undefined,
      before,
      after,
      headBefore,
      headAfter,
      snapshotBefore,
      snapshotAfter: book.snapshot,
      selectionBefore,
      selectionAfter:
        command.type === "create"
          ? { sheetId: command.id, anchor: "A1", focus: "A1" }
          : selectionBefore,
      calculate: true,
    });
    persistence.changed(cellEdits(result.formulas), {
      beforeEdits: priorRestoration,
      structure: structural ? command : undefined,
      head: headAfter,
    });
    if (command.type === "create") {
      sheetId = command.id;
      choose("A1");
    }
    render();
    choose(selected, false);
    status(`${label} references updated. Unsaved changes.`);
    return true;
  } catch (error) {
    if (revisions.current(epoch)) {
      session?.dispose();
      session = null;
      status(
        `${label} operation not applied: ${error.message}. Your previous work is retained.`,
      );
    }
  } finally {
    if (revisions.current(epoch)) {
      loading = null;
      render();
    }
  }
}
async function moveHistory(direction) {
  if (loading) return;
  const priorRestoration = cellEdits(pendingEdits);
  const moved = history[direction](book);
  if (!moved) return;
  if (moved.structure) pivots.structure(moved.structure, direction);
  const epoch = revisions.begin();
  pendingEdits = [];
  if (moved.selection) {
    sheetId = moved.selection.sheetId;
    grid.select(moved.selection.anchor, { notify: false });
    grid.select(moved.selection.focus, { extend: true, notify: false });
    choose(moved.selection.focus, false);
  }
  for (const edit of moved.edits) {
    const cells = book.sheets.find((s) => s.id === edit.sheetId)?.cells;
    if (cells) touchPreview(cells, edit.ref);
  }
  persistence.changed(cellEdits(moved.edits), {
    beforeEdits: priorRestoration,
    structure: moved.structure,
    head: moved.head,
  });
  // Restore canonical known state immediately, then recalculate in the same adapter.
  if (!moved.calculate) {
    if (session && moved.head) {
      loading = new AbortController();
      render();
      try {
        await session.configureValidations({
          validations: book.validations,
          scenario: book.scenario,
        });
      } catch {
        session?.dispose();
        session = null;
      } finally {
        if (revisions.current(epoch)) loading = null;
      }
      if (!revisions.current(epoch)) return;
    }
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
    trustSnapshot();
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
// Publishes an engine-free presentation change as one history entry: cell
// transforms over refs of the current sheet and, optionally, new fields for
// that sheet (row/column styles and sizes, links).
function publishPresentation({
  refs = [],
  transform = (cell) => cell,
  // covers(ref): pending attempts in the selection that committed refs miss.
  covers,
  // link: {ref, value} also updates a pending pasted link on that cell.
  link,
  sheetPatch,
  bookPatch,
  // reshape(book): a final pass over the next workbook (row heights).
  reshape,
  label = "Formatting",
}) {
  if (loading) return false;
  try {
    const sheet = book.sheets.find((s) => s.id === sheetId),
      r = grid.selection,
      edits = [];
    for (const ref of refs) {
      const original = sheet.cells[ref] ?? {},
        cell = transform(original, ref);
      // Unchanged cells stay out of the history entry.
      if (cell === original) continue;
      validateCell(cell, book);
      edits.push({ sheetId, ref, cell });
    }
    // A pending (uncalculated) attempt receives the same formatting change
    // applied to its own fields, so its pasted style or link is never replaced.
    const targets = new Set(refs),
      pending = pendingEdits
        .filter(
          (attempt) =>
            attempt.sheetId === sheetId &&
            attempt.cell !== null &&
            (targets.has(attempt.ref) || covers?.(attempt.ref)),
        )
        .map((attempt) => [attempt, transform(attempt.cell, attempt.ref)]);
    const pendingLinks = link
      ? pendingEdits.filter(
          (attempt) =>
            attempt.sheetId === sheetId &&
            attempt.ref === link.ref &&
            attempt.link !== undefined,
        )
      : [];
    for (const [, cell] of pending) validateCell(cell, book);
    if (
      !edits.length &&
      !pending.length &&
      !pendingLinks.length &&
      !sheetPatch &&
      !bookPatch
    ) {
      status(`${label}: nothing to change.`);
      return true;
    }
    let next = null,
      fields = null;
    if (sheetPatch) {
      next = { ...sheet };
      for (const [key, value] of Object.entries(sheetPatch(sheet)))
        if (value === undefined) delete next[key];
        else next[key] = value;
      validateAxes(next);
      validateSheetLinks(next, new Set(book.sheets.map((s) => s.id)));
      // The saved draft overlays pending pasted links: count them too. The
      // canonical map is checked on its own above as well, because it is
      // what remains if the pending attempt is discarded.
      const draft = new Set(Object.keys(next.links ?? {}));
      for (const attempt of pendingEdits)
        if (attempt.sheetId === sheetId && attempt.link !== undefined)
          if (pendingLinks.includes(attempt)) continue;
          else if (attempt.link) draft.add(attempt.ref);
          else draft.delete(attempt.ref);
      if (draft.size > MAX_LINKS_PER_SHEET)
        throw new Error("the sheet would exceed 10,000 links");
    }
    // Workbook fields (theme, font, locale); undefined removes one.
    if (bookPatch) {
      fields = bookPatch(book);
      validateBookFields(fields);
    }
    const changesHead = !!(next || fields),
      before = captureCells(book, edits),
      headBefore = changesHead ? captureHead(book) : undefined,
      selection = { sheetId, ...r };
    if (next)
      book = {
        ...book,
        sheets: book.sheets.map((s) => (s.id === sheetId ? next : s)),
      };
    if (fields) {
      book = { ...book };
      for (const [key, value] of Object.entries(fields))
        if (value === undefined) delete book[key];
        else book[key] = value;
    }
    if (reshape) book = reshape(book);
    const cells = (next ?? sheet).cells;
    for (const edit of edits) {
      // Clearing leaves no empty cell entry behind.
      if (Object.keys(edit.cell).length) cells[edit.ref] = edit.cell;
      else delete cells[edit.ref];
      touchPreview(cells, edit.ref);
    }
    for (const [attempt, cell] of pending) attempt.cell = cell;
    for (const attempt of pendingLinks) attempt.link = link.value;
    const headAfter = changesHead ? captureHead(book) : undefined;
    history.record({
      before,
      after: captureCells(book, edits),
      ...(changesHead ? { headBefore, headAfter } : {}),
      snapshotBefore: book.snapshot,
      snapshotAfter: book.snapshot,
      selectionBefore: selection,
      selectionAfter: selection,
      calculate: false,
    });
    persistence.changed(
      cellEdits(edits),
      changesHead ? { head: headAfter } : undefined,
    );
    render();
    status(`${label} changed. Unsaved changes.`);
    return true;
  } catch (error) {
    status(`${label} not applied: ${error.message}`);
    return false;
  }
}
function formatSelection(transform) {
  try {
    return publishPresentation({ refs: formatting.targetRefs(), transform });
  } catch (error) {
    status(`Formatting not applied: ${error.message}`);
  }
}
const selectedCell = () =>
  book.sheets.find((s) => s.id === sheetId).cells[selected] ?? {};
// Currency formats keep a cell's own currency; new ones use EUR, as before.
const currencyOf = (cell) => cell.format?.currency ?? "EUR";
const negativeDefault = (kind) =>
  kind === "accounting" ? "parentheses" : "minus";
// Keeps only the options a kind accepts (FORMAT.md number formats).
function setNumberFormat({
  kind,
  digits,
  currency,
  dateStyle,
  scale,
  negative,
}) {
  const money = ["currency", "accounting"].includes(kind);
  formatSelection((cell) => ({
    ...cell,
    format: {
      kind,
      ...(digits === undefined || kind === "date" ? {} : { digits }),
      ...(money ? { currency: currency ?? currencyOf(cell) } : {}),
      ...(kind === "date" && dateStyle === "long" ? { dateStyle } : {}),
      ...(scale && (kind === "number" || money) ? { scale } : {}),
      // Stored when it differs from the kind's default sign policy
      // (parentheses for accounting, minus otherwise).
      ...(negative &&
      negative !== negativeDefault(kind) &&
      (money || kind === "number" || kind === "percent")
        ? { negative }
        : {}),
    },
  }));
}
function changeDecimals(delta) {
  formatSelection((cell) => {
    const kind =
      !cell.format || cell.format.kind === "general"
        ? "number"
        : cell.format.kind;
    if (kind === "date") return cell;
    return {
      ...cell,
      format: {
        ...cell.format,
        kind,
        digits: Math.max(
          0,
          Math.min(15, (cell.format?.digits ?? (delta > 0 ? 0 : 2)) + delta),
        ),
      },
    };
  });
}
function openNumberFormat() {
  const format = selectedCell().format ?? { kind: "general" };
  $("format-kind").value = format.kind;
  $("format-digits").value = format.digits ?? 2;
  $("format-currency").value = currencyOf(selectedCell());
  $("format-date-style").value = format.dateStyle ?? "short";
  $("format-scale").value = format.scale ?? "";
  $("format-negative").value = format.negative ?? negativeDefault(format.kind);
  $("number-context").textContent =
    `Applies to ${grid.selection.anchor === grid.selection.focus ? grid.selection.focus : `${grid.selection.anchor}:${grid.selection.focus}`}. Values and formulas are unchanged.`;
  $("number-dialog").showModal();
  $("format-kind").focus();
}
$("format-apply").onclick = () => {
  if (!/^\d+$/.test($("format-digits").value.trim()))
    return status("Enter decimal places between 0 and 15.");
  $("number-dialog").close();
  setNumberFormat({
    kind: $("format-kind").value,
    digits: Number($("format-digits").value),
    currency: $("format-currency").value.toUpperCase(),
    dateStyle: $("format-date-style").value,
    scale: $("format-scale").value || undefined,
    negative: $("format-negative").value,
  });
  $("grid").focus();
};
$("format-cancel").onclick = () => $("number-dialog").close();

async function applyOrganization(command) {
  if (loading) return;
  if (["create", "rename"].includes(command.type)) return applyLayout(command);
  try {
    const next = organizeWorkbook(book, command),
      headBefore = captureHead(book),
      selection = { sheetId, ...grid.selection };
    book = next;
    const headAfter = captureHead(book);
    history.record({
      before: [],
      after: [],
      headBefore,
      headAfter,
      snapshotBefore: book.snapshot,
      snapshotAfter: book.snapshot,
      selectionBefore: selection,
      selectionAfter: selection,
      calculate: false,
    });
    persistence.changed([], { head: headAfter });
    render();
    status("Sheet groups updated. Unsaved changes.");
    return true;
  } catch (error) {
    status(`Sheet groups not changed: ${error.message}`);
  }
}
async function applyDefinitionHeader(next, label = "Dropdown settings") {
  if (loading) return;
  const epoch = revisions.begin();
  try {
    assertScenarioInputs(next, pendingEdits);
    const headBefore = captureHead(book),
      selection = { sheetId, ...grid.selection };
    loading = new AbortController();
    loading.operation =
      label === "Dropdown settings" ? "dropdown" : "conditional";
    render();
    if (session && label === "Dropdown settings")
      await session.configureValidations({
        validations: next.validations,
        scenario: next.scenario,
      });
    if (!revisions.current(epoch)) return;
    book = next;
    const headAfter = captureHead(book);
    history.record({
      before: [],
      after: [],
      headBefore,
      headAfter,
      snapshotBefore: book.snapshot,
      snapshotAfter: book.snapshot,
      selectionBefore: selection,
      selectionAfter: selection,
      calculate: false,
    });
    persistence.changed([], { head: headAfter });
    status(`${label} updated. Unsaved changes.`);
    return true;
  } catch (error) {
    if (revisions.current(epoch)) {
      session?.dispose();
      session = null;
      status(
        `${label} not applied: ${error.message}. Your previous work is retained.`,
      );
    }
  } finally {
    if (revisions.current(epoch)) {
      loading = null;
      render();
    }
  }
}
// ---- pivot tables (T17, ADR-014) ----
// Definitions without cell changes (a refresh that changes no value) are a
// header entry; everything else goes through apply() with the engine.
function publishPivots(next, message) {
  const headBefore = captureHead(book),
    selection = { sheetId, ...grid.selection };
  if (next.length) book.pivots = next;
  else delete book.pivots;
  const headAfter = captureHead(book);
  history.record({
    before: [],
    after: [],
    headBefore,
    headAfter,
    snapshotBefore: book.snapshot,
    snapshotAfter: book.snapshot,
    selectionBefore: selection,
    selectionAfter: selection,
    calculate: false,
  });
  persistence.changed([], { head: headAfter });
  render();
  status(message);
  return true;
}
const pivotBusy = () =>
  pendingEdits.length
    ? "Apply or discard the attempted edit before changing a pivot table."
    : null;
// Refreshes one pivot, optionally with a new definition (also a new pivot).
// The worker recalculates and aggregates; ownership is checked here against
// the canonical workbook, then the cells and definition publish together.
async function refreshPivot(id, definition) {
  if (loading) return;
  const blocked = pivotBusy();
  if (blocked) return void status(blocked);
  const previous = book.pivots?.find((p) => p.id === id),
    target = structuredClone(definition ?? previous),
    epoch = revisions.begin();
  // Only failures after engine work discard the session.
  let engineWork = false;
  try {
    if (!target) throw new Error("Unknown pivot table.");
    // A moved anchor releases the old range; the new one starts at the anchor.
    if (previous && definition) {
      const anchor = (ref) => ref.split(":")[0];
      if (
        previous.output.sheetId !== target.output.sheetId ||
        anchor(previous.output.ref) !== anchor(target.output.ref)
      )
        target.output = { ...target.output, ref: anchor(target.output.ref) };
      else target.output = { ...previous.output };
    }
    const others = (book.pivots ?? []).filter((p) => p.id !== id);
    validatePivots({ ...book, pivots: [...others, target] });
    pivots.check(target, {
      formulaResultsCurrent:
        !!book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint),
    });
    loading = new AbortController();
    loading.operation = "pivot";
    render();
    status("Refreshing pivot table: recalculating its source…");
    engineWork = true;
    if (!session) {
      session = new EngineClient(config, $("worker-source").textContent);
      await session.load(book);
    }
    if (!revisions.current(epoch)) return;
    let computed;
    try {
      computed = await session.pivot(target);
    } catch (error) {
      // Definition and size errors leave the engine usable.
      if (!error.message.startsWith(PIVOT_ERROR)) throw error;
      throw Object.assign(new Error(error.message.slice(PIVOT_ERROR.length)), {
        keepSession: true,
      });
    }
    if (!revisions.current(epoch)) return;
    const result = (() => {
      try {
        return pivotEdits(book, target, computed, {
          previous,
          fingerprint: computed.fingerprint,
          at: new Date().toISOString(),
        });
      } catch (error) {
        throw Object.assign(error, { keepSession: true });
      }
    })();
    const next = previous
        ? book.pivots.map((p) => (p.id === id ? result.pivot : p))
        : [...(book.pivots ?? []), result.pivot],
      anchor = result.pivot.output.ref.split(":")[0],
      done = `Pivot table "${pivotLabel(result.pivot)}" refreshed from ${computed.records.toLocaleString("en-US")} records. Unsaved changes.`;
    loading = null;
    const applied = await apply({
      edits: result.edits,
      pivots: next,
      owner: id,
      transient: true,
      selectionAfter: {
        sheetId: result.pivot.output.sheetId,
        anchor,
        focus: anchor,
      },
    });
    if (applied) {
      status(done);
      dispatchEvent(
        new CustomEvent("html-data:pivot", {
          detail: {
            pivotMS: computed.pivotMS,
            records: computed.records,
            outputCells: computed.width * computed.height,
            edits: result.edits.length,
          },
        }),
      );
    }
    return applied;
  } catch (error) {
    if (revisions.current(epoch)) {
      if (engineWork && !error.keepSession) {
        session?.dispose();
        session = null;
      }
      status(
        `Pivot table not refreshed: ${error.message} Your previous work is retained.`,
      );
    }
  } finally {
    if (revisions.current(epoch) && loading?.operation === "pivot") {
      loading = null;
      render();
    }
  }
}
async function refreshAllPivots() {
  for (const { id } of [...(book.pivots ?? [])])
    if (!(await refreshPivot(id))) return false;
  return true;
}
// Removes a definition and the values it wrote; direct formatting stays.
async function deletePivot(id) {
  if (loading) return;
  const blocked = pivotBusy();
  if (blocked) return void status(blocked);
  const pivot = book.pivots?.find((p) => p.id === id);
  if (!pivot) return;
  const next = book.pivots.filter((p) => p.id !== id),
    edits = pivotRemovalEdits(book, pivot),
    done = `Pivot table "${pivotLabel(pivot)}" deleted. Unsaved changes.`;
  if (!edits.length) return publishPivots(next, done);
  const applied = await apply({
    edits,
    pivots: next,
    owner: id,
    transient: true,
    selectionAfter: { sheetId, ...grid.selection },
  });
  if (applied) status(done);
  return applied;
}
const pivots = setupPivots({
  getBook: () => book,
  getSheetId: () => sheetId,
  getSelection: () => grid.selection,
  getStates: () => pivotStates,
  isSnapshotCurrent: () =>
    !!book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint),
  getRevision: () => persistence.revision,
  busy: () => !!loading,
  refresh: refreshPivot,
  remove: deletePivot,
  status,
});
const navigation = setupSheetNavigation($("sheet-tabs"), {
  getBook: () => book,
  getSheetId: () => sheetId,
  busy: () => !!loading,
  select: (id) => {
    sheetId = id;
    render();
    choose(selected);
  },
  apply: applyOrganization,
  status,
});
const dropdowns = setupDropdowns({
  getBook: () => book,
  getSheetId: () => sheetId,
  getSelection: () => grid.selection,
  busy: () => !!loading,
  isSnapshotCurrent: () =>
    !!book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint),
  apply,
});
const dropdownSettings = setupDropdownSettings({
  getBook: () => book,
  getSheetId: () => sheetId,
  getSelection: () => grid.selection,
  busy: () => !!loading,
  apply: applyDefinitionHeader,
  status,
});
const conditionalSettings = setupConditionalSettings({
  getBook: () => book,
  getSheetId: () => sheetId,
  getSelection: () => grid.selection,
  busy: () => !!loading,
  apply: (next) => applyDefinitionHeader(next, "Conditional formatting"),
  status,
});
const clipboard = setupClipboard({
  getBook: () => book,
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  getSelection: () => grid.selection,
  busy: () => !!loading,
  apply,
  status,
  cancel: () => $("cancel").click(),
});
let gridLines = true;
const idle = () => !loading,
  register = (id, run, enabled = idle) => commands.register(id, run, enabled);
register(
  "save",
  () => persistence.saveDirect(),
  () => persistence.canSaveDirect,
);
register(
  "save-copy",
  () => persistence.saveCopy(),
  () => true,
);
register(
  "undo",
  () => moveHistory("undo"),
  () => idle() && history.canUndo,
);
register(
  "redo",
  () => moveHistory("redo"),
  () => idle() && history.canRedo,
);
register("paste-table", () => clipboard.open());
register("fill-down", () => clipboard.fill("down"));
register("fill-right", () => clipboard.fill("right"));
for (const axis of ["row", "column"])
  for (const action of ["insert", "delete"])
    register(`${action}-${axis}s`, () => applyStructure(axis, action));
register("new-sheet", () => navigation.open());
register("manage-sheets", () => navigation.open());
register("select-sheet", (id) => {
  sheetId = id;
  render();
  choose(selected);
});
register("number-format", setNumberFormat);
register("number-format-dialog", openNumberFormat);
register("decimals-more", () => changeDecimals(1));
register("decimals-less", () => changeDecimals(-1));
register("cell-style", (cellStyle) =>
  formatSelection((cell) => ({ ...cell, cellStyle })),
);
// Clears cell style, number format and direct formatting (and row or column
// styles for whole rows or columns); values, links and sizes stay.
register("clear-formatting", () => formatting.clear());
const formatting = setupFormatting({
  getBook: () => book,
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  grid,
  busy: () => !!loading,
  status,
  publish: publishPresentation,
  getPending: () => pendingEdits,
  // Internal links select their target sheet and range.
  locate: (target, range) => {
    if (!book.sheets.some((s) => s.id === target))
      return status("This link's sheet no longer exists.");
    sheetId = target;
    render();
    grid.selectRange(
      address(range.bottom, range.right),
      address(range.top, range.left),
    );
    choose(grid.selection.focus, false);
    $("grid").focus();
  },
});
for (const name of ["bold", "italic"])
  register(name, () => formatting.toggle(name));
register("text-color", (token) => formatting.color("text", token));
register("fill-color", (token) => formatting.color("fill", token));
register("borders", (spec) => formatting.borders(spec));
register("align", (value) => formatting.align(value));
register("wrap", () => formatting.wrap());
register("column-width", (px) => formatting.columnWidth(px));
register("auto-fit", () => formatting.autoFit());
register("copy-style", () => {
  formatting.startPainter();
  commands.changed();
});
register("link", (link) =>
  formatting.setLink(grid.selection.focus, link ?? null),
);
register("open-link", () => {
  const link = book.sheets.find((s) => s.id === sheetId).links?.[
    grid.selection.focus
  ];
  if (link) formatting.openLink(link);
});
// Download PNG of the selection (F06): drawn from the model without the
// engine; stale saved results or a pending edit add a warning band.
const picture = setupPicture({
  getBook: () => book,
  getSheet: () => book.sheets.find((s) => s.id === sheetId),
  getSelection: () => grid.selection,
  decorate: decorateCell,
  isStale: (formulas) =>
    pendingEdits.length > 0 ||
    (formulas &&
      !(book.snapshot && verifiedSnapshots.has(book.snapshot.fingerprint))),
  status,
});
register("download-png", () => picture.download());
register("conditional-formatting", () => conditionalSettings.open());
register(
  "pivot-tables",
  () => shell.openPanel("pivot"),
  () => true,
);
register("insert-pivot", () => {
  pivots.create();
  shell.openPanel("pivot");
});
register(
  "refresh-pivots",
  () => refreshAllPivots(),
  () => idle() && !!book.pivots?.length,
);
register("dropdown-settings", () => dropdownSettings.open());
register("recalculate", () => apply({ recalculateOnly: true }));
register(
  "grid-lines",
  () => {
    gridLines = !gridLines;
    $("grid").classList.toggle("no-grid-lines", !gridLines);
    commands.changed();
  },
  () => true,
);
register(
  "help",
  (section) => {
    const dialog = $("help-dialog");
    for (const details of dialog.querySelectorAll("details"))
      details.open = details.dataset.section === section;
    dialog.showModal();
    dialog.querySelector(`[data-section="${section}"] summary`)?.focus();
  },
  () => true,
);
// Theme, font and display locale are workbook fields: undoable, engine-free.
// Font and locale change the text of wrapped cells: their rows are
// re-measured with the new font in the same history entry.
const remeasure = (next) => {
  $("grid").style.fontFamily = FONTS[next.font] ?? "";
  const rows = formatting.allWrappedRows(next);
  return rows.size ? formatting.withRowHeights(next, rows) : next;
};
const setField = (key, label) => (value) =>
  publishPresentation({
    label,
    bookPatch: () => ({ [key]: value === "document" ? undefined : value }),
    reshape: key === "theme" ? undefined : remeasure,
  });
register("theme", setField("theme", "Theme"));
register("font", setField("font", "Font"));
register("locale", setField("locale", "Regional settings"));
// The document's own charte colours, read before any built-in overlay.
delete document.documentElement.dataset.theme;
const documentColours = Object.fromEntries(
  ["ink", "acc", "mid", "lig", "alert"].map((token) => [
    token,
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--${token}`)
      .trim(),
  ]),
);
// Mounted after persistence fingerprints the opened file's shell.
const shell = mountShell({
  commands,
  panels: {
    pivot: () => ({
      title: "Pivot tables",
      subtitle: "Rows, columns, filters and totals from a source range",
      body: () => pivots.body(),
    }),
  },
  state: () => {
    const cell = selectedCell(),
      currency = currencyOf(cell);
    return {
      format: cell.format,
      cellStyle: cell.cellStyle ?? "normal",
      currencySymbol:
        new Intl.NumberFormat(book.locale, { style: "currency", currency })
          .formatToParts(0)
          .find((part) => part.type === "currency")?.value ?? currency,
      gridLines,
      busy: !!loading,
      style: formatting.current(),
      painting: formatting.painting(),
      address:
        grid.selection.anchor === grid.selection.focus
          ? grid.selection.focus
          : `${grid.selection.anchor}:${grid.selection.focus}`,
      theme: book.theme ?? "document",
      font: book.font ?? "document",
      locale: book.locale,
      documentColours,
      link:
        book.sheets.find((s) => s.id === sheetId).links?.[
          grid.selection.focus
        ] ?? null,
      sheetId,
      sheets: book.sheets.map((s) => ({ id: s.id, name: s.name })),
      columnWidth: formatting.widthOf(
        parseAddress(grid.selection.focus).column,
      ),
      groups: groupView(book).map((group) => ({
        name: group.name,
        sheets: group.sheetIds.map((id) => ({
          id,
          name: book.sheets.find((s) => s.id === id).name,
          current: id === sheetId,
        })),
      })),
    };
  },
});
render();
choose(selected);
const initialRevision = revisions.revision;
let fallbackInspection = false;
const initialState = await persistence.initialSnapshot.catch(() => {
  fallbackInspection = true;
  return snapshotState(book);
});
if (revisions.current(initialRevision)) {
  if (initialState.state === "current") trustSnapshot();
  if (fallbackInspection) persistence.refreshConditionalScales();
  dropdowns.draw();
  grid.draw();
  drawCalculationState();
  status(
    initialState.state === "current"
      ? "Saved results are current."
      : "Saved results are stale or missing. Apply an edit to recalculate.",
  );
}
