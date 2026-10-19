export class RecoveryClient {
  constructor(source, init, receive) {
    this.url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    this.worker = new Worker(this.url);
    this.worker.onmessage = ({ data }) => receive(data);
    this.worker.onerror = (event) =>
      receive({
        kind: "error",
        message: event.message || "Recovery worker failed",
      });
    this.send({ kind: "init", ...init });
  }
  send(message) {
    this.worker.postMessage(message);
  }
  dispose() {
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
