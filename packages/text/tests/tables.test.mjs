// T10 report tables in Node: every command on cell and text selections, merged cells, the table
// shape kept after each change, undo, and random command sequences that must always save as a
// valid file reopening identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { deleteSelection } from "prosemirror-commands";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import * as T from "../editor/tables.mjs";
import { setAlign } from "../editor/commands.mjs";
import { Fragment } from "prosemirror-model";
import { schema } from "../editor/schema/schema.mjs";
import { envelope, random } from "./generate.mjs";

const TABLE = `<figure class="table" id="tab-a">
<figcaption>Revenue</figcaption>
<table>
<colgroup><col data-width="40"><col data-width="30"><col data-width="30"></colgroup>
<thead>
<tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
<tr><th>2025</th><th>2026</th></tr>
</thead>
<tbody>
<tr><td>North</td><td>1.6</td><td>1.9</td></tr>
<tr><td>South</td><td>1.2</td><td>1.4</td></tr>
<tr class="total"><td>Total</td><td>2.8</td><td>3.3</td></tr>
</tbody>
</table>
</figure>`;

function editor(body = `<p>Intro</p>\n${TABLE}\n<p>After</p>`) {
  const file = parseFile(
    envelope(
      `<article id="doc" data-format="1" lang="en">\n${body}\n</article>`,
    ),
  );
  let state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [history(), T.tableEditing(), T.tableGuard(), subsetGuard()],
  });
  const dispatch = (tr) => (state = state.apply(tr));
  const view = {
    get state() {
      return state;
    },
    dispatch,
  };
  // Position of the cell (anchor) holding `text`.
  const cell = (text) => {
    let at = null;
    state.doc.descendants((node, pos) => {
      if (
        at === null &&
        node.type.spec.tableRole?.includes("cell") &&
        node.textContent === text
      )
        at = pos;
    });
    assert.notEqual(at, null, `cell "${text}"`);
    return at;
  };
  return {
    get state() {
      return state;
    },
    cell,
    // The caret in the cell holding `text`, or a cell selection from one cell to another.
    at(text) {
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, cell(text) + 1)),
      );
      return this;
    },
    cells(from, to) {
      dispatch(
        state.tr.setSelection(
          T.CellSelection.create(state.doc, cell(from), cell(to)),
        ),
      );
      return this;
    },
    run: (command) => command(state, dispatch, view),
    can: (command) => command(state),
    undo: () => undo(state, dispatch),
    // The table's lines, after checking that the file saves valid and reopens identically.
    table() {
      const saved = saveFile(file, state.doc);
      const report = validateFile(parseFile(saved));
      assert.deepEqual(report.errors, [], saved);
      assert.equal(report.protected.length, 0, saved);
      assert.ok(
        openFile(parseFile(saved)).doc.eq(state.doc),
        "reopens identically",
      );
      const html = articleHTML(state.doc);
      return html
        .slice(html.indexOf("<table"), html.indexOf("</table>") + 8)
        .split("\n");
    },
  };
}

test("insert a table: a header row and two body rows after the block, caret in the first cell", () => {
  const e = editor("<p>Intro</p>\n<p>After</p>");
  assert.ok(e.run(T.insertTable(3, 2)));
  assert.equal(
    articleHTML(e.state.doc),
    `<article id="doc" data-format="1" lang="en">
<p>Intro</p>
<figure class="table" id="tab-1">
<table>
<thead>
<tr><th></th><th></th></tr>
</thead>
<tbody>
<tr><td></td><td></td></tr>
<tr><td></td><td></td></tr>
</tbody>
</table>
</figure>
<p>After</p>
</article>`,
  );
  assert.equal(e.state.selection.$from.parent.type.name, "table_header");
  e.table();
  assert.ok(!e.can(T.insertTable()), "no table inside a table");
});

test("rows: above and below, inside the header they join it; delete, never all", () => {
  const e = editor();
  e.at("North").run(T.addRowBefore);
  assert.deepEqual(e.table().slice(6, 9), [
    "<tbody>",
    "<tr><td></td><td></td><td></td></tr>",
    "<tr><td>North</td><td>1.6</td><td>1.9</td></tr>",
  ]);
  e.undo();
  e.at("2025").run(T.addRowBefore);
  // Inside the rowspan of "Region": the span grows, the row is a header row.
  assert.deepEqual(e.table().slice(2, 7), [
    "<thead>",
    '<tr><th rowspan="3">Region</th><th colspan="2">Revenue</th></tr>',
    "<tr><th></th><th></th></tr>",
    "<tr><th>2025</th><th>2026</th></tr>",
    "</thead>",
  ]);
  e.undo();
  e.at("Total").run(T.addRowAfter);
  assert.equal(e.table().at(-3), "<tr><td></td><td></td><td></td></tr>");
  e.undo();
  e.cells("North", "South").run(T.deleteRows);
  assert.deepEqual(e.table().slice(6, 8), [
    "<tbody>",
    '<tr class="total"><td>Total</td><td>2.8</td><td>3.3</td></tr>',
  ]);
  e.undo();
  e.cells("Region", "3.3");
  assert.ok(!e.can(T.deleteRows));
  assert.ok(!e.can(T.deleteColumns));
});

