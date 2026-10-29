#!/usr/bin/env node
// T17: size and responsiveness of the built editor from file://, on the generated 50-page
// document and the 100-page stress fixture. Each engine opens each document once to warm up,
// then measures five runs, each in a fresh context (no draft from an earlier run): open time,
// keystroke-to-paint while typing, every editing operation's input-to-paint and (Chromium) its
// longest main-thread task, Save a copy, print preview, PDF (Chromium), memory and HTML size.
// The gate takes medians over the five runs, after a forced garbage collection (Chromium), as
// Data's bench learnt: a single-worst gate fails at random on shared runners.
//   TEXT_ENGINES=chromium,firefox,webkit node bench/browser.mjs [--pages 50,100] [--runs 5]
//     [--check] [--output <results.json>] [--profile] [--cpu-throttle <rate>]
// --check fails when a gated threshold (THRESHOLDS, Chromium) is crossed; --profile writes a
// CPU profile of each Chromium run's editing window to dist/text-bench/profiles/;
// --cpu-throttle slows Chromium's CPU by that factor once the document is open (a slower machine).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import * as playwright from "playwright";
import { buildEngine, buildDocument, measureFile } from "../tools/build.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { readPDF } from "../tests/pdf.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const PAGES = option("--pages", "50,100").split(",").map(Number);
const RUNS = Number(option("--runs", 5));
const profiling = args.includes("--profile");
const THROTTLE = Number(option("--cpu-throttle", 1));
const out = resolve(
  new URL("../../../dist/text-bench/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });

// Gated with --check, on medians over the runs, in every engine that measures the metric (long
// tasks: Chromium only). The engineering targets at 50 pages are the plan's: keystroke-to-paint
// under 50 ms and no editing task over 100 ms. The 100-page fixture is a stress document: its
// limits catch a regression without promising the 50-page targets there.
const THRESHOLDS = {
  50: { keystrokeWorstMS: 50, editingTaskMS: 100 },
  100: { keystrokeWorstMS: 100, editingTaskMS: 200 },
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);
const stats = (values) =>
  values.every((v) => v != null)
    ? {
        median: round(median(values)),
        min: round(Math.min(...values)),
        max: round(Math.max(...values)),
      }
    : null;

// Each operation's longest main-thread task: a long task belongs to the operation whose window
// (from its input to the paint after it) it overlaps; the others (the draft written to the
// browser's storage half a second after the last edit) are background work.
function longestTaskPerOperation(windows, tasks) {
  const longest = windows.map(() => 0);
  let background = 0;
  for (const task of tasks) {
    const end = task.startTime + task.duration;
    const at = windows.findIndex(
      (w) => task.startTime < w.end && end > w.start,
    );
    if (at >= 0) longest[at] = Math.max(longest[at], task.duration);
    else background = Math.max(background, task.duration);
  }
  return { longest, background };
}

// In the page before any script: when the editor is ready, the first frame after it; per input
// event, the time from the event to the paint after it (a message posted from the next animation
// frame runs once that frame is rendered); long tasks where the engine reports them.
function instrument() {
  const afterPaint = (done) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => done(performance.now());
      channel.port2.postMessage(0);
    });
  const bench = (window.bench = {
    ready: null,
    opened: null,
    inputs: [],
    tasks: [],
    measuring: false,
    afterPaint,
  });
  let api;
  Object.defineProperty(window, "htmlText", {
    configurable: true,
    get: () => api,
    set(value) {
      api = value;
      bench.ready = performance.now();
      afterPaint((t) => (bench.opened = t));
    },
  });
  addEventListener(
    "keydown",
    (event) => {
      // A shortcut counts once, at its key (not at its modifiers').
      if (!bench.measuring || event.repeat) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      const entry = { key: event.key, start: event.timeStamp, end: null };
      bench.inputs.push(entry);
      afterPaint((t) => (entry.end = t));
    },
    true,
  );
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask"))
    new PerformanceObserver((list) => {
      if (bench.measuring)
        bench.tasks.push(
          ...list
            .getEntries()
            .map((e) => ({ startTime: e.startTime, duration: e.duration })),
        );
    }).observe({ type: "longtask" });
}

