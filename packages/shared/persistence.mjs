// Local-file persistence shared by html-office products (Data T07, Text T03): explicit file
// binding with staged-write conflict checks, a dirty-revision counter and IndexedDB drafts.
export async function digestText(text) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export class DirtyState {
  revision = 0;
  savedRevision = 0;
  change() {
    return ++this.revision;
  }
  saved(revision) {
    this.savedRevision = Math.max(this.savedRevision, revision);
  }
  get dirty() {
    return this.revision !== this.savedRevision;
  }
}
export class FileWriter {
  static async attach(handle, validate = () => {}) {
    const text = await (await handle.getFile()).text();
    await validate(text);
    return new FileWriter(handle, await digestText(text));
  }
  constructor(handle, baseline) {
    this.handle = handle;
    this.baseline = baseline;
    this.busy = false;
  }
  async unchanged() {
    if (
      (await digestText(await (await this.handle.getFile()).text())) !==
      this.baseline
    )
      throw new Error(
        "The file changed externally. Reopen it or use Save a copy; nothing was overwritten.",
      );
  }
  async save(text) {
    if (this.busy) throw new Error("A save is already in progress");
    this.busy = true;
    let stream;
    try {
      await this.unchanged();
      stream = await this.handle.createWritable();
      await stream.write(text);
      // https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable
      // Writes are staged until close. Recheck the original before committing.
      await this.unchanged();
      await stream.close();
      this.baseline = await digestText(text);
    } catch (error) {
      try {
        await stream?.abort();
      } catch {
        /* Preserve the original failure. */
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
}

// ---- Save in place (Chrome, Edge) ----
// A page opened from disk has no handle to its own file: the first Save asks for one with the
// save picker, which behaves as Save As everywhere (the system asks before replacing a file).
// Chromium empties the chosen file before the page sees it, so nothing can be checked there: a
// chosen file with the opened file's name counts as the opened file. Its handle is remembered in
// IndexedDB, keyed by the file's address, and reused when the file is opened again, but only
// while it still has the opened file's name and holds exactly the document opened (the browser
// asks for write permission inside the Save gesture). Anything else falls back to the picker,
// with nothing written.

export const canSaveInPlace = () =>
  typeof globalThis.showSaveFilePicker === "function";

// The opened file's name, from its address: what the picker suggests and Save replaces.
export function openedFileName(fallback = "document.html") {
  try {
    return (
      decodeURIComponent(location.pathname.split("/").pop() || "") || fallback
    );
  } catch {
    return fallback;
  }
}

export const COPY_ONLY_NOTICE =
  "This browser can only download copies. To save in place, open the file in Chrome or Edge.";
// Where Save can only download a copy (Safari, Firefox, Brave), the notice is shown once per
// browsing session of the tab.
let copyOnlyShown = false;
export function copyOnlyNotice() {
  if (copyOnlyShown) return "";
  copyOnlyShown = true;
  try {
    if (sessionStorage.getItem("html-office:copy-only-notice")) return "";
    sessionStorage.setItem("html-office:copy-only-notice", "1");
  } catch {
    /* Without session storage the notice is shown once per page. */
  }
  return COPY_ONLY_NOTICE;
}

// Remembered handles: one shared database, keyed by the digest of the file's address.
let handleStore = null;
const handles = () =>
  (handleStore ??= draftDatabase("html-office-file-handles", "handles"));

// Write permission on a handle, asked inside the Save gesture. Handles without the permission
// methods (tests, older engines) are writable once chosen.
async function writable(handle) {
  const mode = { mode: "readwrite" };
  if (typeof handle.queryPermission !== "function") return true;
  if ((await handle.queryPermission(mode)) === "granted") return true;
  if (typeof handle.requestPermission !== "function") return false;
  return (await handle.requestPermission(mode)) === "granted";
}

// The name suggested for a recovered draft of another revision: Save As should not default to
// replacing the newer file.
export function recoveredName(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}-recovered${name.slice(dot)}`
    : `${name}-recovered`;
}

// purpose: the picker id, so that Chromium reopens the folder last used for it. description,
// fallbackName: the picker's file type and the name suggested when the address has none.
// matches(text): whether a remembered file's text is exactly the document opened here (it may
// throw on text it cannot read); only then is the remembered file reused. recovered(): the
// document is a draft of another revision of the file; Save never reuses the remembered file
// and the picker suggests recoveredName(name). address: the digest of the file's address, when
// the product already computes it.
export class FileBinding {
  constructor({
    purpose,
    description,
    fallbackName,
    matches,
    recovered = () => false,
    address = digestText(location.origin + location.pathname),
  }) {
    this.purpose = purpose;
    this.description = description;
    this.name = openedFileName(fallbackName);
    this.matches = matches;
    this.recovered = recovered;
    this.writer = null;
    this.chosen = null;
    this.key = address;
    // Loaded on open. Save uses it only once loaded: the gesture never waits on storage, and
    // storage that does not answer leaves Save with the picker.
    this.remembered = null;
    // A remembered handle is checked once: a later Save goes straight to the picker (the check
    // may have outlasted the activation the picker needs).
    this.checked = false;
    this.key
      .then((key) => handles().get(key))
      .then((handle) => {
        if (handle?.kind === "file") this.remembered = handle;
      })
      .catch(() => {});
  }
  // A restored draft replaces the document: the next Save binds a file again.
  reset() {
    this.writer = null;
    this.chosen = null;
  }
  // The remembered handle, when it is still the opened file: its name and its content.
  async reuse() {
    const handle = this.remembered;
    if (!handle || handle.name !== this.name || this.recovered()) return null;
    if (this.checked) return null;
    this.checked = true;
    try {
      if (!(await writable(handle))) return null;
      const text = await (await handle.getFile()).text();
      if (!text.trim() || !(await this.matches(text))) return null;
      return { handle, text };
    } catch {
      // Moved, deleted, unreadable or refused: the picker decides, nothing is written.
      return null;
    }
  }
  async choose() {
    const remembered = this.remembered;
    const handle = await globalThis.showSaveFilePicker({
      suggestedName: this.recovered() ? recoveredName(this.name) : this.name,
      id: this.purpose,
      // The folder of the file saved last time from this address.
      ...(remembered ? { startIn: remembered } : {}),
      types: [
        { description: this.description, accept: { "text/html": [".html"] } },
      ],
    });
    // What the file holds now (Chromium has already emptied it): later saves check that nothing
    // else wrote it in between.
    return { handle, text: await (await handle.getFile()).text() };
  }
  // Writes text to the bound file, binding one first. Returns {name, first, opened}: the file's
  // name, whether this is the first successful save to it and whether it is the opened file
  // (reused, or chosen with the opened file's name).
  async save(text) {
    if (!this.writer) {
      let found = await this.reuse();
      if (!found) {
        try {
          found = await this.choose();
        } catch (error) {
          // A permission prompt can outlast the click the picker needs.
          if (
            error?.name === "SecurityError" ||
            error?.name === "NotAllowedError"
          )
            throw new Error(
              "The browser did not open the file picker, so nothing was written. Save again to choose a file",
            );
          throw error;
        }
      }
      this.writer = new FileWriter(found.handle, await digestText(found.text));
      this.chosen = {
        opened: found.handle.name === this.name,
        announced: false,
      };
    }
    await this.writer.save(text);
    const { opened, announced } = this.chosen;
    this.chosen.announced = true;
    // Only the opened file itself is remembered for its address (never a new name). Storage
    // that does not answer must not hold up the save.
    if (!announced && opened)
      await Promise.race([
        this.key
          .then((key) => handles().put(key, this.writer.handle))
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    return { name: this.writer.handle.name, first: !announced, opened };
  }
  // The message after a successful save.
  message({ name, first, opened }) {
    if (!first) return `Saved to ${name}.`;
    if (opened) return `Saved to ${name}. Next saves write to it directly.`;
    return `Saved to ${name}. The opened file, ${this.name}, is unchanged; open ${name} to keep working on it.`;
  }
}

// IndexedDB permits larger drafts than synchronous localStorage, with explicit errors.
// Each product keeps its drafts in its own database.
export function draftDatabase(
  name = "html-office-data-recovery",
  storeName = "drafts",
) {
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recovery storage is blocked"));
  });
  async function run(method, key, value) {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        storeName,
        method === "get" ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore(storeName);
      const request =
        method === "put" ? store.put(value, key) : store[method](key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Recovery transaction aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  }
  // Several reads and writes in one readwrite transaction: work(store) issues requests (callback
  // style, so the transaction stays active); resolves once it commits, with work's return value.
  async function update(work) {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const result = work(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Recovery transaction aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  }
  return {
    get: (key) => run("get", key),
    put: (key, value) => run("put", key, value),
    delete: (key) => run("delete", key),
    update,
  };
}
