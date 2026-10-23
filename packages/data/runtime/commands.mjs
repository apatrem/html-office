// Command/state API between the Data runtime and its editor shell (U04-Data).
// Runtime modules register what they can do; the shell only runs commands and
// reads their enabled state, so menus and toolbar share one entry point each.
export function createCommands() {
  const specs = new Map(),
    listeners = new Set();
  return {
    register(id, run, enabled = () => true) {
      if (specs.has(id)) throw new Error(`Duplicate command ${id}`);
      specs.set(id, { run, enabled });
    },
    has: (id) => specs.has(id),
    enabled: (id) => !!specs.get(id)?.enabled(),
    run(id, ...args) {
      const spec = specs.get(id);
      if (!spec) throw new Error(`Unknown command ${id}`);
      if (spec.enabled()) return spec.run(...args);
    },
    // The runtime calls changed() after any state change the shell shows.
    subscribe(listener) {
      listeners.add(listener);
    },
    changed() {
      for (const listener of listeners) listener();
    },
  };
}
