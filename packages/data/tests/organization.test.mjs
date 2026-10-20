import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { organizeWorkbook, groupView } from "../model/organization.mjs";
import { fingerprint } from "../model/workbook.mjs";
const fixture = async () =>
  JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
test("group collapse/order and sheet moves preserve values, engine order and fingerprint", async () => {
  const book = await fixture(),
    old = await fingerprint(book),
    groups = groupView(book);
  assert.equal(groups.length, 4);
  const raw = groups.find((g) => g.kind === "raw"),
    calc = groups.find((g) => g.kind === "calculations");
  const next = organizeWorkbook(book, {
    type: "moveSheet",
    sheetId: "inputs",
    groupId: calc.id,
    index: 0,
  });
  assert.equal(next.sheets[0], book.sheets[0]);
  assert.deepEqual(next.groups.find((g) => g.id === calc.id).sheetIds, [
    "inputs",
  ]);
  assert.deepEqual(book.groups[0].sheetIds, ["inputs"]);
  const collapsed = organizeWorkbook(next, {
    type: "collapse",
    groupId: calc.id,
    collapsed: true,
  });
  assert.equal(collapsed.groups.find((g) => g.id === calc.id).collapsed, true);
  const reordered = organizeWorkbook(collapsed, {
    type: "moveGroup",
    groupId: raw.id,
    index: 0,
  });
  assert.equal(reordered.groups[0].id, raw.id);
  assert.equal(await fingerprint(reordered), old);
});
test("create/rename preserve stable IDs, reject ambiguous names and avoid copying sheet data", async () => {
  const book = await fixture();
  book.snapshot = { fingerprint: "old" };
  const groupId = groupView(book).find((g) => g.kind === "calculations").id;
  const next = organizeWorkbook(book, {
    type: "create",
    id: "new_sheet",
    name: "Forecast",
    groupId,
  });
  assert.equal(next.snapshot, undefined);
  assert.equal(next.sheets[0], book.sheets[0]);
  assert.deepEqual(next.sheets[2], {
    id: "new_sheet",
    name: "Forecast",
    cells: {},
  });
  const renamed = organizeWorkbook(next, {
    type: "rename",
    sheetId: "new_sheet",
    name: "Next year's plan",
  });
  assert.equal(renamed.sheets[2].id, "new_sheet");
  assert.equal(next.sheets[2].name, "Forecast");
  for (const name of [
    "Inputs",
    "inputs",
    "x".repeat(32),
    "A/B",
    "'quoted'",
    "   ",
  ])
    assert.throws(() =>
      organizeWorkbook(book, { type: "create", id: "other", name, groupId }),
    );
  assert.throws(() =>
    organizeWorkbook(book, {
      type: "create",
      id: "inputs",
      name: "New",
      groupId,
    }),
  );
  assert.throws(() =>
    organizeWorkbook(book, {
      type: "moveSheet",
      sheetId: "inputs",
      groupId: "missing",
      index: 0,
    }),
  );
  assert.throws(() =>
    organizeWorkbook(book, { type: "moveGroup", groupId, index: 4 }),
  );
});
