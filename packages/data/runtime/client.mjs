// A result delta avoids copying large raw-data sheets back to the browser UI.
export class EngineClient {
  constructor(config, source) {
    this.config = config;
    this.nextId = 0;
    this.pending = new Map();
    this.ready = Promise.resolve();
    this.url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    this.worker = new Worker(this.url);
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      this.pending.delete(data.id);
      data.error
        ? task.reject(new Error(data.error))
        : task.resolve(data.value);
    };
    this.worker.onerror = (event) => {
      for (const task of this.pending.values())
        task.reject(new Error(event.message || "Calculation worker failed"));
      this.pending.clear();
    };
  }
  request(method, args) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Calculation cancelled"));
        return;
      }
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, method, args });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  load(book) {
    this.ready = this.ready.then(() =>
      this.request("load", [book, this.config]),
    );
    return this.ready;
  }
  edit(...args) {
    this.ready = this.ready.then(() => this.request("edit", args));
    return this.ready;
  }
  editMany(edits) {
    this.ready = this.ready.then(() => this.request("editMany", [edits]));
    return this.ready;
  }
  configureValidations(header) {
    this.ready = this.ready.then(() =>
      this.request("configureValidations", [header]),
    );
    return this.ready.then((result) => {
      if (!result.applied) throw new Error(result.message);
    });
  }
  async structure(command) {
    await this.ready;
    return this.request("structure", [command]);
  }
  async organize(command) {
    await this.ready;
    return this.request("organize", [command]);
  }
  configurePivots(pivots) {
    this.ready = this.ready.then(() =>
      this.request("configurePivots", [pivots]),
    );
    return this.ready;
  }
  async pivot(definition) {
    await this.ready;
    return this.request("pivot", [definition]);
  }
  async calculate() {
    await this.ready;
    return this.request("calculate", []);
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    URL.revokeObjectURL(this.url);
    for (const task of this.pending.values())
      task.reject(new Error("Calculation cancelled"));
    this.pending.clear();
  }
}
