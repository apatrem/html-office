import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateWorkbook,
  stringifyWorkbook,
  parseWorkbook,
  fingerprint,
  parseAddress,
  parseRange,
  setCell,
} from "../model/workbook.mjs";
const fixture = async () =>
  JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
test("linked sparse workbook and unrelated metadata survive serialization and bounded edits", async () => {
  const book = await fixture();
  assert.equal(validateWorkbook(book), book);
  assert.deepEqual(parseWorkbook(stringifyWorkbook(book)), book);
  const changed = setCell(book, "inputs", "B2", {
    input: { type: "number", value: 150 },
  });
  assert.equal(book.sheets[0].cells.B2.input.value, 100);
  assert.deepEqual(changed.sheets[1], book.sheets[1]);
  assert.deepEqual(changed.metadata, book.metadata);
  assert.notEqual(await fingerprint(book), await fingerprint(changed));
  changed.sheets[0].cells.B2.format = {
    kind: "currency",
    currency: "EUR",
    digits: 0,
  };
  const before = await fingerprint(changed);
  changed.sheets[0].cells.B2.format.digits = 2;
  assert.equal(await fingerprint(changed), before);
});
test("safe embedding retains literal markup and Unicode as inert text", async () => {
  const book = await fixture();
  book.sheets[0].cells.A1.input.value =
    "</script><img src=x onerror=alert(1)> café\u2028";
  const encoded = stringifyWorkbook(book);
  assert.ok(!encoded.includes("<"));
  assert.deepEqual(parseWorkbook(encoded), book);
});
test("reject malformed IDs, coordinates, typed values, formulas, formats and active fields", async () => {
  const source = await fixture();
  const changes = [
    (b) => (b.sheets[1].id = b.sheets[0].id),
    (b) => (b.sheets[0].cells.A0 = {}),
    (b) => (b.sheets[0].cells.B2.input.value = Infinity),
    (b) => (b.sheets[0].cells.B2.input.value = "12"),
    (b) => (b.sheets[0].cells.B2.onclick = "alert(1)"),
    (b) => (b.sheets[1].cells.B2.formula = "SUM(A1)"),
    (b) => (b.sheets[0].cells.B2.format = { kind: "html", value: "<script>" }),
    (b) => b.groups[0].sheetIds.push("missing"),
  ];
  for (const mutate of changes) {
    const book = structuredClone(source);
    mutate(book);
    assert.throws(() => validateWorkbook(book));
  }
  source.sheets[0].cells.C3 = { input: { type: "error", value: "#REF!" } };
  assert.doesNotThrow(() => validateWorkbook(source));
});
test("address and range limits are explicit", () => {
  assert.deepEqual(parseAddress("XFD1048576"), { row: 1048576, column: 16384 });
  assert.deepEqual(parseRange("A1:B3"), {
    top: 1,
    left: 1,
    bottom: 3,
    right: 2,
  });
  for (const ref of ["A0", "XFE1", "A1048577", "a1", "B2:A1", "A:A"])
    assert.throws(() => parseRange(ref));
});
test("legacy quoted-edge sheet names remain readable even though new commands reject them", async () => {
  const book = await fixture();
  for (const name of ["'Budget", "Budget'"]) {
    book.sheets[0].name = name;
    assert.equal(parseWorkbook(stringifyWorkbook(book)).sheets[0].name, name);
  }
});
test("signed zero remains a JSON number and survives the canonical round trip", async () => {
  const book = await fixture();
  book.sheets[0].cells.B2.input.value = -0;
  const text = stringifyWorkbook(book);
  assert.ok(Object.is(parseWorkbook(text).sheets[0].cells.B2.input.value, -0));
  const positive = structuredClone(book);
  positive.sheets[0].cells.B2.input.value = 0;
  assert.notEqual(await fingerprint(book), await fingerprint(positive));
});
test("labelled invalid reference files fail with the documented errors", async () => {
  for (const [name, message] of [
    ["unsupported-version", "Invalid workbook header"],
    ["active-cell-field", "cell: unknown field onclick"],
  ]) {
    const text = await readFile(
      new URL(`../fixtures/invalid/${name}.json`, import.meta.url),
      "utf8",
    );
    assert.throws(() => parseWorkbook(text), new RegExp(message));
  }
});
