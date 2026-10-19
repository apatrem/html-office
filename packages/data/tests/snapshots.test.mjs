import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fingerprint } from "../model/workbook.mjs";
import { ENGINE } from "../engine/adapter.mjs";
import { snapshotState, CalculationRevision } from "../model/snapshots.mjs";
const fixture = async () =>
  JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
const stamp = async (book) =>
  (book.snapshot = {
    engine: ENGINE,
    fingerprint: await fingerprint(book),
    calculatedAt: "2026-10-19T00:00:00Z",
  });
test("current snapshot requires matching engine/content and every populated formula result", async () => {
  const book = await fixture();
  await stamp(book);
  assert.equal((await snapshotState(book)).state, "current");
  delete book.sheets[1].cells.B3.result;
  assert.equal((await snapshotState(book)).state, "missing");
  book.sheets[1].cells.B3.result = { type: "error", value: "#DIV/0!" };
  assert.equal((await snapshotState(book)).state, "current");
  book.snapshot.engine = "unknown/1";
  assert.equal((await snapshotState(book)).state, "stale");
});
test("cross-sheet input changes invalidate results while formatting does not", async () => {
  const book = await fixture();
  await stamp(book);
  book.sheets[0].cells.B2.format = { kind: "percent", digits: 5 };
  assert.equal((await snapshotState(book)).state, "current");
  book.sheets[0].cells.B2.input.value = 123.45678901234567;
  assert.equal((await snapshotState(book)).state, "stale");
});
test("late and cancelled calculations cannot publish a snapshot for a newer revision", () => {
  const revisions = new CalculationRevision(),
    first = revisions.begin(),
    second = revisions.begin();
  let value;
  assert.equal(
    revisions.publish(first, () => (value = "old")),
    false,
  );
  assert.equal(
    revisions.publish(second, () => (value = "new")),
    true,
  );
  const pending = revisions.begin();
  revisions.cancel();
  assert.equal(
    revisions.publish(pending, () => (value = "cancelled")),
    false,
  );
  assert.equal(value, "new");
});
test("formula-only cells outside the preview are included; absent results are never zero", async () => {
  const book = await fixture();
  book.sheets[1].cells.DZ2001 = { formula: "=1/3" };
  await stamp(book);
  assert.equal((await snapshotState(book)).state, "missing");
  assert.equal(book.sheets[1].cells.DZ2001.result, undefined);
});