// Peak resident memory of the browser's process tree, sampled every 200 ms with ps. It sums
// processes (shared pages counted more than once) and may miss short peaks.
const run = promisify(execFile);
async function treeRSS(root) {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,rss="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, parent] of rows)
      if (ids.has(parent) && !ids.has(pid)) grew = ids.add(pid);
  }
  return rows.reduce((sum, [pid, , rss]) => sum + (ids.has(pid) ? rss : 0), 0);
}
function memorySampler(root) {
  let peak = 0,
    busy = null;
  const sample = () =>
    (busy ??= treeRSS(root)
      .then((kb) => (peak = Math.max(peak, kb * 1024)))
      .catch(() => {})
      .finally(() => (busy = null)));
  const timer = setInterval(sample, 200);
  sample();
  return async () => {
    clearInterval(timer);
    await busy;
    await sample();
    return peak || null;
  };
}

const engine = await buildEngine();
const documents = [];
for (const pages of PAGES) {
  const source = await readFile(
    new URL(`fixtures/report-${pages}.html`, import.meta.url),
    "utf8",
  );
  const html = await buildDocument(source, engine);
  const path = join(out, `report-${pages}.html`);
  await writeFile(path, html);
  const words = (source.match(/<p\b[^>]*>[^]*?<\/p>/g) ?? [])
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  documents.push({
    pages,
    url: pathToFileURL(path).href,
    size: measureFile(html),
    paragraphWords: words,
    figures: (source.match(/<figure\b/g) ?? []).length,
  });
}

const TYPED = " Benchmark typing for"; // 21 keys

