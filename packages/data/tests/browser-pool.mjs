// The Data browser scripts, a few at a time (npm run test:browser). Each script launches its own browser
// and writes only files prefixed with its own name, so they do not share state; the output of each is
// printed whole when it ends, with its status and duration. Exit code 1 if any script failed.
//   DATA_BROWSER_JOBS=n  scripts at a time (default 3; 1 runs them one after another, in list order)
// A script named in SERIAL runs alone after the others: they load 100k rows and gate on time limits.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Every script of the Data browser suite. A file here that is missing from tests/, or a *-browser.mjs
// there that is missing here, fails (tests/ci.test.mjs checks the same).
export const SCRIPTS = [
  "browser.mjs",
  "shell-browser.mjs",
  "rendering-browser.mjs",
  "commands-browser.mjs",
  "panels-browser.mjs",
  "pivots-browser.mjs",
  "charts-browser.mjs",
  "import-browser.mjs",
  "refresh-browser.mjs",
  "xlsx-browser.mjs",
  "picture-browser.mjs",
  "csv-browser.mjs",
  "print-browser.mjs",
  "skill-browser.mjs",
  "acceptance-browser.mjs",
  "grid-browser.mjs",
  "entry-browser.mjs",
  "literals-browser.mjs",
  "history-browser.mjs",
  "clipboard-browser.mjs",
  "clipboard-html-browser.mjs",
  "structure-browser.mjs",
  "format-browser.mjs",
  "formatting-browser.mjs",
  "sheets-browser.mjs",
  "dropdowns-browser.mjs",
  "dropdown-settings-browser.mjs",
  "conditional-browser.mjs",
  "conditional-edge-browser.mjs",
  "data-bars-browser.mjs",
  "data-bars-edge-browser.mjs",
  "recovery-discard-browser.mjs",
  "data-bar-settings-browser.mjs",
  "conformance-browser.mjs",
  "snapshots-browser.mjs",
  "persistence-browser.mjs",
  "save-in-place-browser.mjs",
  "spills-browser.mjs",
  "loading.mjs",
  "worker.mjs",
  "variants.mjs",
];
export const SERIAL = [
  "grid-browser.mjs",
  "data-bars-edge-browser.mjs",
  "conditional-edge-browser.mjs",
];

const dir = dirname(fileURLToPath(import.meta.url));

// What is wrong with the list: a name that is not a file, a duplicate, or a *-browser.mjs left out.
export function problems(
  scripts = SCRIPTS,
  serial = SERIAL,
  files = readdirSync(dir),
) {
  return [
    ...scripts
      .filter((s) => !files.includes(s))
      .map((s) => `${s} is listed but is not in tests/`),
    ...scripts
      .filter((s, i) => scripts.indexOf(s) !== i)
      .map((s) => `${s} is listed twice`),
    ...serial
      .filter((s) => !scripts.includes(s))
      .map((s) => `${s} is serial but not listed`),
    ...files
      .filter((f) => f.endsWith("-browser.mjs") && !scripts.includes(f))
      .map((f) => `${f} is not in SCRIPTS`),
  ];
}

const run = (script) =>
  new Promise((done) => {
    const start = Date.now(),
      chunks = [];
    const child = spawn(process.execPath, [`${dir}/${script}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (c) => chunks.push(c));
    const end = (status) => {
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(
        `\n===== ${script}: ${status} in ${seconds} s =====\n${Buffer.concat(chunks)}`,
      );
      done({ script, ok: status === "ok", seconds });
    };
    child.on("error", () => end("failed to start"));
    child.on("close", (code, signal) =>
      end(code === 0 ? "ok" : `FAILED (${signal ?? `exit ${code}`})`),
    );
  });

async function pool(scripts, size) {
  const results = [],
    queue = [...scripts];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let s; (s = queue.shift()); ) results.push(await run(s));
    }),
  );
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wrong = problems();
  if (wrong.length) {
    console.error(wrong.join("\n"));
    process.exit(1);
  }
  const jobs = Number(process.env.DATA_BROWSER_JOBS ?? 3);
  if (!Number.isInteger(jobs) || jobs < 1)
    throw new Error(
      `DATA_BROWSER_JOBS must be a whole number of 1 or more, got ${process.env.DATA_BROWSER_JOBS}`,
    );
  const start = Date.now();
  const results =
    jobs === 1
      ? await pool(SCRIPTS, 1)
      : [
          ...(await pool(
            SCRIPTS.filter((s) => !SERIAL.includes(s)),
            jobs,
          )),
          ...(await pool(SERIAL, 1)),
        ];
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length} scripts, ${jobs} at a time, ${((Date.now() - start) / 1000).toFixed(0)} s: ${results.length - failed.length} ok, ${failed.length} failed`,
  );
  if (failed.length)
    console.log(`Failed: ${failed.map((r) => r.script).join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}
