// Save and Save a copy through the shared persistence module (T03). Draft recovery and the
// Safari/Firefox paths are T05. A save never normalises silently: the file chosen for Save must be
// empty or hold exactly the document as opened, in canonical form.
import { DirtyState, FileWriter } from "../../shared/persistence.mjs";

export function setupSaving({
  opened,
  canonical,
  serialize,
  check,
  name,
  changed,
}) {
  const dirty = new DirtyState();
  let writer = null,
    busy = false,
    message = "";
  const say = (text) => {
    message = text;
    changed();
  };
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
    if (busy) return;
    busy = true;
    changed();
    try {
      if (!writer) {
        if (typeof window.showSaveFilePicker !== "function")
          throw new Error(
            "Saving to a file is unavailable in this browser. Use Save a copy",
          );
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
          if (text && text !== opened)
            throw new Error(
              "The selected file is not the document opened here, or it is not in canonical form (pack.mjs). Choose its file or a new name, or use Save a copy; nothing was overwritten",
            );
        });
      }
      const revision = dirty.revision;
      await writer.save(output());
      dirty.saved(revision);
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
      const url = URL.createObjectURL(
        new Blob([output()], { type: "text/html;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(
        "Copy download requested. The source file has not been saved; open the copy to check it.",
      );
    } catch (error) {
      say(`Copy failed: ${error.message}. Your work remains open.`);
    }
  }

  window.addEventListener("beforeunload", (event) => {
    if (dirty.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  return {
    save,
    saveCopy,
    edited() {
      dirty.change();
      message = "";
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
    canonical,
  };
}
