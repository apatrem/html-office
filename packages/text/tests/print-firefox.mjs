// T14 in stock Firefox, which Playwright's Firefox cannot print to PDF: the print fixture and the
// example are printed over WebDriver BiDi (browsingContext.print) from the editor, from the editor
// with the print preview open, and as the bare file (no engine). The editor prints the bare file's
// pages: the same count, none blank (Firefox printed a blank last page from the editor), the
// document's last words on the last page.
//   node tests/print-firefox.mjs        (FIREFOX=/path/to/firefox; default: the macOS app, else PATH)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { readPDF } from "./pdf.mjs";

const MAC = "/Applications/Firefox.app/Contents/MacOS/firefox";
const FIREFOX = process.env.FIREFOX || (existsSync(MAC) ? MAC : "firefox");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const engine = await buildEngine();
// [fixture, the last words printed: the end of its notes list]
const DOCUMENTS = [
  ["print", "Sources: fictional branch returns."],
  ["example", "Fictional management accounts, unaudited."],
];
const urls = {};
for (const [name] of DOCUMENTS) {
  const source = await readFile(
    new URL(`../fixtures/valid/${name}.html`, import.meta.url),
    "utf8",
  );
  for (const [kind, html] of [
    ["bare", source],
    ["editor", await buildDocument(source, engine)],
  ]) {
    const path = join(out, `firefox-${name}-${kind}.html`);
    await writeFile(path, html);
    urls[`${name}-${kind}`] = pathToFileURL(path).href;
  }
}

// Firefox with its WebDriver BiDi server on a free port, in a profile of its own.
const profile = await mkdtemp(join(tmpdir(), "text-firefox-"));
await writeFile(
  join(profile, "user.js"),
  process.env.PF_A11Y_OFF ? 'user_pref("accessibility.force_disabled", 1);\n' : "",
);
const firefox = spawn(
  FIREFOX,
  ["--headless", "--remote-debugging-port", "0", "--profile", profile],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const address = await new Promise((resolve, reject) => {
  let log = "";
  firefox.on("error", reject);
  firefox.on("exit", (code) =>
    reject(new Error(`${FIREFOX} exited (${code}): ${log}`)),
  );
  firefox.stderr.on("data", (data) => {
    log += data;
    if (process.env.PF_DIAG) appendFileSync(process.env.PF_DIAG, data);
    const found = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
    if (found) resolve(found[1]);
  });
  setTimeout(() => {
    firefox.kill();
    reject(new Error(`${FIREFOX} did not start WebDriver BiDi: ${log}`));
  }, 60_000).unref();
});
const socket = new WebSocket(`${address}/session`);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
firefox.on("exit", (code, signal) => console.log(`DIAG firefox exit ${code} ${signal}`));
socket.addEventListener("close", (e) => console.log(`DIAG socket close ${e.code} ${e.reason}`));
let last = 0;
const T0 = Date.now();
const waiting = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  waiting.get(message.id)?.(message);
  waiting.delete(message.id);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++last;
    waiting.set(id, (m) =>
      m.type === "error"
        ? reject(new Error(`${method}: ${m.error}: ${m.message}`))
        : resolve(m.result),
    );
    const t0 = Date.now();
    const inner = waiting.get(id);
    const target = (params.url || "").split("/").pop();
    waiting.set(id, (m) => {
      console.log(`DIAG ${((Date.now() - T0) / 1000).toFixed(2)} ${method} ${target} ${Date.now() - t0}ms ${m.type}`);
      inner(m);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });

try {
  const { capabilities } = await send("session.new", { capabilities: {} });
  const { context } = await send("browsingContext.create", { type: "tab" });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("script.evaluate", {
      expression,
      target: { context },
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  // The page texts of the file printed after `before` ran in it.
  const printed = async (url, before = "") => {
    await send("browsingContext.navigate", { context, url, wait: "complete" });
    await evaluate(`(async () => {
      if (${url.includes("-editor")})
        while (!window.htmlText) await new Promise(requestAnimationFrame);
      ${before}
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    })()`);
    const { data } = await send("browsingContext.print", { context });
    const buffer = Buffer.from(data, "base64");
    const name = new URL(url).pathname.split("/").pop();
    await writeFile(join(out, name.replace(/\.html$/, ".pdf")), buffer);
    return readPDF(buffer).pages.map((p) => p.text.replace(/\s+/g, " ").trim());
  };
  const preview = `window.htmlText.commands.run("preview");
    while (!document.querySelector(".tx-preview-bar"))
      await new Promise(requestAnimationFrame);`;
  for (const [name, words] of DOCUMENTS) {
    const bare = await printed(urls[`${name}-bare`]);
    for (const [how, before] of [
      ["from the editor", ""],
      ["from the print preview", preview],
    ]) {
      const pages = await printed(urls[`${name}-editor`], before);
      pages.forEach((text, i) =>
        assert.ok(
          text,
          `${name} ${how}: page ${i + 1} of ${pages.length} is blank`,
        ),
      );
      assert.equal(pages.length, bare.length, `${name} ${how}: page count`);
      assert.ok(pages.at(-1).includes(words), `${name} ${how}: last page`);
    }
    console.log(
      `PASS text print [firefox ${capabilities.browserVersion}]: ${name} prints ${bare.length} pages from the editor and its preview, as the bare file, none blank`,
    );
  }
} finally {
  socket.close();
  firefox.kill();
  await rm(profile, { recursive: true, force: true });
}