async function measureRun(browser, kind, doc, { server }) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(instrument);
  // Nothing leaves the machine: a request beyond file:// is counted and refused.
  const requests = [];
  await context.route(/^(?!file:)/, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const cdp = kind === "chromium" ? await context.newCDPSession(page) : null;
  const stopMemory = memorySampler(server.process().pid);
  try {
    await page.goto(doc.url, { timeout: 180000 });
    await page.waitForFunction(() => window.bench.opened != null);
    const open = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        openMS: window.bench.opened,
        readyMS: window.bench.ready,
        domContentLoadedMS: nav?.domContentLoadedEventEnd ?? null,
        domNodes: document.getElementsByTagName("*").length,
      };
    });
    // The caret at the end of the middle paragraph, its line centred on screen.
    await page.evaluate(() => {
      const { view, TextSelection } = window.htmlText;
      const paragraphs = view.dom.querySelectorAll(":scope > p");
      const p = paragraphs[paragraphs.length >> 1];
      p.scrollIntoView({ block: "center" });
      const pos = view.posAtDOM(p, p.childNodes.length);
      view.focus();
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
      );
    });
    await page.waitForTimeout(800);
    let heap = null;
    if (cdp && THROTTLE > 1)
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    if (cdp) {
      // The open leaves garbage whose major collection would land in the first edits.
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("Performance.enable");
      heap = (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === "JSHeapUsedSize",
      ).value;
      if (profiling) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
      }
    }
    await page.evaluate(() => (window.bench.measuring = true));
    // One input at a time, each waited for until painted: [label, key, set up first]. The word
    // to embolden is selected by script (headless Chromium has no word-wise selection keys).
    const selectTyped = () =>
      page.evaluate(() => {
        // The caret is after "typing for".
        const { view, TextSelection } = window.htmlText;
        const end = view.state.selection.from - " for".length;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, end - "typing".length, end),
          ),
        );
      });
    const operations = [
      ...[...TYPED].map((c) => ["type", c]),
      ["enter", "Enter"],
      ["backspace", "Backspace"],
      ["bold", `${mod}+b`, selectTyped],
      ["heading 2", `${mod}+Alt+2`],
      ["footnote", `${mod}+Alt+f`],
      ["undo", `${mod}+z`],
      ["undo", `${mod}+z`],
    ];
    // Keys are typed 30 ms apart; each other operation waits 600 ms, so that it is its own undo
    // step and the draft written 500 ms after an edit falls between operations.
    for (const [i, [label, key, before]] of operations.entries()) {
      await before?.();
      await page.keyboard.press(key);
      await page.waitForFunction(
        (n) => window.bench.inputs.length > n && window.bench.inputs[n].end,
        i,
      );
      await page.waitForTimeout(
        label === "type" && i < TYPED.length - 1 ? 30 : 600,
      );
    }
    const measured = await page.evaluate(() => {
      window.bench.measuring = false;
      return { inputs: window.bench.inputs, tasks: window.bench.tasks };
    });
    if (cdp && profiling) {
      const { profile } = await cdp.send("Profiler.stop");
      await mkdir(join(out, "profiles"), { recursive: true });
      await writeFile(
        join(out, "profiles", `report-${doc.pages}-${Date.now()}.cpuprofile`),
        JSON.stringify(profile),
      );
    }
    assert.equal(measured.inputs.length, operations.length, "one input each");
    const windows = measured.inputs.map((e) => ({
      start: e.start,
      end: e.end,
    }));
    const latency = measured.inputs.map((e) => e.end - e.start);
    const typing = latency.slice(0, TYPED.length);
    const tasks =
      kind === "chromium"
        ? longestTaskPerOperation(windows, measured.tasks)
        : null;
    const perOperation = {};
    operations.forEach(([label], i) => {
      if (label === "type") return;
      const row = (perOperation[label] ??= { inputToPaintMS: 0, taskMS: 0 });
      row.inputToPaintMS = Math.max(row.inputToPaintMS, latency[i]);
      if (tasks) row.taskMS = Math.max(row.taskMS, tasks.longest[i]);
      else row.taskMS = null;
    });

    // Save a copy: serialise, read back, write the blob (the whole synchronous save), to the paint.
    const download = page.waitForEvent("download");
    const saveMS = await page.evaluate(
      () =>
        new Promise((done) => {
          const start = performance.now();
          window.htmlText.commands.run("save-copy");
          window.bench.afterPaint((t) => done(t - start));
        }),
    );
    const copy = join(out, `saved-${kind}-${doc.pages}.html`);
    await (await download).saveAs(copy);
    const saved = await readFile(copy, "utf8");
    const report = validateFile(parseFile(saved));
    assert.deepEqual(report.errors, [], "the saved copy is valid");
    // Typed, the word emboldened, the heading and the footnote undone.
    assert.match(
      saved,
      / Benchmark <strong>typing<\/strong> for<\/p>/,
      "the saved copy holds the edits",
    );

    // Print preview: the pages laid out and drawn.
    const preview = await page.evaluate(
      () =>
        new Promise((done) => {
          const start = performance.now();
          window.htmlText.commands.run("preview");
          window.bench.afterPaint((t) =>
            done({ ms: t - start, pages: window.htmlText.preview.pages }),
          );
        }),
    );
    await page.evaluate(() => window.htmlText.preview.close());
    let pdf = null;
    if (kind === "chromium") {
      const start = performance.now();
      const bytes = await page.pdf({ preferCSSPageSize: true });
      pdf = {
        ms: performance.now() - start,
        pages: readPDF(bytes).pages.length,
        bytes: bytes.length,
      };
    }
    let heapAfter = null;
    if (cdp) {
      await cdp.send("HeapProfiler.collectGarbage");
      heapAfter = (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === "JSHeapUsedSize",
      ).value;
    }
    assert.deepEqual(errors, []);
    return {
      ...open,
      keystrokeMedianMS: median(typing),
      keystrokeWorstMS: Math.max(...typing),
      keystrokes: typing.map(round),
      editingTaskMS: tasks ? Math.max(...tasks.longest) : null,
      backgroundTaskMS: tasks ? tasks.background : null,
      operations: perOperation,
      saveMS,
      savedBytes: Buffer.byteLength(saved),
      previewMS: preview.ms,
      previewPages: preview.pages,
      pdfMS: pdf?.ms ?? null,
      pdfPages: pdf?.pages ?? null,
      pdfBytes: pdf?.bytes ?? null,
      jsHeapAfterOpenBytes: heap,
      jsHeapAfterEditingBytes: heapAfter,
      peakBrowserTreeRSSBytes: await stopMemory(),
      blockedRequests: requests.length,
    };
  } finally {
    await stopMemory();
    await context.close();
  }
}

const METRICS = [
  "openMS",
  "keystrokeMedianMS",
  "keystrokeWorstMS",
  "editingTaskMS",
  "backgroundTaskMS",
  "saveMS",
  "previewMS",
  "pdfMS",
  "jsHeapAfterOpenBytes",
  "jsHeapAfterEditingBytes",
  "peakBrowserTreeRSSBytes",
];

