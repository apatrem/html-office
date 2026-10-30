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

// Firefox died under the test: the transport failed, not the document, so the print is worth one
// retry in a new Firefox. Anything else, a failed PDF assertion above all, is a real failure.
class Lost extends Error {}

// Firefox with its WebDriver BiDi server on a free port, in a profile of its own, and one tab.
// Accessibility stays off: on GitHub's runners the parent process sometimes refuses a document's
// accessibility actor (PDocAccessibleConstructor in Firefox's stderr) and kills the content process,
// which browsingContext.print reports as NS_ERROR_UNEXPECTED.
const launch = async () => {
  const profile = await mkdtemp(join(tmpdir(), "text-firefox-"));
  await writeFile(
    join(profile, "user.js"),
    'user_pref("accessibility.force_disabled", 1);\n',
  );
  const child = spawn(
    FIREFOX,
    ["--headless", "--remote-debugging-port", "0", "--profile", profile],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  let log = "";
  let socket;
  const close = async () => {
    socket?.close();
    child.kill("SIGKILL");
    await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  };
  try {
    const address = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${FIREFOX} did not start WebDriver BiDi: ${log}`));
      }, 60_000);
      child.on("error", reject);
      child.on("exit", (code) =>
        reject(new Error(`${FIREFOX} exited (${code}): ${log}`)),
      );
      child.stderr.on("data", (data) => {
        log += data;
        const found = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
        if (found) {
          clearTimeout(timeout);
          resolve(found[1]);
        }
      });
    });
    socket = new WebSocket(`${address}/session`);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let last = 0;
    const waiting = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    };
    socket.onclose = ({ code }) => {
      for (const reply of waiting.values())
        reply({ type: "error", lost: true, error: "socket", message: code });
      waiting.clear();
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN)
          return reject(new Lost(`${method}: the socket is closed`));
        const id = ++last;
        waiting.set(id, (m) => {
          if (m.type !== "error") return resolve(m.result);
          const unexpected = String(m.message).includes("NS_ERROR_UNEXPECTED");
          const Failure = m.lost || unexpected ? Lost : Error;
          reject(new Failure(`${method}: ${m.error}: ${m.message}`));
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const { capabilities } = await send("session.new", { capabilities: {} });
    const { context } = await send("browsingContext.create", { type: "tab" });
    const version = capabilities.browserVersion;
    return { send, context, version, close, log: () => log };
  } catch (error) {
    await close();
    throw error;
  }
};

let firefox = await launch();
try {
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await firefox.send("script.evaluate", {
      expression,
      target: { context: firefox.context },
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  const print = async (url, before) => {
    const { context } = firefox;
    await firefox.send("browsingContext.navigate", {
      context,
      url,
      wait: "complete",
    });
    await evaluate(`(async () => {
      if (${url.includes("-editor")})
        while (!window.htmlText) await new Promise(requestAnimationFrame);
      ${before}
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    })()`);
    const { data } = await firefox.send("browsingContext.print", { context });
    const buffer = Buffer.from(data, "base64");
    const name = new URL(url).pathname.split("/").pop();
    await writeFile(join(out, name.replace(/\.html$/, ".pdf")), buffer);
    return readPDF(buffer).pages.map((p) => p.text.replace(/\s+/g, " ").trim());
  };
  // The page texts of the file printed after `before` ran in it.
  const printed = async (url, before = "") => {
    try {
      return await print(url, before);
    } catch (error) {
      if (!(error instanceof Lost)) throw error;
      console.log(
        `RETRY text print [firefox]: ${url}: ${error.message}\n${firefox.log()}`,
      );
      await firefox.close();
      firefox = await launch();
      return print(url, before);
    }
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
      `PASS text print [firefox ${firefox.version}]: ${name} prints ${bare.length} pages from the editor and its preview, as the bare file, none blank`,
    );
  }
} finally {
  await firefox.close();
}
