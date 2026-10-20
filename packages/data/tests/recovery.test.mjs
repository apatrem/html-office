import { snapshotState } from "../model/snapshots.mjs";
import {
  shiftWorkbook,
  restoreHead,
  captureHead,
} from "../model/structure.mjs";
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
function harness(existing, inspect = snapshotState) {
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
    snapshotState: inspect,
    draftDatabase: () => database,
    shiftWorkbook,
    restoreHead,
    self: { postMessage: (message) => events.push(structuredClone(message)) },
    Date,
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context);
  return {
    send: (data) => {
      context.self.onmessage({ data });
      return vm.runInContext("queue", context);
    },
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
  await h.send({ kind: "init", key: "key", baseHash: "base", text });
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
  await h.send({ kind: "init", key: "key", baseHash: "base", text });
  h.send({ kind: "rebase", baseHash: "new", clean: true });
  await flush();
  assert.equal(h.record, existing);
  assert.equal(h.events.at(-1).kind, "draft");
});

test("structural recovery reconciles pending cells before moving references in one change", async () => {
  const h = harness(),
    source = readModel(text),
    command = {
      sheetId: "inputs",
      axis: "row",
      action: "insert",
      index: 2,
      count: 1,
    };
  await h.send({ kind: "init", key: "key", baseHash: "base", text });
  await flush();
  h.send({
    kind: "change",
    revision: 1,
    edits: [
      {
        sheetId: "inputs",
        ref: "B2",
        cell: { input: { type: "number", value: 140 } },
      },
    ],
    snapshot: null,
  });
  await flush();
  const next = shiftWorkbook(source, command),
    formula = "=Inputs!B3*Inputs!B4";
  h.send({
    kind: "change",
    revision: 2,
    beforeEdits: [
      { sheetId: "inputs", ref: "B2", cell: source.sheets[0].cells.B2 },
    ],
    structure: command,
    head: captureHead(next),
    edits: [
      {
        sheetId: "summary",
        ref: "B2",
        cell: { ...source.sheets[1].cells.B2, formula },
      },
    ],
    snapshot: null,
  });
  await flush();
  h.timers();
  await flush();
  const recovered = readModel(h.record.modelText);
  assert.equal(recovered.sheets[0].cells.B2, undefined);
  assert.equal(recovered.sheets[0].cells.B3.input.value, 100);
  assert.equal(recovered.sheets[0].cells.B4.input.value, 25);
  assert.equal(recovered.sheets[1].cells.B2.formula, formula);
  assert.deepEqual(recovered.metadata, source.metadata);
});

test("initial snapshot inspection is reported before the draft decision", async () => {
  const h = harness({ schema: 1, modelText: text, revision: 4 });
  await h.send({ kind: "init", key: "key", baseHash: "base", text });
  assert.deepEqual(h.events[0], {
    kind: "inspected",
    state: await snapshotState(readModel(text)),
  });
  assert.equal(h.events[1].kind, "draft");
});

test("failed snapshot inspection still protects an existing recovery draft", async () => {
  const existing = { schema: 1, modelText: text, revision: 4 };
  const h = harness(existing, async () => {
    throw new Error("Digest unavailable");
  });
  await h.send({ kind: "init", key: "key", baseHash: "base", text });
  await h.send({ kind: "rebase", baseHash: "new", clean: true });
  assert.equal(h.record, existing);
  assert.deepEqual(
    h.events.map((e) => e.kind),
    ["inspection-failed", "draft"],
  );
});
