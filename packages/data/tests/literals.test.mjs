import test from "node:test";
import assert from "node:assert/strict";
import { compactInputs } from "../runtime/literals.mjs";
test("browser literal reuse is bounded, immutable and keeps distinct cells independently editable", () => {
  const number = (value) => ({ input: { type: "number", value } }),
    book = {
      sheets: [
        {
          cells: {
            A1: number(1),
            A2: number(1),
            A3: number(2),
            A4: number(2),
            B1: number(0),
            B2: number(-0),
            B3: { input: { type: "date", value: 1 } },
            B4: { input: { type: "text", value: "1" } },
            C1: { input: { type: "text", value: "" } },
            C2: { input: { type: "blank" } },
            D1: { ...number(1), role: "assumption" },
            D2: { formula: "=1", result: { type: "number", value: 1 } },
            D3: {
              ...number(1),
              role: "assumption",
              format: { kind: "currency", currency: "EUR", digits: 2 },
            },
            D4: {
              ...number(1),
              role: "assumption",
              format: { kind: "currency", currency: "EUR", digits: 2 },
            },
            D5: {
              ...number(1),
              role: "assumption",
              format: { kind: "currency", currency: "USD", digits: 2 },
            },
          },
        },
      ],
    };
  const original = structuredClone(book);
  compactInputs(book);
  const c = book.sheets[0].cells;
  assert.equal(c.A1, c.A2);
  assert.equal(Object.isFrozen(c.A1), true);
  assert.equal(Object.isFrozen(c.A1.input), true);
  assert.throws(() => (c.A1.input.value = 9), TypeError);
  c.A1 = { ...c.A1, input: { type: "number", value: 9 } };
  assert.equal(c.A2.input.value, 1);
  assert.notEqual(c.B1, c.B2);
  assert.equal(Object.is(c.B2.input.value, -0), true);
  assert.notEqual(c.A2, c.B3);
  assert.notEqual(c.A2, c.B4);
  assert.notEqual(c.C1, c.C2);
  assert.equal(Object.isFrozen(c.D1), true);
  assert.notEqual(c.D1, c.A2);
  assert.equal(c.D3, c.D4);
  assert.notEqual(c.D3, c.D5);
  assert.equal(Object.isFrozen(c.D3.format), true);
  assert.equal(Object.isFrozen(c.D2), false);
  assert.deepEqual(
    { ...book, sheets: [{ cells: { ...c, A1: original.sheets[0].cells.A1 } }] },
    original,
  );
  const capped = {
    sheets: [
      { cells: { A1: number(1), A2: number(2), A3: number(2), A4: number(1) } },
    ],
  };
  compactInputs(capped, 1);
  assert.equal(capped.sheets[0].cells.A1, capped.sheets[0].cells.A4);
  assert.notEqual(capped.sheets[0].cells.A2, capped.sheets[0].cells.A3);
});