test("columns: insert and delete keep one col per column", () => {
  const e = editor();
  e.at("1.6").run(T.addColumnAfter);
  let lines = e.table();
  assert.equal(
    lines[1],
    '<colgroup><col data-width="40"><col data-width="30"><col><col data-width="30"></colgroup>',
  );
  // The merged "Revenue" header grows over the new column.
  assert.equal(
    lines[3],
    '<tr><th rowspan="2">Region</th><th colspan="3">Revenue</th></tr>',
  );
  e.undo();
  e.at("North").run(T.deleteColumns);
  lines = e.table();
  assert.equal(
    lines[1],
    '<colgroup><col data-width="30"><col data-width="30"></colgroup>',
  );
  assert.equal(lines[3], '<tr><th colspan="2">Revenue</th></tr>');
});

test("merge joins the text with line breaks; split gives the span back; undo restores", () => {
  const e = editor();
  const before = e.table();
  e.cells("North", "1.2").run(T.mergeCells);
  assert.deepEqual(e.table().slice(7, 9), [
    '<tr><td colspan="2" rowspan="2">North<br>1.6<br>South<br>1.2</td><td>1.9</td></tr>',
    "<tr><td>1.4</td></tr>",
  ]);
  e.run(T.splitCell);
  assert.deepEqual(e.table().slice(7, 9), [
    "<tr><td>North<br>1.6<br>South<br>1.2</td><td></td><td>1.9</td></tr>",
    "<tr><td></td><td></td><td>1.4</td></tr>",
  ]);
  e.undo();
  e.undo();
  assert.deepEqual(e.table(), before);
  // Not across the header's boundary, and not on one cell.
  assert.ok(!e.cells("2025", "1.6").can(T.mergeCells));
  assert.ok(!e.at("North").can(T.mergeCells), "one cell");
});

test("deleting a rectangle across merged cells empties them", () => {
  const e = editor();
  e.cells("Region", "2026").run(deleteSelection);
  const lines = e.table();
  assert.equal(lines[3], '<tr><th rowspan="2"></th><th colspan="2"></th></tr>');
  assert.equal(lines[4], "<tr><th></th><th></th></tr>");
});

test("header rows lead, hold th only and never split a span; total rows; row headers", () => {
  const e = editor();
  e.at("North").run(T.toggleHeaderRows);
  assert.deepEqual(e.table().slice(2, 7), [
    "<thead>",
    '<tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>',
    "<tr><th>2025</th><th>2026</th></tr>",
    "<tr><th>North</th><th>1.6</th><th>1.9</th></tr>",
    "</thead>",
  ]);
  assert.ok(T.headerRowsAt(e.state));
  e.run(T.toggleHeaderRows);
  assert.deepEqual(e.table().slice(5, 8), [
    "</thead>",
    "<tbody>",
    "<tr><td>North</td><td>1.6</td><td>1.9</td></tr>",
  ]);
  // Region's two rows are all header or all body: the header never ends inside a span.
  e.at("Region").run(T.toggleHeaderRows);
  assert.equal(e.table()[2], "<tbody>");
  e.undo();
  e.cells("North", "South").run(T.mergeCells);
  assert.ok(!e.at("1.6").can(T.toggleHeaderRows));
  e.undo();
  // The last row is never a header row.
  e.at("Total");
  assert.ok(!e.can(T.toggleHeaderRows));
  assert.ok(T.totalAt(e.state));
  e.run(T.toggleTotalRows);
  assert.equal(
    e.table().at(-3),
    "<tr><td>Total</td><td>2.8</td><td>3.3</td></tr>",
  );
  e.cells("North", "South").run(T.toggleTotalRows);
  assert.match(e.table()[7], /^<tr class="total"><td>North/);
  assert.ok(!e.at("Region").can(T.toggleTotalRows), "no total in the header");
  e.cells("North", "South").run(T.toggleRowHeaders);
  assert.match(e.table()[7], /^<tr class="total"><th>North<\/th>/);
  assert.ok(T.rowHeadersAt(e.state));
});