const results = {
  environment: {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(),
    playwright: JSON.parse(
      await readFile(
        new URL(
          "../../../node_modules/playwright/package.json",
          import.meta.url,
        ),
      ),
    ).version,
    browsers: {},
    ci: !!process.env.CI,
    cpuThrottle: THROTTLE,
    // Other work on the machine skews the timings: the 1-minute load average before and after.
    loadAverage: { before: round(os.loadavg()[0]), after: null },
  },
  method:
    "Built standard file from file:// (no network; any request is refused and counted), viewport 1280×900. Per engine and document: one warm-up run, discarded, then the measured runs, each in a fresh browser context of the same browser. Open: navigation start to the first frame after the editor is ready. Keystroke-to-paint: from the key event's timestamp to the end of the next rendered frame (a message posted from requestAnimationFrame), one key at a time, 21 characters typed at the end of the middle paragraph. Editing operations (Enter, Backspace, word selection, bold, heading 2 and back, footnote, two undos): input-to-paint each, and in Chromium the longest main-thread task (Long Tasks API, 50 ms and over) overlapping it; long tasks outside every operation (the draft written 500 ms after the last edit) are reported as background. Chromium collects garbage before the editing window. Save: File › Save a copy (serialise, read back, blob) to the next paint; the copy is validated. Print preview: the command to the next paint. PDF: Playwright page.pdf in Chromium only. Memory: Chromium JS heap after a forced collection; the browser process tree's peak RSS sampled every 200 ms with ps (shared pages counted more than once). Medians over the runs.",
  thresholds: THRESHOLDS,
  documents: documents.map(({ url, ...d }) => d),
  engines: {},
};

for (const kind of ENGINES) {
  const server = await playwright[kind].launchServer();
  const browser = await playwright[kind].connect(server.wsEndpoint());
  results.environment.browsers[kind] = browser.version();
  results.engines[kind] = {};
  try {
    for (const doc of documents) {
      await measureRun(browser, kind, doc, { server });
      const runs = [];
      for (let i = 0; i < RUNS; i++)
        runs.push(await measureRun(browser, kind, doc, { server }));
      const summary = Object.fromEntries(
        METRICS.map((m) => [m, stats(runs.map((r) => r[m]))]),
      );
      const operations = {};
      for (const label of Object.keys(runs[0].operations))
        operations[label] = {
          inputToPaintMS: stats(
            runs.map((r) => r.operations[label].inputToPaintMS),
          ),
          taskMS: stats(runs.map((r) => r.operations[label].taskMS)),
        };
      const limits = THRESHOLDS[doc.pages];
      const targets = Object.fromEntries(
        Object.entries(limits ?? {})
          .filter(([m]) => summary[m])
          .map(([m, limit]) => [
            m,
            {
              limit,
              median: summary[m].median,
              passed: summary[m].median < limit,
            },
          ]),
      );
      results.engines[kind][doc.pages] = {
        summary,
        operations,
        previewPages: runs[0].previewPages,
        pdfPages: runs[0].pdfPages,
        domNodes: runs[0].domNodes,
        savedBytes: runs[0].savedBytes,
        blockedRequests: Math.max(...runs.map((r) => r.blockedRequests)),
        targets,
        runs,
      };
      console.log(
        `${kind} ${doc.pages} pages: open ${summary.openMS.median} ms, keystroke ${summary.keystrokeMedianMS.median} ms (worst ${summary.keystrokeWorstMS.median}), editing task ${summary.editingTaskMS?.median ?? "n/a"} ms, background ${summary.backgroundTaskMS?.median ?? "n/a"} ms, save ${summary.saveMS.median} ms, preview ${summary.previewMS.median} ms, PDF ${summary.pdfMS?.median ?? "n/a"} ms`,
      );
      await writeFile(
        join(out, "results.json"),
        JSON.stringify(results, null, 2) + "\n",
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

results.environment.loadAverage.after = round(os.loadavg()[0]);
const output = option("--output", null);
if (output)
  await writeFile(resolve(output), JSON.stringify(results, null, 2) + "\n");
if (args.includes("--check")) {
  const failed = [];
  for (const [kind, byPages] of Object.entries(results.engines))
    for (const [pages, r] of Object.entries(byPages))
      for (const [metric, t] of Object.entries(r.targets ?? {}))
        if (!t.passed)
          failed.push(
            `${kind} ${pages} pages: ${metric} median ${t.median} ms, limit ${t.limit} ms`,
          );
  if (failed.length) {
    console.error(`FAIL text bench:\n${failed.join("\n")}`);
    process.exit(1);
  }
  console.log("PASS text bench: every gated median under its threshold");
}
