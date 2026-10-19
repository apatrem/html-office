import { readModel, writeModel } from "./document-model.mjs";
import { draftDatabase } from "./persistence.mjs";
let database,
  book,
  seedText,
  key,
  baseHash,
  revision = 0,
  blocked = false,
  protectedSource = false,
  timer,
  queue = Promise.resolve();
const report = (value) => self.postMessage(value);
async function store() {
  if (blocked || !book) return;
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
  report({ kind: "stored", revision });
}
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.kind === "init") {
        database = draftDatabase();
        key = data.key;
        baseHash = data.baseHash;
        seedText = data.text;
        const existing = await database.get(key);
        blocked = !!existing;
        if (existing) report({ kind: "draft", record: existing });
        else report({ kind: "ready" });
      } else if (data.kind === "reset") {
        book = readModel(data.text);
        seedText = null;
        revision = data.revision;
        protectedSource = !!data.protectedSource;
        blocked = false;
        clearTimeout(timer);
        await store();
      } else if (data.kind === "discard") {
        blocked = false;
        await database.delete(key);
        if (revision) await store();
        report({ kind: "ready" });
      } else if (data.kind === "rebase") {
        blocked = false;
        protectedSource = false;
        baseHash = data.baseHash;
        if (data.clean) {
          clearTimeout(timer);
          await database.delete(key);
          report({ kind: "clean" });
        } else await store();
      } else if (data.kind === "change") {
        if (!book) {
          book = readModel(seedText);
          seedText = null;
        }
        for (const edit of data.edits ?? []) {
          const cells = book.sheets.find((s) => s.id === edit.sheetId).cells;
          if (edit.cell === null) delete cells[edit.ref];
          else cells[edit.ref] = edit.cell;
        }
        if (data.snapshot) book.snapshot = data.snapshot;
        else delete book.snapshot;
        revision = data.revision;
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