test("column widths, emphasis, density, caption", () => {
  const e = editor();
  e.at("1.6").run(T.setColumnWidth(50));
  assert.equal(
    e.table()[1],
    '<colgroup><col data-width="40"><col data-width="50"><col data-width="30"></colgroup>',
  );
  assert.equal(T.columnWidthAt(e.state), 50);
  assert.ok(!e.can(T.setColumnWidth(0)));
  assert.ok(!e.can(T.setColumnWidth(101)));
  e.cells("North", "1.6").run(T.distributeColumns);
  assert.equal(
    e.table()[1],
    '<colgroup><col data-width="34"><col data-width="33"><col data-width="33"></colgroup>',
  );
  e.cells("1.6", "1.9").run(T.toggleEmphasis);
  assert.equal(
    e.table()[1],
    '<colgroup><col data-width="34"><col class="emphasis" data-width="33"><col class="emphasis" data-width="33"></colgroup>',
  );
  e.run(T.toggleCompact);
  assert.equal(e.table()[0], '<table class="compact">');
  // No width and no emphasis left: no colgroup.
  const plain = editor(TABLE.replace(/<colgroup>.*<\/colgroup>\n/, ""));
  plain.at("1.6").run(T.toggleEmphasis);
  assert.equal(
    plain.table()[1],
    '<colgroup><col><col class="emphasis"><col></colgroup>',
  );
  plain.run(T.toggleEmphasis);
  assert.equal(plain.table()[1], "<thead>");
  // Caption: removed, then added back empty with the caret in it.
  e.run(T.toggleCaption);
  assert.ok(!T.captionAt(e.state));
  assert.doesNotMatch(articleHTML(e.state.doc), /figcaption/);
  e.at("North").run(T.toggleCaption);
  assert.equal(e.state.selection.$from.parent.type.name, "caption");
  e.table();
});

test("alignment applies to each selected cell, never justify", () => {
  const e = editor();
  e.cells("1.6", "1.4").run(setAlign("ta-r"));
  const lines = e.table();
  assert.equal(
    lines[7],
    '<tr><td>North</td><td class="ta-r">1.6</td><td class="ta-r">1.9</td></tr>',
  );
  assert.equal(
    lines[8],
    '<tr><td>South</td><td class="ta-r">1.2</td><td class="ta-r">1.4</td></tr>',
  );
  assert.ok(!e.at("North").can(setAlign("ta-j")));
});

test("Tab moves through cells and adds a row after the last; Shift-Tab goes back", () => {
  const e = editor();
  e.at("1.2").run(T.nextCell);
  assert.equal(e.state.selection.$from.parent.textContent, "1.4");
  e.run(T.previousCell);
  assert.equal(e.state.selection.$from.parent.textContent, "1.2");
  e.at("3.3").run(T.nextCell);
  const lines = e.table();
  assert.equal(lines.at(-3), "<tr><td></td><td></td><td></td></tr>");
  assert.equal(e.state.selection.$from.parent.type.name, "table_cell");
  assert.equal(e.state.selection.$from.parent.content.size, 0);
  assert.ok(
    !editor("<p>x</p>").can(T.nextCell),
    "outside a table Tab is not taken",
  );
});

test("delete table removes the whole figure; the document is never empty", () => {
  const e = editor();
  e.at("North").run(T.deleteTable);
  assert.equal(articleHTML(e.state.doc).split("\n").length, 4);
  const only = editor(TABLE);
  only.at("North").run(T.deleteTable);
  assert.equal(
    articleHTML(only.state.doc),
    '<article id="doc" data-format="1" lang="en">\n<p></p>\n</article>',
  );
});

test("random command sequences on cell selections always save as valid, canonical files", () => {
  const commands = [
    T.addRowBefore,
    T.addRowAfter,
    T.addColumnBefore,
    T.addColumnAfter,
    T.deleteRows,
    T.deleteColumns,
    T.mergeCells,
    T.splitCell,
    T.toggleHeaderRows,
    T.toggleTotalRows,
    T.toggleRowHeaders,
    T.toggleEmphasis,
    T.toggleCompact,
    T.distributeColumns,
    T.setColumnWidth(25),
    T.toggleCaption,
    T.nextCell,
    deleteSelection,
    setAlign("ta-c"),
  ];
  for (let seed = 1; seed <= 40; seed++) {
    const rand = random(seed);
    const e = editor();
    for (let step = 0; step < 15; step++) {
      // A random cell selection inside the table.
      const cells = [];
      e.state.doc.descendants((node, pos) => {
        if (node.type.spec.tableRole?.includes("cell")) cells.push(pos);
      });
      if (!cells.length) break;
      const a = cells[rand.int(cells.length)],
        b = cells[rand.int(cells.length)];
      e.run(
        (s, d) => (
          d(s.tr.setSelection(T.CellSelection.create(s.doc, a, b))),
          true
        ),
      );
      e.run(rand.pick(commands));
      e.table();
    }
  }
});

