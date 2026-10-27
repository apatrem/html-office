// Save, Save a copy and draft recovery through the shared persistence module (T03, T05).
// Chrome and Edge save directly to the chosen file (File System Access API); Safari and Firefox
// save a complete copy. Every unsaved revision is kept as a draft in this browser's IndexedDB,
// offered again when the file is reopened. A save never normalises silently: the file chosen for
// Save must be empty or hold exactly the document as opened, in canonical form.
import {
  DirtyState,
  FileWriter,
  digestText,
  draftDatabase,
} from "../../shared/persistence.mjs";

const DRAFT_DELAY = 500;

// opened: the canonical text of the document as opened. draft(): the article HTML of the current
// document. onDraft(record): a draft was found on open; the shell asks to restore or discard it.
export function setupSaving({
  opened,
  canonical,
  serialize,
  check,
  name,
  changed,
  draft,
  onDraft,
}) {
  const direct = typeof window.showSaveFilePicker === "function";
  const dirty = new DirtyState();
  let writer = null,
    busy = false,
    message = "",
    copied = -1,
    kept = -1,
    // A draft of an older revision of the file: Save may only write a new, empty file.
    asCopy = false,
    // "opening" until the draft store answers, "unresolved" while a found draft awaits a choice
    // (saving waits for it: a save would make the draft's base stale).
    recovery = "opening",
    unavailable = "",
    store,
    key,
    baseHash,
    timer = 0,
    queue = Promise.resolve();
  const say = (text) => {
    message = text;
    changed();
  };
  // Store operations run one after another, so a draft never outlives the save that made it
  // stale. Each resolves to whether it was stored.
  const enqueue = (op) =>
    (queue = queue.then(op).then(
      () => true,
      (error) => {
        recovery = "unavailable";
        unavailable = error.message || "storage failed";
        changed();
        return false;
      },
    ));

  function storeDraft() {
    clearTimeout(timer);
    if (recovery !== "ready" || !dirty.dirty) return;
    const revision = dirty.revision;
    const record = {
      schema: 1,
      baseHash,
      asCopy,
      article: draft(),
      date: new Date().toISOString(),
    };
    enqueue(async () => {
      await store.put(key, record);
      kept = Math.max(kept, revision);
      changed();
    });
  }
  const dropDraft = () =>
    enqueue(async () => {
      await store.delete(key);
      kept = -1;
    });

  void (async () => {
    [baseHash, key] = await Promise.all([
      digestText(opened),
      digestText(location.origin + location.pathname),
    ]);
    key = `text:${key}`;
    store = draftDatabase("html-office-text-recovery");
    const record = await store.get(key);
    if (record?.schema === 1 && typeof record.article === "string") {
      recovery = "unresolved";
      changed();
      onDraft({
        date: record.date,
        asCopy: !!record.asCopy || record.baseHash !== baseHash,
        article: record.article,
      });
    } else {
      recovery = "ready";
      if (dirty.dirty) storeDraft();
      changed();
    }
  })().catch((error) => {
    recovery = "unavailable";
    unavailable = error?.message || "storage unavailable";
    changed();
  });

  // The file text to write, read back first: a problem stops the save before anything is written.
  const output = () => {
    if (!canonical)
      throw new Error(
        "this file is not in canonical form, so saving would rewrite more than your edits. Run tools/pack.mjs on it first; nothing was written",
      );
    const text = serialize();
    const problem = check(text);
    if (problem) throw new Error(`${problem}; nothing was written`);
    return text;
  };

  async function save() {
    if (busy || !direct) return;
    busy = true;
    changed();
    try {
      if (!writer) {
        const handle = await window.showSaveFilePicker({
          suggestedName: name(),
          types: [
            {
              description: "HTML document",
              accept: { "text/html": [".html"] },
            },
          ],
        });
        writer = await FileWriter.attach(handle, (text) => {
          if (text && asCopy)
            throw new Error(
              "This draft was made from an older version of the file, so it can only be saved to a new, empty file or as a copy; nothing was overwritten",
            );
          if (text && text !== opened)
            throw new Error(
              "The selected file is not the document opened here, or it is not in canonical form (pack.mjs). Choose its file or a new name, or use Save a copy; nothing was overwritten",
            );
        });
      }
      const revision = dirty.revision;
      const text = output();
      await writer.save(text);
      dirty.saved(revision);
      // The file now holds this text: a later draft belongs to it, and a clean file needs none.
      baseHash = await digestText(text);
      asCopy = false;
      if (dirty.dirty) storeDraft();
      else if (recovery === "ready") dropDraft();
      say(
        dirty.dirty
          ? "Earlier revision saved. Later changes remain unsaved."
          : `Saved to ${writer.handle.name}.`,
      );
    } catch (error) {
      say(
        error.name === "AbortError"
          ? "Save cancelled. Your work remains open."
          : `Save failed: ${error.message}. Your work remains open.`,
      );
    } finally {
      busy = false;
      changed();
    }
  }

  function saveCopy() {
    try {
      const revision = dirty.revision;
      const url = URL.createObjectURL(
        new Blob([output()], { type: "text/html;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      copied = revision;
      say(
        direct
          ? "Copy download requested. This file is not saved; open the copy to check it."
          : "Copy download requested: open it from your downloads to check it, and keep editing that copy. This file is not changed.",
      );
    } catch (error) {
      say(`Copy failed: ${error.message}. Your work remains open.`);
    }
  }

  // Unsaved work is lost on leaving only if no saved file, copy or draft holds it.
  window.addEventListener("beforeunload", (event) => {
    if (dirty.dirty && copied !== dirty.revision) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  // A draft waiting for its delay is written when the page is hidden or closed.
  window.addEventListener("pagehide", storeDraft);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") storeDraft();
  });

  return {
    direct,
    save,
    saveCopy,
    edited() {
      dirty.change();
      message = "";
      clearTimeout(timer);
      if (recovery === "ready") timer = setTimeout(storeDraft, DRAFT_DELAY);
    },
    // The choice on a found draft: restored (the editor has applied it as an edit) or discarded.
    restored({ asCopy: copy }) {
      asCopy = copy;
      recovery = "ready";
      storeDraft();
      say(
        copy
          ? "Draft restored as a copy: the file changed since it was made. Save asks for a new file; Save a copy downloads it."
          : "Draft restored. Unsaved changes.",
      );
    },
    async discarded() {
      recovery = "ready";
      say("Discarding the draft…");
      if (await dropDraft()) say("Draft discarded.");
    },
    get ready() {
      return !busy && recovery !== "unresolved";
    },
    get busy() {
      return busy;
    },
    get dirty() {
      return dirty.dirty;
    },
    get message() {
      return message;
    },
    // saved, unsaved, draft (kept in this browser) or copied (downloaded, this file unchanged).
    get state() {
      if (!dirty.dirty) return "saved";
      if (copied === dirty.revision) return "copied";
      if (kept === dirty.revision) return "draft";
      return "unsaved";
    },
    // opening, unresolved, ready or unavailable (then `problem` says why).
    get recovery() {
      return recovery;
    },
    get problem() {
      return unavailable;
    },
    canonical,
  };
}
