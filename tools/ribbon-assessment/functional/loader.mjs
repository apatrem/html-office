const config = JSON.parse(
  document.getElementById("toolbar-config").textContent,
);
const bridge = globalThis.HTMLDataToolbarBridge;
const activate = document.getElementById("activate-toolbar"),
  status = document.getElementById("toolbar-status"),
  mount = document.getElementById("assessment-mount");
mount.replaceChildren(); // A saved DOM is presentation, never a mounted React tree.
for (const n of document.querySelectorAll("[data-assessment-transient]"))
  n.remove();
activate.disabled = false;
activate.textContent = "Enable editing toolbar";
status.textContent =
  "Experimental " +
  config.mode +
  " toolbar. Existing commands remain available below. Grey controls are unsupported.";
let ready = false;
globalThis.toolbarAssessmentMetrics = { mode: config.mode };
const metrics = globalThis.toolbarAssessmentMetrics;
// Reuse the existing grid viewport layout when the experimental UI changes height.
const layoutObserver = new ResizeObserver(() =>
  window.dispatchEvent(new Event("resize")),
);
layoutObserver.observe(mount);
layoutObserver.observe(document.querySelector(".assessment-note"));
async function verified(bytes, sha) {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== sha) throw new Error("Toolbar asset integrity mismatch");
  return bytes;
}
async function bytes(asset) {
  if (config.mode === "cdn") {
    const response = await fetch(asset.url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Toolbar HTTP " + response.status);
    return verified(await response.arrayBuffer(), asset.sha256);
  }
  if (typeof DecompressionStream !== "function")
    throw new Error(
      "Gzip decoding is unavailable in this browser; use Existing editing commands",
    );
  const compressed = Uint8Array.from(
    atob(document.getElementById(asset.id).textContent),
    (c) => c.charCodeAt(0),
  );
  const start = performance.now();
  const decoded = await new Response(
    new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  metrics.decompressionMs =
    (metrics.decompressionMs ?? 0) + performance.now() - start;
  return verified(decoded, asset.sha256);
}
activate.onclick = async () => {
  if (ready) return;
  activate.disabled = true;
  status.textContent = "Loading verified editing toolbar…";
  const start = performance.now();
  const longTasks = [];
  const observer =
    typeof PerformanceObserver === "function" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((list) =>
          longTasks.push(
            ...list
              .getEntries()
              .map((e) => ({ start: e.startTime, duration: e.duration })),
          ),
        )
      : null;
  observer?.observe({ type: "longtask" });
  let url;
  try {
    if (config.mode === "native")
      await globalThis.mountNativeAssessmentToolbar(mount, bridge);
    else {
      const [js, css] = await Promise.all([
        bytes(config.js),
        bytes(config.css),
      ]);
      metrics.assetsReadyMs = performance.now() - start;
      const style = document.createElement("style");
      style.dataset.assessmentTransient = "";
      style.textContent = new TextDecoder().decode(css);
      document.head.append(style);
      const script = document.createElement("script");
      script.dataset.assessmentTransient = "";
      url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
      script.src = url;
      const executionStart = performance.now();
      try {
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () =>
            reject(new Error("Toolbar script execution blocked"));
          document.head.append(script);
        });
      } finally {
        script.remove();
      }
      metrics.parseExecuteMs = performance.now() - executionStart;
      const mountStart = performance.now();
      await globalThis.mountAssessmentToolbar(mount, bridge);
      metrics.mountMs = performance.now() - mountStart;
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    metrics.readyMs = performance.now() - start;
    ready = true;
    status.textContent =
      "Editing toolbar ready. Grey controls are unsupported in the current workbook model.";
    activate.textContent = "Editing toolbar enabled";
  } catch (error) {
    mount.replaceChildren();
    for (const n of document.querySelectorAll("[data-assessment-transient]"))
      n.remove();
    status.textContent =
      error.message +
      ". Your workbook remains open. Retry or use Existing editing commands.";
    activate.disabled = false;
    activate.textContent = "Retry editing toolbar";
  } finally {
    if (observer) {
      longTasks.push(
        ...observer
          .takeRecords()
          .map((e) => ({ start: e.startTime, duration: e.duration })),
      );
      observer.disconnect();
    }
    metrics.longTasks = longTasks;
    if (url) URL.revokeObjectURL(url);
  }
};
