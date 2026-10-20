import { loadEngine } from "./loader.mjs";
import { EngineSession } from "../engine/adapter.mjs";
let session,
  module,
  queue = Promise.resolve();
self.onmessage = (event) => {
  queue = queue.then(async () => {
    const { id, method, args } = event.data;
    try {
      let value;
      if (method === "load") {
        const start = performance.now();
        if (!module) module = await loadEngine(args[1]);
        const loadedAt = performance.now();
        session ??= new EngineSession(module);
        session.load(args[0]);
        value = {
          initialiseMS: performance.now() - start,
          dependencyLoadMS: loadedAt - start,
          modelLoadMS: performance.now() - loadedAt,
          dependencyMetrics: module.loadingMetrics,
        };
      } else if (method === "edit") {
        session.edit(...args);
        value = null;
      } else if (method === "editMany") {
        session.editMany(...args);
        value = null;
      } else if (method === "configureValidations") {
        const previous = session.book;
        try {
          session.configureValidations(args[0]);
          value = { applied: true };
        } catch (error) {
          // Only an unchanged header is a safe validation rejection. Transport or
          // post-mutation failures keep the ordinary failed-session behavior.
          if (session.book !== previous) throw error;
          value = { applied: false, message: error.message };
        }
      } else if (method === "structure") {
        value = await session.structure(args[0]);
      } else if (method === "organize") {
        value = await session.organize(args[0]);
      } else if (method === "calculate") {
        const start = performance.now();
        value = await session.calculateDelta();
        value.calculateMS = performance.now() - start;
        value.wasmMemoryBytes = module.wasmMemory?.buffer.byteLength ?? null;
      } else throw new Error("Unsupported engine operation");
      self.postMessage({ id, value });
    } catch (error) {
      self.postMessage({ id, error: error.message });
    }
  });
};
