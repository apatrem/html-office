import test from "node:test";
import assert from "node:assert/strict";
import { FileWriter, DirtyState, digestText } from "../../shared/persistence.mjs";

function file(initial = "old") {
  let contents = initial,
    fail = false,
    duringWrite;
  return {
    name: "workbook.html",
    read: () => contents,
    change: (value) => (contents = value),
    fail: () => (fail = true),
    duringWrite: (fn) => (duringWrite = fn),
    async getFile() {
      const captured = contents;
      return { text: async () => captured };
    },
    async createWritable() {
      if (fail) throw new Error("Write permission denied");
      let next;
      return {
        async write(value) {
          next = value;
          await duringWrite?.();
        },
        async close() {
          contents = next;
        },
        async abort() {},
      };
    },
  };
}
test("durable Save detects external changes and never overwrites another revision", async () => {
  const handle = file(),
    writer = await FileWriter.attach(handle);
  handle.change("external edit");
  await assert.rejects(writer.save("mine"), /changed externally/);
  assert.equal(handle.read(), "external edit");
});
test("external edits during staged writes abort before close", async () => {
  const handle = file(),
    writer = await FileWriter.attach(handle);
  handle.duringWrite(() => handle.change("newer disk file"));
  await assert.rejects(writer.save("mine"), /changed externally/);
  assert.equal(handle.read(), "newer disk file");
});
test("failed writes preserve dirty state, and later edits remain dirty after an earlier save", async () => {
  const state = new DirtyState(),
    handle = file(),
    writer = await FileWriter.attach(handle);
  state.change();
  const version = state.revision;
  handle.duringWrite(() => state.change());
  await writer.save("saved old revision");
  state.saved(version);
  assert.equal(state.dirty, true);
  handle.fail();
  await assert.rejects(writer.save("latest"), /permission/);
  assert.equal(state.dirty, true);
  assert.equal(handle.read(), "saved old revision");
});
test("concurrent Save is rejected and successful writes advance the disk baseline", async () => {
  const handle = file(),
    writer = await FileWriter.attach(handle);
  let release;
  const waiting = new Promise((r) => (release = r));
  handle.duringWrite(() => waiting);
  const first = writer.save("one");
  await assert.rejects(writer.save("two"), /already in progress/);
  release();
  await first;
  handle.duringWrite(undefined);
  await writer.save("three");
  assert.equal(handle.read(), "three");
});
test("Save binds only an explicitly selected handle and can validate its original document", async () => {
  const handle = file("different workbook");
  await assert.rejects(
    FileWriter.attach(handle, (text) => {
      if (text !== "expected workbook")
        throw new Error("Different document or revision");
    }),
    /Different document/,
  );
  assert.equal(handle.read(), "different workbook");
  const writer = await FileWriter.attach(file(""), (text) =>
    assert.equal(text, ""),
  );
  await writer.save("new document");
  assert.equal(await digestText("same"), await digestText("same"));
});
