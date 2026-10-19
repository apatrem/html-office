export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function verify(bytes, expected) {
  if ((await sha256(bytes)) !== expected)
    throw new Error("Engine integrity check failed. Nothing was executed.");
  return bytes;
}
function decode(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export async function loadEngine(config, { signal } = {}) {
  const started = performance.now();
  async function component(name) {
    const item = config[name];
    let bytes;
    if (config.embedded?.[name]) bytes = decode(config.embedded[name]);
    else {
      const response = await fetch(item.url, {
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        mode: "cors",
      });
      if (!response.ok)
        throw new Error(
          `Engine download failed (${response.status}). Your attempted edit is retained.`,
        );
      bytes = await response.arrayBuffer();
    }
    if (item.transport) {
      await verify(bytes, item.transport.sha256);
      if (
        item.transport.encoding !== "gzip" ||
        typeof DecompressionStream === "undefined"
      )
        throw new Error(
          "This browser cannot decode the embedded engine. Use Chrome or Edge.",
        );
      bytes = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
    }
    if (bytes.byteLength !== item.bytes)
      throw new Error(
        "Engine integrity check failed: unexpected decoded size.",
      );
    return verify(bytes, item.sha256);
  }
  // Both components must pass integrity before any downloaded JS executes.
  const [js, wasm] = await Promise.all([component("js"), component("wasm")]);
  signal?.throwIfAborted();
  const verifiedAt = performance.now();
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    const module = await import(url);
    const exports = await module.default({ module_or_path: wasm });
    signal?.throwIfAborted();
    return {
      ...module,
      wasmMemory: exports.memory,
      loadingMetrics: {
        fetchDecompressVerifyMS: verifiedAt - started,
        importInstantiateMS: performance.now() - verifiedAt,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
