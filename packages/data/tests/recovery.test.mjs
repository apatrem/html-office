import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readModel, writeModel } from "../runtime/document-model.mjs";
const source = (
  await readFile(
    new URL("../runtime/recovery-worker.mjs", import.meta.url),
    "utf8",
  )
).replace(/^import .*;\n/gm, "");
const text = await readFile(
  new URL("../fixtures/two-sheets.json", import.meta.url),
  "utf8",
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(existing) {
  let record = existing,
    release,
    held = false,
    timerId = 0;
  const events = [],
    timers = new Map();
  const database = {
    get: async () => record,
    put: async (_, value) => {
      if (held) await new Promise((resolve) => (release = resolve));
      record = value;
    },
    delete: async () => {
      record = undefined;
    },
  };
  const context = vm.createContext({
    readModel,
    writeModel,
    draftDatabase: () => database,
    self: { postMessage: (message) => events.push(message) },
    Date,
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context);
  return {
    send: (data) => context.self.onmessage({ data }),
    get record() {
      return record;
    },
    events,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      release();
    },
    timers: () => {
      for (const fn of timers.values()) fn();
      timers.clear();
    },
  };
}
test("a clean rebase invalidates an already queued recovery store", async () => {
  const h = harness();
  h.send({ kind: "init", key: "key", baseHash: "base", text });
  await flush();
  h.send({ kind: "change", revision: 1, edits: [], snapshot: null });
  await flush();
  h.hold();
  h.send({ kind: "rebase", baseHash: "first", clean: false });
  await flush();
  h.send({ kind: "rebase", baseHash: "second", clean: true });
  h.timers();
  h.release();
  await flush();
  await flush();
  assert.equal(h.record, undefined);
  assert.equal(h.events.at(-1).kind, "clean");
});
test("a save never deletes an unresolved recovery record", async () => {
  const existing = { schema: 1, modelText: text, revision: 4 },
    h = harness(existing);
  h.send({ kind: "init", key: "key", baseHash: "base", text });
  h.send({ kind: "rebase", baseHash: "new", clean: true });
  await flush();
  assert.equal(h.record, existing);
  assert.equal(h.events[0].kind, "draft");
});
