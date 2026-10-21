import { readModel, writeModel } from "./document-model.mjs";
import { DirtyState, FileWriter, digestText } from "./persistence.mjs";
import { RecoveryClient } from "./recovery.mjs";
import { overlayDraft, draftPatches, pendingList } from "../model/pending.mjs";
import { captureHead } from "../model/structure.mjs";

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

export function setupPersistence({
  getBook,
  getPending,
  restore,
  isSnapshotCurrent = () => false,
  onConditionalScales = () => {},
}) {
  const $ = (id) => document.getElementById(id),
    dirty = new DirtyState();
  let resolveInitialSnapshot, rejectInitialSnapshot;
  const initialSnapshot = new Promise((resolve, reject) => {
    resolveInitialSnapshot = resolve;
    rejectInitialSnapshot = reject;
  });
  const originalText = payload(document).textContent;
  const source = Promise.all([
    digestText(originalText),
    digestText(shell(document)),
  ]);
  let sourceHash,
    sourceShell,
    writer,
    recovery,
    recoveryFailed = null,
    workerFailed = false,
    recoveryReady = false,
    saveInProgress = false,
    feedbackRevision = null,
    protectedSource = false,
    draft,
    discardPending = false;
  const messages = [];
  const saveStatus = (text) => ($("save-status").textContent = text);
  const saveFeedback = (text) => {
    feedbackRevision = dirty.revision;
    saveStatus(text);
  };
  const send = (message) => {
    if (workerFailed) return;
    if (recovery) recovery.send(message);
    else messages.push(message);
  };
  function documentBook() {
    return overlayDraft(getBook(), getPending());
  }
  function analysisOptions() {
    return {
      formulaResultsCurrent: isSnapshotCurrent(),
      canonicalOverrides: (getBook().conditionalFormats?.some(
        (r) => r.kind === "dataBar" && r.scale.kind === "auto",
      )
        ? (getPending() ?? [])
        : []
      ).map((edit) => ({
        sheetId: edit.sheetId,
        ref: edit.ref,
        cell:
          getBook().sheets.find((s) => s.id === edit.sheetId).cells[edit.ref] ??
          null,
      })),
    };
  }
  function refreshConditionalScales() {
    onConditionalScales(null);
    send({ kind: "analyse", revision: dirty.revision, ...analysisOptions() });
  }
  // Pending rich-paste link changes live in the sheet head: recovery receives
  // the head of the overlaid draft while they exist and once more after they
  // are published, replaced or discarded.
  let pendingLinks = false;
  function changed(edits = [], changes = {}) {
    const revision = dirty.change(),
      attempt = getPending();
    const patches = edits.map((e) => ({ ...e, cell: e.cell ?? null }));
    patches.push(...draftPatches(getBook(), attempt));
    const linked = pendingList(attempt).some((a) => a.link !== undefined),
      head =
        changes.head || linked || pendingLinks
          ? captureHead(documentBook())
          : undefined;
    pendingLinks = linked;
    onConditionalScales(null);
    send({
      kind: "change",
      ...analysisOptions(),
      ...changes,
      ...(head ? { head } : {}),
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
        `Unsaved changes. Recovery unavailable: ${recoveryFailed}. Use Save or Save a copy.`,
      );
  }
  const compatibleDraft = (record) =>
    record?.schema === 1 &&
    record.documentId === getBook().id &&
    typeof record.modelText === "string";
  function receive(message) {
    if (message.kind === "conditional-scales") {
      if (!workerFailed && message.revision === dirty.revision)
        onConditionalScales(message.scales);
    } else if (message.kind === "inspected") {
      resolveInitialSnapshot(message.state);
    } else if (message.kind === "inspection-failed") {
      rejectInitialSnapshot(
        new Error(message.message || "Snapshot verification unavailable"),
      );
    } else if (message.kind === "ready") {
      if (discardPending) {
        if (!message.discarded) return;
        discardPending = false;
        draft = null;
        protectedSource = false;
        $("discard-draft").disabled = false;
        $("recovery-dialog").close();
        saveStatus(dirty.dirty ? "Unsaved changes." : "Saved file opened.");
      }
      recoveryReady = true;
      $("direct-save").disabled = false;
    } else if (
      message.kind === "stored" &&
      !recoveryFailed &&
      dirty.dirty &&
      !saveInProgress &&
      feedbackRevision !== dirty.revision &&
      message.revision === dirty.revision
    )
      saveStatus(
        getPending()
          ? "Unsaved draft includes the attempted edit; its results are not current. Recovery stored."
          : "Unsaved changes. Recovery stored.",
      );
    else if (["error", "storage-error"].includes(message.kind)) {
      if (message.kind === "error") {
        workerFailed = true;
        onConditionalScales(null);
      }
      rejectInitialSnapshot(
        new Error(message.message || "Recovery worker unavailable"),
      );
      recoveryFailed = message.message || "Storage unavailable";
      if ($("recovery-dialog").open) {
        const reason = discardPending
          ? "Draft not discarded"
          : "Recovery unavailable";
        discardPending = false;
        $("discard-draft").disabled = true;
        $("restore-draft").disabled = !compatibleDraft(draft);
        $("recovery-message").textContent =
          `${reason}: ${message.message}. The record and source-revision protection are retained. ${compatibleDraft(draft) ? "Restore the draft, or reopen this file to retry." : "Reopen this file to resolve the incompatible recovery record."}`;
      }
      recoveryReady = !$("recovery-dialog").open;
      $("direct-save").disabled = !recoveryReady;
      if (workerFailed) messages.length = 0;
      saveStatus(
        `Recovery unavailable: ${message.message}. Your work remains open; use Save or Save a copy.`,
      );
    } else if (message.kind === "draft") {
      recoveryReady = false;
      $("direct-save").disabled = true;
      draft = message.record;
      const compatible = compatibleDraft(draft);
      protectedSource =
        !compatible || !!draft.protectedSource || draft.baseHash !== sourceHash;
      $("recovery-message").textContent = compatible
        ? protectedSource
          ? "A draft belongs to a different file revision. You can open it as a copy; direct overwrite of this file will be blocked."
          : "A recoverable draft exists for this file. Restoring replaces any current unsaved changes. Nothing is written to disk automatically."
        : "A recovery record cannot be read by this version. Keep this file open or discard that record.";
      $("discard-draft").disabled = false;
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

  // Recovery must be resolved explicitly; Escape must not strand a blocked draft.
  $("recovery-dialog").addEventListener("cancel", (event) =>
    event.preventDefault(),
  );
  $("restore-draft").onclick = () => {
    try {
      const book = readModel(draft.modelText);
      if (book.id !== getBook().id)
        throw new Error("Draft identity does not match this workbook");
      writer = undefined;
      restore(book);
      dirty.change();
      onConditionalScales(null);
      send({
        kind: "reset",
        ...analysisOptions(),
        text: draft.modelText,
        revision: dirty.revision,
        protectedSource,
      });
      recoveryReady = true;
      $("direct-save").disabled = false;
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
    if (discardPending || workerFailed) return;
    discardPending = true;
    $("discard-draft").disabled = true;
    $("restore-draft").disabled = true;
    $("recovery-message").textContent =
      "Discarding the recovery record… Source-revision protection remains active until storage confirms deletion.";
    send({ kind: "discard" });
  };
  function capture() {
    const copy = document.documentElement.cloneNode(true),
      modelText = writeModel(documentBook());
    copy.querySelector("#workbook").textContent = modelText;
    copy.querySelector("#status").textContent = "Checking saved results…";
    copy.querySelector("#save-status").textContent = "Saved file opened.";
    copy.querySelector("#recovery-message").textContent = "";
    copy.querySelector("#paste-preview")?.replaceChildren();
    copy.querySelector("#sheet-context")?.replaceChildren();
    copy.querySelector("#dropdown-context")?.replaceChildren();
    copy.querySelector("#conditional-context")?.replaceChildren();
    for (const field of copy.querySelectorAll("#conditional-dialog textarea"))
      field.replaceChildren();
    copy.querySelector("#dropdown-list-values")?.replaceChildren();
    const pasteText = copy.querySelector("#paste-text");
    if (pasteText) pasteText.textContent = "";
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
      saveFeedback(
        getPending()
          ? "Draft copy requested with the attempted input and stale results. Verify the downloaded HTML."
          : "Copy download requested. Open the downloaded HTML to verify it; the source file has not been saved.",
      );
    } catch (error) {
      saveFeedback(`Copy failed: ${error.message}. Your work remains open.`);
    }
  };
  $("direct-save").disabled = true;
  $("direct-save").onclick = async () => {
    if (writer?.busy || !recoveryReady) return;
    $("direct-save").disabled = true;
    saveInProgress = true;
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
      saveFeedback(
        dirty.dirty
          ? "Earlier revision saved. Later changes remain unsaved."
          : pending
            ? "Draft saved to the selected file. Results are stale until recalculated."
            : `Saved to ${writer.handle.name}.`,
      );
    } catch (error) {
      saveFeedback(
        error.name === "AbortError"
          ? "Save cancelled. Your work remains open."
          : `Save failed: ${error.message}. Your work remains open.`,
      );
    } finally {
      saveInProgress = false;
      $("direct-save").disabled = !recoveryReady;
    }
  };
  window.addEventListener("beforeunload", (event) => {
    if (dirty.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return {
    initialSnapshot,
    changed,
    refreshConditionalScales,
    reset() {
      dirty.change();
      onConditionalScales(null);
      send({
        kind: "reset",
        ...analysisOptions(),
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