const grid = (id, rows, columns) =>
  `<figure class="table" id="${id}">\n<table>\n<tbody>\n` +
  Array.from(
    { length: rows },
    (_, r) =>
      `<tr>${Array.from({ length: columns }, (_, c) => `<td>${r}-${c}</td>`).join("")}</tr>\n`,
  ).join("") +
  `</tbody>\n</table>\n</figure>`;

test("review: no distribution over 100 columns; rows, columns and Tab stop at the limits", () => {
  let e = editor(grid("tab-w", 1, 101));
  e.at("0-0");
  assert.ok(!e.can(T.distributeColumns));
  e = editor(grid("tab-c", 1, 30));
  e.at("0-29");
  assert.ok(!e.can(T.addColumnAfter) && !e.can(T.addColumnBefore));
  e = editor(grid("tab-r", 1000, 1));
  e.at("999-0");
  assert.ok(!e.can(T.addRowAfter) && !e.can(T.addRowBefore));
  assert.ok(e.run(T.nextCell), "Tab is consumed");
  assert.equal(e.state.doc.firstChild.lastChild.childCount, 1000);
});

test("review: text pasted on a cell selection keeps merged cells, their kind and alignment", () => {
  const e = editor();
  e.cells("1.6", "1.2").run(T.mergeCells);
  e.run(setAlign("ta-r"));
  assert.ok(e.run(T.fillCells(Fragment.from(schema.text("X")))));
  const lines = e.table();
  assert.ok(
    lines.some((l) => /<td class="ta-r" rowspan="2">X<\/td>/.test(l)),
    lines.join("\n"),
  );
  e.cells("Region", "2026").run(T.fillCells(Fragment.empty));
  assert.match(e.table().join("\n"), /<tr><th rowspan="2"><\/th>/);
});

test("review: a pasted vertical merge lands and is selected", () => {
  const N = schema.nodes;
  const td = (text, attrs = null) =>
    N.table_cell.create(attrs, schema.text(text));
  const pasted = N.table.create(null, [
    N.table_row.create(null, [td("a"), td("m", { rowspan: 2 })]),
    N.table_row.create(null, [td("b")]),
  ]);
  const e = editor();
  e.at("North");
  assert.ok(e.run(T.pasteTable(pasted)));
  assert.ok(e.state.selection instanceof T.CellSelection);
  const selected = [];
  e.state.selection.forEachCell((cell) => selected.push(cell.textContent));
  assert.deepEqual(selected, ["a", "m", "b"], "only the pasted cells");
  const html = e.table().join("\n");
  assert.match(html, /<tr><td>a<\/td><td rowspan="2">m<\/td>/);
  assert.match(html, /<tr><td>b<\/td>/);
});

test("review: each table command is an undo step apart from typing just before it", () => {
  const e = editor();
  e.at("1.2");
  e.run((s, d) => (d(s.tr.insertText("5")), true));
  e.cells("1.6", "51.2").run(T.own(T.mergeCells));
  e.undo();
  assert.ok(e.state.doc.textContent.includes("51.2"), "the typing stays");
  assert.match(e.table().join("\n"), /<tr><td>North<\/td><td>1\.6<\/td>/);
  e.at("North").run(T.own(T.addRowAfter));
  e.run(T.own(T.addRowAfter));
  e.undo();
  assert.equal(e.state.doc.child(1).lastChild.childCount, 6);
});

test("review: row headers change only the cells the selection holds, not a span from outside it", () => {
  const body = `<figure class="table" id="tab-m">
<table>
<tbody>
<tr><td>a1</td><td rowspan="3">m</td><td>c1</td></tr>
<tr><td>a2</td><td>c2</td></tr>
<tr><td>a3</td><td>c3</td></tr>
</tbody>
</table>
</figure>`;
  const e = editor(body);
  e.cells("a2", "c3").run(T.toggleRowHeaders);
  assert.deepEqual(e.table().slice(2, 5), [
    '<tr><td>a1</td><td rowspan="3">m</td><td>c1</td></tr>',
    "<tr><th>a2</th><th>c2</th></tr>",
    "<tr><th>a3</th><th>c3</th></tr>",
  ]);
});
