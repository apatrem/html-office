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
  timer,
  queue = Promise.resolve();
const report = (value) => self.postMessage(value);
async function store() {
  if (blocked || !hasChanges || !book) return;
  const record = {
    schema: 1,
    documentId: book.id,
    baseHash,
    revision,
    createdAt: new Date().toISOString(),
    modelText: writeModel(book, { pretty: false }),
    protectedSource,
  };
  await database.put(key, record);
  report({ kind: "stored", revision: record.revision });
}
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.kind === "init") {
        book = readModel(data.text);
        try {
          report({ kind: "inspected", state: await snapshotState(book) });
        } catch (error) {
          report({ kind: "inspection-failed", message: error.message });
        }
        database = draftDatabase();
        key = data.key;
        baseHash = data.baseHash;
        const existing = await database.get(key);
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
        await store();
      } else if (data.kind === "discard") {
        blocked = false;
        await database.delete(key);
        if (hasChanges) await store();
        report({ kind: "ready" });
      } else if (data.kind === "rebase") {
        // Only an explicit restore/discard may resolve a previous draft.
        if (blocked) return;
        protectedSource = false;
        baseHash = data.baseHash;
        if (data.clean) {
          hasChanges = false;
          clearTimeout(timer);
          await database.delete(key);
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
