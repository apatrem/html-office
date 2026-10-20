import { conditionalScales } from "../model/conditional.mjs";
import { snapshotState } from "../model/snapshots.mjs";
import { shiftWorkbook, restoreHead } from "../model/structure.mjs";
import { readModel, writeModel } from "./document-model.mjs";
import { draftDatabase } from "./persistence.mjs";
let database,
  book,
  key,
  baseHash,
  revision = 0,
  blocked = false,
  hasChanges = false,
  protectedSource = false,
  storageFailed = false,
  timer,
  analysisTimer,
  canonicalOverrides = [],
  formulaResultsCurrent = false,
  queue = Promise.resolve();
const report = (value) => self.postMessage(value);
function storageError(error) {
  storageFailed = true;
  report({ kind: "storage-error", message: error.message });
}
async function storage(action) {
  if (storageFailed) return false;
  try {
    await action();
    return true;
  } catch (error) {
    storageError(error);
    return false;
  }
}
function analyse() {
  if (
    !book?.conditionalFormats?.some(
      (r) => r.kind === "dataBar" && r.scale.kind === "auto",
    )
  )
    return;
  report({
    kind: "conditional-scales",
    revision,
    scales: conditionalScales(book, {
      overrides: canonicalOverrides,
      formulaResultsCurrent,
    }),
  });
}
function scheduleAnalysis(data) {
  canonicalOverrides = data.canonicalOverrides ?? [];
  formulaResultsCurrent = !!data.formulaResultsCurrent;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    queue = queue
      .then(analyse)
      .catch((error) => report({ kind: "error", message: error.message }));
  }, 20);
}
async function store() {
  if (storageFailed || blocked || !hasChanges || !book) return;
  const record = {
    schema: 1,
    documentId: book.id,
    baseHash,
    revision,
    createdAt: new Date().toISOString(),
    modelText: writeModel(book, { pretty: false }),
    protectedSource,
  };
  if (await storage(() => database.put(key, record)))
    report({ kind: "stored", revision: record.revision });
}
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.kind === "init") {
        book = readModel(data.text);
        try {
          const state = await snapshotState(book);
          formulaResultsCurrent = state.state === "current";
          report({ kind: "inspected", state });
        } catch (error) {
          report({ kind: "inspection-failed", message: error.message });
        }
        analyse();
        database = draftDatabase();
        key = data.key;
        baseHash = data.baseHash;
        let existing;
        await storage(async () => {
          existing = await database.get(key);
        });
        blocked = !!existing;
        if (existing) report({ kind: "draft", record: existing });
        else report({ kind: "ready" });
      } else if (data.kind === "reset") {
        book = readModel(data.text);
        revision = data.revision;
        hasChanges = true;
        protectedSource = !!data.protectedSource;
        blocked = false;
        clearTimeout(timer);
        scheduleAnalysis(data);
        await store();
      } else if (data.kind === "analyse") {
        if (data.revision === revision) scheduleAnalysis(data);
      } else if (data.kind === "discard") {
        if (!(await storage(() => database.delete(key)))) return;
        blocked = false;
        if (hasChanges) await store();
        report({ kind: "ready", discarded: true });
      } else if (data.kind === "rebase") {
        if (blocked) return;
        protectedSource = false;
        baseHash = data.baseHash;
        if (data.clean) {
          hasChanges = false;
          clearTimeout(timer);
          if (await storage(() => database.delete(key)))
            report({ kind: "clean" });
        } else await store();
      } else if (data.kind === "change") {
        const patch = (edits) => {
          for (const edit of edits ?? []) {
            const cells = book.sheets.find((s) => s.id === edit.sheetId).cells;
            if (edit.cell === null) delete cells[edit.ref];
            else cells[edit.ref] = edit.cell;
          }
        };
        patch(data.beforeEdits);
        if (data.structure) book = shiftWorkbook(book, data.structure);
        if (data.head) restoreHead(book, data.head);
        patch(data.edits);
        if (data.snapshot) book.snapshot = data.snapshot;
        else delete book.snapshot;
        revision = data.revision;
        hasChanges = true;
        scheduleAnalysis(data);
        clearTimeout(timer);
        timer = setTimeout(() => {
          queue = queue
            .then(store)
            .catch((error) =>
              report({ kind: "error", message: error.message }),
            );
        }, 250);
      }
    } catch (error) {
      report({ kind: "error", message: error.message });
    }
  });
};
