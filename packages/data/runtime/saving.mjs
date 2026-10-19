import { readModel, writeModel } from "./document-model.mjs";
import { DirtyState, FileWriter, digestText } from "./persistence.mjs";
import { RecoveryClient } from "./recovery.mjs";

const payload = (doc) => {
  const matches = doc.querySelectorAll("#workbook");
  if (
    matches.length !== 1 ||
    matches[0].tagName !== "SCRIPT" ||
    matches[0].type !== "application/json"
  )
    throw new Error("Expected one inert workbook payload");
  return matches[0];
};
function shell(doc) {
  const copy = doc.documentElement.cloneNode(true);
  copy.querySelector("#workbook").textContent = "";
  return copy.outerHTML;
}

export function setupPersistence({ getBook, getPending, restore }) {
  const $ = (id) => document.getElementById(id),
    dirty = new DirtyState();
  const originalText = payload(document).textContent;
  const source = Promise.all([
    digestText(originalText),
    digestText(shell(document)),
  ]);
  let sourceHash,
    sourceShell,
    writer,
    recovery,
    recoveryFailed = false,
    protectedSource = false,
    draft;
  const messages = [];
  const saveStatus = (text) => ($("save-status").textContent = text);
  const send = (message) => {
    if (recoveryFailed) return;
    if (recovery) recovery.send(message);
    else messages.push(message);
  };
  function documentBook() {
    const book = getBook(),
      attempt = getPending();
    if (!attempt) return book;
    const next = {
      ...book,
      sheets: book.sheets.map((s) =>
        s.id !== attempt.sheetId
          ? s
          : {
              ...s,
              cells: {
                ...s.cells,
                [attempt.ref]: {
                  ...attempt.cell,
                  format: s.cells[attempt.ref]?.format ?? attempt.cell.format,
                },
              },
            },
      ),
    };
    // Avoid an undefined optional field, which is not JSON data.
    const cell = next.sheets.find((s) => s.id === attempt.sheetId).cells[
      attempt.ref
    ];
    if (cell.format === undefined) delete cell.format;
    delete next.snapshot;
    return next;
  }
  function changed(edits = []) {
    const revision = dirty.change(),
      attempt = getPending();
    const patches = edits.map((e) => ({ ...e, cell: e.cell ?? null }));
    if (attempt) {
      const current = getBook().sheets.find((s) => s.id === attempt.sheetId)
        .cells[attempt.ref];
      const cell = { ...attempt.cell };
      if (current?.format) cell.format = current.format;
      patches.push({ ...attempt, cell });
    }
    send({
      kind: "change",
      revision,
      edits: patches,
      snapshot: attempt ? null : (getBook().snapshot ?? null),
    });
    saveStatus(
      attempt
        ? "Unsaved draft includes the attempted edit; its results are not current. Recovery pending…"
        : "Unsaved changes. Recovery pending…",
    );
    if (recoveryFailed)
      saveStatus(
        "Unsaved changes. Recovery unavailable; use Save or Save a copy.",
      );
  }
  function receive(message) {
    if (message.kind === "stored" && message.revision === dirty.revision)
      saveStatus(
        getPending()
          ? "Unsaved draft includes the attempted edit; its results are not current. Recovery stored."
          : "Unsaved changes. Recovery stored.",
      );
    else if (message.kind === "error") {
      recoveryFailed = true;
      messages.length = 0;
      saveStatus(
        `Recovery unavailable: ${message.message}. Your work remains open; use Save or Save a copy.`,
      );
    } else if (message.kind === "draft") {
      draft = message.record;
      const compatible =
        draft?.schema === 1 &&
        draft.documentId === getBook().id &&
        typeof draft.modelText === "string";
      protectedSource =
        !compatible || !!draft.protectedSource || draft.baseHash !== sourceHash;
      $("recovery-message").textContent = compatible
        ? protectedSource
          ? "A draft belongs to a different file revision. You can open it as a copy; direct overwrite of this file will be blocked."
          : "A recoverable draft exists for this file. Restoring replaces any current unsaved changes. Nothing is written to disk automatically."
        : "A recovery record cannot be read by this version. Keep this file open or discard that record.";
      $("restore-draft").disabled = !compatible;
      $("restore-draft").textContent = protectedSource
        ? "Open draft as a copy"
        : "Restore draft";
      $("recovery-dialog").showModal();
    }
  }
  void (async () => {
    [sourceHash, sourceShell] = await source;
    const key = `${getBook().id}:${await digestText(location.origin + location.pathname)}`;
    recovery = new RecoveryClient(
      $("recovery-worker-source").textContent,
      { key, baseHash: sourceHash, text: originalText },
      receive,
    );
    for (const message of messages.splice(0)) recovery.send(message);
  })().catch((error) => receive({ kind: "error", message: error.message }));

  $("restore-draft").onclick = () => {
    try {
      const book = readModel(draft.modelText);
      if (book.id !== getBook().id)
        throw new Error("Draft identity does not match this workbook");
      writer = undefined;
      restore(book);
      dirty.change();
      send({
        kind: "reset",
        text: draft.modelText,
        revision: dirty.revision,
        protectedSource,
      });
      $("recovery-dialog").close();
      saveStatus(
        protectedSource
          ? "Recovered as a copy. Choose a new empty file or use Save a copy."
          : "Recovered draft. Unsaved changes.",
      );
    } catch (error) {
      saveStatus(`Draft not restored: ${error.message}`);
    }
  };
  $("discard-draft").onclick = () => {
    send({ kind: "discard" });
    draft = null;
    protectedSource = false;
    $("recovery-dialog").close();
    saveStatus(dirty.dirty ? "Unsaved changes." : "Saved file opened.");
  };
  function capture() {
    const copy = document.documentElement.cloneNode(true),
      modelText = writeModel(documentBook());
    copy.querySelector("#workbook").textContent = modelText;
    copy.querySelector("#status").textContent = "Checking saved results…";
    copy.querySelector("#save-status").textContent = "Saved file opened.";
    copy.querySelector("#recovery-message").textContent = "";
    copy.querySelector("#restore-draft").textContent = "Restore draft";
    copy.querySelector("#restore-draft").disabled = false;
    for (const dialog of copy.querySelectorAll("dialog"))
      dialog.removeAttribute("open");
    return { html: "<!doctype html>\n" + copy.outerHTML, modelText };
  }
  $("save").onclick = () => {
    try {
      const { html } = capture(),
        url = URL.createObjectURL(
          new Blob([html], { type: "text/html;charset=utf-8" }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${getBook().id}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      saveStatus(
        getPending()
          ? "Draft copy requested with the attempted input and stale results. Verify the downloaded HTML."
          : "Copy download requested. Open the downloaded HTML to verify it; the source file has not been saved.",
      );
    } catch (error) {
      saveStatus(`Copy failed: ${error.message}. Your work remains open.`);
    }
  };
  $("direct-save").disabled = false;
  $("direct-save").onclick = async () => {
    if (writer?.busy) return;
    $("direct-save").disabled = true;
    try {
      if (!writer) {
        if (typeof window.showSaveFilePicker !== "function")
          throw new Error(
            "Direct Save is unavailable in this browser. Use Save a copy",
          );
        const handle = await window.showSaveFilePicker({
          suggestedName: `${getBook().id}.html`,
          types: [
            {
              description: "HTML workbook",
              accept: { "text/html": [".html"] },
            },
          ],
        });
        await source;
        writer = await FileWriter.attach(handle, async (text) => {
          if (!text.trim()) return;
          if (protectedSource)
            throw new Error(
              "Recovered copy cannot overwrite an existing file. Use a new file or Save a copy",
            );
          const doc = new DOMParser().parseFromString(text, "text/html"),
            node = payload(doc);
          if (
            readModel(node.textContent).id !== getBook().id ||
            (await digestText(node.textContent)) !== sourceHash ||
            (await digestText(shell(doc))) !== sourceShell
          )
            throw new Error(
              "The selected file differs from the opened document or revision. Reopen it or use Save a copy",
            );
        });
      }
      const version = dirty.revision,
        captured = capture(),
        pending = !!getPending();
      await writer.save(captured.html);
      dirty.saved(version);
      sourceHash = await digestText(captured.modelText);
      sourceShell = await digestText(
        shell(new DOMParser().parseFromString(captured.html, "text/html")),
      );
      send({ kind: "rebase", baseHash: sourceHash, clean: !dirty.dirty });
      saveStatus(
        dirty.dirty
          ? "Earlier revision saved. Later changes remain unsaved."
          : pending
            ? "Draft saved to the selected file. Results are stale until recalculated."
            : `Saved to ${writer.handle.name}.`,
      );
    } catch (error) {
      saveStatus(
        error.name === "AbortError"
          ? "Save cancelled. Your work remains open."
          : `Save failed: ${error.message}. Your work remains open.`,
      );
    } finally {
      $("direct-save").disabled = false;
    }
  };
  window.addEventListener("beforeunload", (event) => {
    if (dirty.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return {
    changed,
    reset() {
      dirty.change();
      send({
        kind: "reset",
        text: writeModel(documentBook()),
        revision: dirty.revision,
        protectedSource,
      });
    },
    get dirty() {
      return dirty.dirty;
    },
  };
}
