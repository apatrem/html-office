import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWorkbook } from "../model/workbook.mjs";
import { shiftWorkbook, captureHead } from "../model/structure.mjs";
import { EditHistory, captureCells } from "../model/history.mjs";
import {
  setValidation,
  removeValidation,
  configureScenario,
  validationChoices,
  validationStatus,
  validationForCell,
  scenarioTarget,
  assertScenarioInputs,
} from "../model/validation.mjs";
const source = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const text = (value) => ({ type: "text", value });
const number = (value) => ({ type: "number", value });
const rule = () => ({
  id: "scenario",
  sheetId: "inputs",
  ref: "B2",
  source: {
    kind: "list",
    values: [text("Base"), text("Upside"), text("Downside")],
  },
});
const fixture = () =>
  configureScenario(setValidation(structuredClone(source), rule()), "scenario");
test("definition edits are immutable metadata operations and removing the selector clears only its descriptor", () => {
  const definition = rule(),
    book = setValidation(source, definition);
  assert.equal(book.sheets, source.sheets);
  definition.source.values[0].value = "changed";
  assert.equal(book.validations[0].source.values[0].value, "Base");
  assert.equal(source.validations, undefined);
  const configured = configureScenario(book, "scenario"),
    removed = removeValidation(configured, "scenario");
  assert.equal(removed.scenario, undefined);
  assert.deepEqual(removed.validations, []);
  assert.equal(configured.scenario.validationId, "scenario");
  assert.throws(() => removeValidation(book, "missing"));
});
test("typed membership, duplicates and computed targets never coerce or overwrite values", () => {
  const book = fixture(),
    definition = book.validations[0];
  definition.source.values = [
    number(1),
    text("1"),
    number(1),
    number(0),
    number(-0),
    { type: "blank" },
  ];
  assert.deepEqual(validationChoices(book, definition).values, [
    number(1),
    text("1"),
    number(0),
    { type: "blank" },
  ]);
  book.sheets[0].cells.B2 = { input: text("01") };
  assert.equal(validationStatus(book, definition, "B2").state, "invalid");
  book.sheets[0].cells.B2 = { input: text("1") };
  assert.equal(validationStatus(book, definition, "B2").state, "valid");
  book.sheets[0].cells.B2 = { formula: "=1", result: number(1) };
  assert.equal(validationStatus(book, definition, "B2").state, "unresolved");
  const computed = validationStatus(book, definition, "B2", {
    snapshotCurrent: true,
  });
  assert.equal(computed.state, "valid");
  assert.equal(computed.editable, false);
  assert.equal(validationForCell(book, "inputs", "B2"), definition);
  assert.equal(validationForCell(book, "summary", "B2"), undefined);
});
test("range lists distinguish stale/missing/error sources from an invalid target value", () => {
  const book = fixture(),
    definition = book.validations[0];
  definition.source = { kind: "range", sheetId: "inputs", ref: "A1:A5" };
  book.sheets[0].cells = {
    A1: { input: number(1) },
    A2: { input: number(1) },
    A3: { input: text("1") },
    A4: { input: { type: "blank" } },
    A5: { formula: "=2", result: number(2) },
  };
  assert.equal(validationChoices(book, definition).state, "unresolved");
  assert.equal(validationChoices(book, definition).reason, "stale");
  assert.deepEqual(
    validationChoices(book, definition, { snapshotCurrent: true }).values,
    [number(1), text("1"), number(2)],
  );
  delete book.sheets[0].cells.A5.result;
  assert.equal(
    validationChoices(book, definition, { snapshotCurrent: true }).state,
    "unresolved",
  );
  assert.equal(
    validationChoices(book, definition, { snapshotCurrent: true }).reason,
    "missing",
  );
  book.sheets[0].cells.A5.result = { type: "error", value: "#N/A" };
  assert.equal(
    validationChoices(book, definition, { snapshotCurrent: true }).state,
    "unresolved",
  );
  assert.equal(
    validationChoices(book, definition, { snapshotCurrent: true }).reason,
    "error",
  );
  definition.source.ref = "A1:A4";
  assert.equal(validationChoices(book, definition).state, "ready");
  definition.source.ref = "C1:C5";
  assert.equal(validationChoices(book, definition).state, "empty");
  definition.source.ref = "A1:A10001";
  assert.equal(validationChoices(book, definition).state, "too-large");
  definition.source.ref = "#REF!";
  assert.equal(validationChoices(book, definition).state, "broken");
});
test("row/column movement rewrites dropdown targets and sources while deleted selectors stay broken until undo", () => {
  const book = fixture();
  book.validations.push({
    id: "linked",
    sheetId: "summary",
    ref: "D1:D3",
    source: { kind: "range", sheetId: "inputs", ref: "B1:B4" },
  });
  const insert = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "column",
    action: "insert",
    index: 2,
    count: 1,
  });
  assert.equal(insert.validations[0].ref, "C2");
  assert.equal(insert.validations[1].source.ref, "C1:C4");
  assert.equal(insert.validations[1].ref, "D1:D3");
  const command = {
      sheetId: "inputs",
      axis: "row",
      action: "delete",
      index: 2,
      count: 1,
    },
    next = shiftWorkbook(book, command),
    history = new EditHistory();
  assert.equal(next.validations[0].ref, "#REF!");
  assert.equal(next.validations[1].source.ref, "B1:B3");
  assert.equal(
    validationStatus(next, next.validations[0], "#REF!").state,
    "broken",
  );
  validateWorkbook(next);
  history.record({
    structure: command,
    before: captureCells(book, [{ sheetId: "inputs", ref: "B2" }]),
    after: [],
    headBefore: captureHead(book),
    headAfter: captureHead(next),
  });
  history.undo(next);
  assert.deepEqual(next.validations, book.validations);
  assert.deepEqual(next.scenario, book.scenario);
  assert.deepEqual(next.sheets[0].cells.B2, book.sheets[0].cells.B2);
  history.redo(next);
  assert.equal(next.validations[0].ref, "#REF!");
});

test("singleton range selectors normalize to a cell before checking edits", () => {
  const book = fixture();
  book.validations[0].ref = "B2:B2";
  validateWorkbook(book);
  assert.deepEqual(scenarioTarget(book), { sheetId: "inputs", ref: "B2" });
  assert.throws(
    () =>
      assertScenarioInputs(book, [
        { sheetId: "inputs", ref: "B2", cell: { formula: "=1" } },
      ]),
    /selector.*input/i,
  );
  book.sheets[0].cells.B2 = { formula: "=1" };
  assert.throws(() => validateWorkbook(book), /selector.*input/i);
});

test("source expansion boundaries report complete lists or no partial options", () => {
  const book = fixture(),
    definition = book.validations[0];
  definition.source = { kind: "range", sheetId: "inputs", ref: "A1:A1000" };
  book.sheets[0].cells = Object.fromEntries(
    Array.from({ length: 1001 }, (_, i) => [
      `A${i + 1}`,
      { input: number(i + 1) },
    ]),
  );
  assert.equal(validationChoices(book, definition).values.length, 1000);
  definition.source.ref = "A1:A1001";
  assert.equal(validationChoices(book, definition).state, "too-large");
  assert.deepEqual(validationChoices(book, definition).values, []);
  book.sheets[0].cells = { A1: { input: number(7) } };
  definition.source.ref = "A1:A10000";
  assert.deepEqual(validationChoices(book, definition).values, [number(7)]);
});
