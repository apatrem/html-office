// Pivot table panel (T17, ADR-014): edits one definition at a time as a draft.
// Update applies it and refreshes in one undoable step; Refresh follows the
// source; Delete removes the pivot and its values. The panel lives in the
// shell's side drawer and renders itself.
import { h } from "../../shared/shell/dom.mjs";
import { field } from "../../shared/shell/dialogs.mjs";
import {
  AGGREGATES,
  MAX_COLUMN_FIELDS,
  MAX_FILTERS,
  MAX_MEASURES,
  MAX_ROW_FIELDS,
  checkPivot,
  fieldItems,
  itemKey,
  pivotLabel,
  resolveSource,
} from "../model/pivot.mjs";
import { address, parseAddress, parseRange } from "../model/workbook.mjs";
import { display, usedBounds } from "./view.mjs";
import { shiftRange } from "../model/structure.mjs";

const AGGREGATE_NAMES = { sum: "Sum", count: "Count", average: "Average" };
const STATE_TEXT = {
  current: "Up to date with its source.",
  stale:
    "Out of date: the source or the definition changed since the last refresh. Refresh to follow it.",
  unverified:
    "The source holds formulas whose saved results are not verified. Refresh recalculates them.",
  never: "Not refreshed yet.",
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rangeText = (r) =>
  r.top === r.bottom && r.left === r.right
    ? address(r.top, r.left)
    : `${address(r.top, r.left)}:${address(r.bottom, r.right)}`;

export function setupPivots({
  getBook,
  getSheetId,
  getSelection,
  getStates,
  isSnapshotCurrent = () => false,
  getRevision = () => 0,
  busy,
  refresh,
  remove,
  status,
}) {
  // The grid's cached used bounds stand in for a whole-sheet scan; header
  // and filter values that are formulas need verified results.
  const sources = () => ({
    bounds: usedBounds,
    formulaResultsCurrent: isSnapshotCurrent(),
  });
  let root = null,
    // The definition being edited; `fresh` until it differs from the saved one.
    draft = null,
    saved = null,
    fresh = true,
    lastKey = "",
    // Set while rendering filters whose items cannot be listed yet.
    filterProblem = null;
  // Draft references before and after each structural shift, for undo.
  const moves = [];
  const pivotsOf = () => getBook().pivots ?? [];
  function select(id) {
    moves.length = 0;
    saved = pivotsOf().find((p) => p.id === id) ?? null;
    draft = saved ? structuredClone(saved) : null;
    fresh = true;
  }
  function edit(change) {
    change(draft);
    fresh = false;
    render();
  }
  // A new draft from the selection: a range becomes the source and the
  // output goes two columns to its right; a single cell takes the whole sheet
  // and writes below the used range of the next sheet.
  function create() {
    const book = getBook(),
      sheetId = getSheetId(),
      s = getSelection(),
      ids = new Set(pivotsOf().map((p) => p.id));
    let n = 1;
    while (ids.has(`pivot${n}`)) n++;
    let source, output;
    if (s.top === s.bottom && s.left === s.right) {
      source = { sheetId };
      const other =
        book.sheets.find((x) => x.id !== sheetId) ??
        book.sheets.find((x) => x.id === sheetId);
      let bottom = 0;
      for (const [ref, cell] of Object.entries(other.cells))
        if (cell.input || cell.formula)
          bottom = Math.max(bottom, parseAddress(ref).row);
      output = { sheetId: other.id, ref: `B${bottom + 2}` };
    } else {
      source = { sheetId, ref: rangeText(s) };
      output = {
        sheetId,
        ref: address(s.top, Math.min(16384, s.right + 2)),
      };
    }
    draft = {
      id: `pivot${n}`,
      name: `Pivot table ${n}`,
      source,
      output,
      rows: [],
      columns: [],
      filters: [],
      values: [],
    };
    // Proposes the first text field as rows and the first number as a sum.
    try {
      const resolved = resolveSource(book, draft, sources()),
        first = (column) => {
          const cell =
            resolved.sheet.cells[address(resolved.rect.top + 1, column)];
          return cell?.formula ? cell.result : cell?.input;
        },
        labels = [...resolved.labels].filter(
          ([name]) => !resolved.duplicates.has(name),
        ),
        row = labels.find(([, c]) => first(c)?.type === "text"),
        value = labels.find(
          ([name, c]) => name !== row?.[0] && first(c)?.type === "number",
        );
      if (row) draft.rows = [row[0]];
      draft.values = [
        value
          ? { field: value[0], aggregate: "sum" }
          : { field: (row ?? labels[0])[0], aggregate: "count" },
      ];
    } catch {
      // The panel shows why the source cannot be read.
    }
    saved = null;
    fresh = false;
    moves.length = 0;
    render();
  }
  // Labels of the draft source, or the reason it cannot be read.
  function sourceFields() {
    try {
      const source = resolveSource(getBook(), draft, sources());
      return {
        names: [...source.labels.keys()].filter(
          (name) => !source.duplicates.has(name),
        ),
        rect: source.rect,
      };
    } catch (error) {
      return { names: [], error: error.message };
    }
  }
  const sheetSelect = (label, value, onChange, key) =>
    field(
      label,
      h(
        "select",
        {
          "data-pk": key,
          onchange: (event) => onChange(event.target.value),
        },
        getBook().sheets.map((sheet) =>
          h(
            "option",
            { value: sheet.id, selected: sheet.id === value },
            sheet.name,
          ),
        ),
      ),
    );
  function fieldSelect(label, names, value, onChange, key) {
    const options = names.includes(value) ? names : [value, ...names];
    return h(
      "select",
      {
        "aria-label": label,
        "data-pk": key,
        onchange: (event) => onChange(event.target.value),
      },
      options.map((name) =>
        h(
          "option",
          { value: name, selected: name === value },
          names.includes(name) ? name : `${name} (missing)`,
        ),
      ),
    );
  }
  const removeButton = (label, onClick, key) =>
    h(
      "button",
      {
        type: "button",
        class: "sh-b sh-t sh-ghost",
        "aria-label": label,
        title: label,
        "data-pk": key,
        onclick: onClick,
      },
      "Remove",
    );
  const addButton = (label, onClick, disabled, key) =>
    h(
      "button",
      {
        type: "button",
        class: "sh-b sh-t sh-ghost",
        disabled: disabled || null,
        "data-pk": key,
        onclick: onClick,
      },
      label,
    );
  // The first unused field name, for a new row, column or filter.
  function unused(names) {
    const taken = new Set([
      ...draft.rows,
      ...draft.columns,
      ...draft.filters.map((f) => f.field),
    ]);
    return names.find((name) => !taken.has(name));
  }
  function itemText(value) {
    if (value.type === "blank") return "(blank)";
    if (value.type === "text" && value.value === "") return "(empty text)";
    return display(
      {
        input: value,
        ...(value.type === "date" ? { format: { kind: "date" } } : {}),
      },
      getBook().locale,
    );
  }
  function axisSection(key, title, max, names) {
    const list = draft[key],
      singular = key === "rows" ? "Row" : "Column";
    return [
      h("h3", {}, title),
      ...list.map((name, i) =>
        h(
          "div",
          { class: "pv-line" },
          fieldSelect(
            `${singular} field ${i + 1}`,
            names,
            name,
            (value) => edit((d) => (d[key][i] = value)),
            `${key}-${i}`,
          ),
          removeButton(
            `Remove ${singular.toLowerCase()} field ${i + 1}`,
            () => edit((d) => d[key].splice(i, 1)),
            `${key}-x-${i}`,
          ),
        ),
      ),
      addButton(
        `Add ${singular.toLowerCase()} field`,
        () => edit((d) => d[key].push(unused(names))),
        list.length >= max || !unused(names),
        `${key}-add`,
      ),
    ];
  }
  function filterSection(names) {
    return [
      h("h3", {}, "Filters"),
      ...draft.filters.map((filter, i) => {
        let listing;
        try {
          listing = fieldItems(getBook(), draft, filter.field, sources());
        } catch (error) {
          listing = { items: [], error: error.message };
        }
        if (listing.unresolved) {
          listing.error =
            "This column holds formulas whose results are not verified. Use Data › Recalculate, then choose the items to keep.";
          filterProblem ??= `Filter ${i + 1} needs current results to list its items.`;
        }
        const kept = new Set(filter.values.map(itemKey)),
          set = (values) =>
            edit((d) => (d.filters[i].values = structuredClone(values)));
        return h(
          "fieldset",
          { class: "pv-filter" },
          h("legend", {}, `Filter ${i + 1}`),
          h(
            "div",
            { class: "pv-line" },
            fieldSelect(
              `Filter field ${i + 1}`,
              names,
              filter.field,
              (value) =>
                edit((d) => {
                  d.filters[i] = { field: value, values: [] };
                  try {
                    d.filters[i].values = fieldItems(
                      getBook(),
                      d,
                      value,
                      sources(),
                    ).items;
                  } catch {
                    // Shown with the item list.
                  }
                }),
              `filters-${i}`,
            ),
            removeButton(
              `Remove filter ${i + 1}`,
              () => edit((d) => d.filters.splice(i, 1)),
              `filters-x-${i}`,
            ),
          ),
          listing.error
            ? h("p", { class: "sh-hint" }, listing.error)
            : h(
                "div",
                {
                  class: "pv-items",
                  role: "group",
                  "aria-label": `Items kept by filter ${i + 1}`,
                },
                listing.items.map((value, j) =>
                  h(
                    "label",
                    {},
                    h("input", {
                      type: "checkbox",
                      checked: kept.has(itemKey(value)) || null,
                      "data-pk": `filters-${i}-item-${j}`,
                      onchange: (event) =>
                        set(
                          event.target.checked
                            ? [...filter.values, value]
                            : filter.values.filter(
                                (v) => itemKey(v) !== itemKey(value),
                              ),
                        ),
                    }),
                    itemText(value),
                  ),
                ),
              ),
          listing.truncated
            ? h(
                "p",
                { class: "sh-hint" },
                "Only the first 1,000 items are listed.",
              )
            : null,
          h(
            "div",
            { class: "sh-prow" },
            addButton(
              "Keep all",
              () => set(listing.items),
              !!listing.error,
              `filters-all-${i}`,
            ),
            addButton("Keep none", () => set([]), false, `filters-none-${i}`),
          ),
        );
      }),
      addButton(
        "Add filter",
        () =>
          edit((d) => {
            const name = unused(names);
            d.filters.push({ field: name, values: [] });
            try {
              d.filters.at(-1).values = fieldItems(
                getBook(),
                d,
                name,
                sources(),
              ).items;
            } catch {
              // Shown with the item list.
            }
          }),
        draft.filters.length >= MAX_FILTERS || !unused(names),
        "filters-add",
      ),
    ];
  }
  function valueSection(names) {
    return [
      h("h3", {}, "Values"),
      ...draft.values.map((measure, i) =>
        h(
          "div",
          { class: "pv-line" },
          h(
            "select",
            {
              "aria-label": `Aggregate ${i + 1}`,
              "data-pk": `values-agg-${i}`,
              onchange: (event) =>
                edit((d) => (d.values[i].aggregate = event.target.value)),
            },
            AGGREGATES.map((aggregate) =>
              h(
                "option",
                { value: aggregate, selected: aggregate === measure.aggregate },
                AGGREGATE_NAMES[aggregate],
              ),
            ),
          ),
          fieldSelect(
            `Value field ${i + 1}`,
            names,
            measure.field,
            (value) => edit((d) => (d.values[i].field = value)),
            `values-${i}`,
          ),
          removeButton(
            `Remove value ${i + 1}`,
            () => edit((d) => d.values.splice(i, 1)),
            `values-x-${i}`,
          ),
        ),
      ),
      addButton(
        "Add value",
        () => edit((d) => d.values.push({ field: names[0], aggregate: "sum" })),
        draft.values.length >= MAX_MEASURES || !names.length,
        "values-add",
      ),
    ];
  }
  function stateLine() {
    if (!saved) return "Not created yet. Create it to write the table.";
    const state = getStates()?.[saved.id];
    if (!state) return "Checking whether it is up to date…";
    const text =
      state.state === "error"
        ? `Cannot refresh: ${state.message}`
        : STATE_TEXT[state.state];
    return fresh ? text : `${text} The panel has changes not yet applied.`;
  }
  function render() {
    if (!root?.isConnected) return;
    // Text typed but not yet committed (change fires on leaving the field)
    // survives a rebuild of the panel.
    const active = root.contains(document.activeElement)
        ? document.activeElement
        : null,
      typing = active?.matches("input:not([type=checkbox])") && active.value,
      focused = active?.dataset?.pk,
      pivots = pivotsOf(),
      sheetId = getSheetId(),
      s = getSelection();
    const picker = field(
      "Pivot table",
      h(
        "select",
        {
          "data-pk": "pick",
          onchange: (event) => {
            if (event.target.value === "") create();
            else {
              select(event.target.value);
              render();
            }
          },
        },
        pivots.map((p) =>
          h(
            "option",
            { value: p.id, selected: !!saved && saved.id === p.id },
            `${pivotLabel(p)} — ${getBook().sheets.find((x) => x.id === p.output.sheetId).name}!${p.output.ref}`,
          ),
        ),
        h(
          "option",
          { value: "", selected: !!draft && !saved },
          draft && !saved
            ? `${draft.name || draft.id} (new)`
            : "New pivot table…",
        ),
      ),
    );
    if (!draft) {
      root.replaceChildren(
        picker,
        h(
          "p",
          { class: "sh-hint" },
          pivots.length
            ? "Choose a pivot table to edit it."
            : "No pivot tables yet. Select a range with a header row, then choose New pivot table.",
        ),
        h(
          "div",
          { class: "sh-prow" },
          addButton("New pivot table", create, busy(), "new"),
        ),
      );
      return;
    }
    const { names, error, rect } = sourceFields(),
      sourceRef = h("input", {
        value: draft.source.ref ?? "",
        placeholder: "Whole sheet",
        "data-pk": "source-ref",
        onchange: (event) =>
          edit((d) => {
            const text = event.target.value.trim().toUpperCase();
            if (text) d.source.ref = text;
            else delete d.source.ref;
          }),
      }),
      outputRef = h("input", {
        value: draft.output.ref.split(":")[0],
        "data-pk": "output-ref",
        onchange: (event) =>
          edit(
            (d) =>
              (d.output.ref =
                event.target.value.trim().toUpperCase() || d.output.ref),
          ),
      });
    filterProblem = null;
    const sections = [
      ...axisSection("rows", "Rows", MAX_ROW_FIELDS, names),
      ...axisSection("columns", "Columns", MAX_COLUMN_FIELDS, names),
      ...filterSection(names),
      ...valueSection(names),
    ];
    let problem = error ?? filterProblem;
    if (!problem)
      try {
        parseRange(draft.output.ref);
        checkPivot(getBook(), draft, sources());
        if (!draft.values.length) problem = "Add at least one value.";
      } catch (e) {
        problem = e.message;
      }
    const actions = h(
      "div",
      { class: "sh-prow" },
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-primary",
          disabled: busy() || !!problem || (fresh && !!saved) || null,
          "data-busy": problem || (fresh && saved) ? "blocked" : "idle",
          "data-pk": "apply",
          onclick: async () => {
            const id = draft.id;
            // Once applied, the panel shows the saved definition again.
            if (await refresh(id, structuredClone(draft))) {
              select(id);
              lastKey = "";
              draw();
            }
          },
        },
        saved ? "Update pivot table" : "Create pivot table",
      ),
      saved
        ? h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              disabled: busy() || null,
              "data-busy": "idle",
              "data-pk": "refresh",
              onclick: () => refresh(saved.id),
            },
            "Refresh",
          )
        : null,
      saved
        ? h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              disabled: busy() || null,
              "data-busy": "idle",
              "data-pk": "delete",
              onclick: () => remove(saved.id),
            },
            "Delete pivot table",
          )
        : h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              "data-pk": "discard",
              onclick: () => {
                select(pivots[0]?.id);
                render();
              },
            },
            "Discard",
          ),
    );
    root.replaceChildren(
      picker,
      h(
        "p",
        {
          class: "pv-state",
          role: "status",
          "data-state": saved ? (getStates()?.[saved.id]?.state ?? "") : "new",
        },
        stateLine(),
      ),
      field(
        "Name",
        h("input", {
          value: draft.name ?? "",
          maxlength: "120",
          "data-pk": "name",
          onchange: (event) =>
            edit((d) => {
              if (event.target.value.trim()) d.name = event.target.value.trim();
              else delete d.name;
            }),
        }),
      ),
      h("h3", {}, "Source"),
      sheetSelect(
        "Source sheet",
        draft.source.sheetId,
        (value) => edit((d) => (d.source = { sheetId: value })),
        "source-sheet",
      ),
      field("Source range (header row first)", sourceRef),
      h(
        "p",
        { class: "sh-hint" },
        rect
          ? `${rangeText(rect)}: ${names.length} fields, ${rect.bottom - rect.top} rows below the header.`
          : error,
      ),
      h(
        "div",
        { class: "sh-prow" },
        addButton(
          "Use selection as source",
          () => edit((d) => (d.source = { sheetId, ref: rangeText(s) })),
          false,
          "source-use",
        ),
      ),
      h("h3", {}, "Output"),
      sheetSelect(
        "Output sheet",
        draft.output.sheetId,
        (value) =>
          edit(
            (d) =>
              (d.output = { sheetId: value, ref: d.output.ref.split(":")[0] }),
          ),
        "output-sheet",
      ),
      field("Output top-left cell", outputRef),
      h(
        "div",
        { class: "sh-prow" },
        addButton(
          "Use active cell as output",
          () =>
            edit((d) => (d.output = { sheetId, ref: s.focus ?? rangeText(s) })),
          false,
          "output-use",
        ),
      ),
      ...sections,
      problem && h("p", { class: "sh-err pv-problem", role: "alert" }, problem),
      actions,
      h(
        "p",
        { class: "sh-hint" },
        "The pivot owns its output cells: edit it here, not in the grid. Refresh after source changes; nothing refreshes automatically.",
      ),
    );
    if (focused) {
      const next = root.querySelector(`[data-pk="${CSS.escape(focused)}"]`);
      if (next && typeof typing === "string" && next.matches("input"))
        next.value = typing;
      next?.focus();
    }
  }
  // Follows refreshes, undo and pivot states without discarding a draft
  // the user is editing.
  function draw() {
    if (!root?.isConnected) return;
    if (saved) {
      const current = pivotsOf().find((p) => p.id === saved.id);
      if (current !== saved) {
        if (!current) select(pivotsOf()[0]?.id);
        else {
          // A dirty draft takes committed changes (structural moves, a
          // refresh) of the fields it did not edit itself.
          if (!fresh)
            for (const key of Object.keys({ ...saved, ...current }))
              if (same(draft[key], saved[key]))
                if (current[key] === undefined) delete draft[key];
                else draft[key] = structuredClone(current[key]);
          saved = current;
          if (fresh) draft = structuredClone(current);
        }
      }
    } else if (draft && pivotsOf().some((p) => p.id === draft.id))
      select(draft.id);
    // A full render reads the source (a scan for whole-sheet sources); busy
    // and freshness changes only update the state line and buttons.
    // The refresh stamp alone does not change what the panel shows; result
    // verification does (filter items wait for it).
    const definition = saved && pivotsOf().find((p) => p.id === saved.id),
      key = JSON.stringify([
        pivotsOf().map((p) => p.id),
        saved?.id,
        getBook().sheets.map((x) => x.name),
        fresh,
        isSnapshotCurrent(),
        definition && { ...definition, refreshed: undefined },
        // Filter item lists follow every workbook change while shown.
        draft?.filters.length ? getRevision() : null,
      ]);
    if (key !== lastKey) {
      lastKey = key;
      return render();
    }
    const line = root.querySelector(".pv-state");
    if (line) {
      line.textContent = stateLine();
      line.dataset.state = saved
        ? (getStates()?.[saved.id]?.state ?? "")
        : "new";
    }
    for (const b of root.querySelectorAll("[data-busy]"))
      b.disabled = busy() || b.dataset.busy === "blocked";
  }
  // Row/column operations move the draft's references as they move the
  // committed definition's. A deletion can shrink a draft range; undoing it
  // restores the references the draft had before, rather than re-growing
  // them. A reference the user is still typing (invalid) is left alone.
  function structure(command, direction) {
    if (!draft) return;
    lastKey = "";
    const shift = (ref) => {
        try {
          return shiftRange(ref, command);
        } catch {
          return ref;
        }
      },
      undone = direction === "undo" ? moves.pop() : undefined,
      before = {},
      after = {};
    // Each reference is restored on its own: one edited since the shift is
    // moved by the inverse operation instead.
    for (const key of ["source", "output"]) {
      const value = draft[key];
      before[key] = JSON.stringify(value);
      if (undone && undone.after[key] === before[key])
        draft[key] = JSON.parse(undone.before[key]);
      else if (value.sheetId === command.sheetId && value.ref !== undefined)
        draft[key] = { ...value, ref: shift(value.ref) };
      after[key] = JSON.stringify(draft[key]);
    }
    if (direction !== "undo") moves.push({ before, after });
  }
  return {
    structure,
    body() {
      root = h("div", { class: "pv" });
      if (!draft || (saved && !pivotsOf().some((p) => p.id === saved.id)))
        select(pivotsOf()[0]?.id);
      lastKey = "";
      queueMicrotask(draw);
      return root;
    },
    draw,
    create,
    // Main-thread check before loading the engine (fields and source).
    check: (pivot, options) =>
      checkPivot(getBook(), pivot, { ...sources(), ...options }),
  };
}
