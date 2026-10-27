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

// IndexedDB permits larger drafts than synchronous localStorage, with explicit errors.
// Each product keeps its drafts in its own database.
export function draftDatabase(name = "html-office-data-recovery") {
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recovery storage is blocked"));
  });
  async function run(method, key, value) {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        "drafts",
        method === "get" ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("drafts");
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
      const transaction = db.transaction("drafts", "readwrite");
      const result = work(transaction.objectStore("drafts"));
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
