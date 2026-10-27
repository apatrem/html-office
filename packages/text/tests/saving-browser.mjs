// T05 from file:// in Chromium, Firefox and WebKit: Save (where the browser can write a chosen
// file), Save a copy, distinct saved/unsaved/draft/copied states, failed, cancelled and delayed
// writes, external changes, and draft recovery after reopening.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/saving-browser.mjs   (default: chromium)
// Chromium's file picker is replaced by an in-page disk whose writes can be delayed or refused.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { diffLines } from "../tools/pack.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const built = await buildDocument(
  await readFile(
    new URL("../fixtures/valid/example.html", import.meta.url),
    "utf8",
  ),
  await buildEngine(),
);
const write = async (name, html) => {
  const path = join(out, name);
  await writeFile(path, html);
  return pathToFileURL(path).href;
};
const changed = (a, b) =>
  diffLines(a.split("\n"), b.split("\n"))
    .filter((e) => e.op !== " ")
    .map((e) => e.op + e.text);
const mod = process.platform === "darwin" ? "Meta" : "Control";
const LEAD = '<p class="lead"><mark class="comment"';

// An in-page disk for showSaveFilePicker. disk.hold (a promise) delays the commit, disk.fail
// refuses the write, disk.cancel cancels the picker.
function stubDisk(text) {
  const disk = (globalThis.disk = { text, writes: 0, picks: 0, fail: false });
  globalThis.showSaveFilePicker = async () => {
    disk.picks++;
    if (disk.cancel)
      throw new DOMException("The user aborted a request.", "AbortError");
    return {
      name: "example.html",
      getFile: async () => {
        const value = disk.text;
        return { text: async () => value };
      },
      async createWritable() {
        let next;
        return {
          async write(value) {
            if (disk.fail) throw new Error("The disk is full");
            next = value;
          },
          async close() {
            await disk.hold;
            disk.text = next;
            disk.writes++;
          },
          async abort() {},
        };
      },
    };
  };
}

// Holds back the browser storage's answer (IndexedDB open) until window.releaseStorage().
function gateStorage() {
  const gate = new Promise((r) => (window.releaseStorage = r));
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    const request = open.apply(this, args);
    let handler = null;
    Object.defineProperty(request, "onsuccess", {
      configurable: true,
      get: () => handler,
      set: (f) => (handler = f),
    });
    request.addEventListener("success", (event) =>
      gate.then(() => handler?.call(request, event)),
    );
    return request;
  };
}

async function run(engine) {
  const pass = (name) => console.log(`PASS text saving [${engine}]: ${name}`);
  const browser = await playwright[engine].launch();
  const report = { engine };
  // One context per scenario: its storage (the drafts) lives while the context does.
  async function context() {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const errors = [];
    const open = async (target, { disk, picker = !!disk, gate } = {}) => {
      const page = await ctx.newPage();
      if (gate) await page.addInitScript(gateStorage);
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      if (picker) await page.addInitScript(stubDisk, disk);
      else await page.addInitScript(() => delete window.showSaveFilePicker);
      await page.goto(target);
      await page.waitForFunction(() => window.htmlText);
      return page;
    };
    return { ctx, errors, open };
  }
  const state = (page) =>
    page.locator(".tx-shell [role=status]").getAttribute("data-state");
  const status = (page) =>
    page.locator(".tx-shell [role=status]").textContent();
  const waitState = (page, value) =>
    page.waitForSelector(`.tx-shell [role=status][data-state=${value}]`);
  const typeInLead = async (page, text) => {
    await page.click("#doc p.lead", { position: { x: 2, y: 6 } });
    await page.keyboard.press("Home");
    await page.keyboard.type(text);
  };
  const lead = (page) => page.locator("#doc p.lead").textContent();
  const recovery = (page) =>
    page.evaluate(() => window.htmlText.saving.recovery);
  const settled = (page) =>
    page.waitForFunction(() => window.htmlText.saving.recovery !== "opening");

  try {
    // ---- Save a copy where the opened file cannot be written (Safari, Firefox; Chromium without the API) ----
    {
      const { ctx, errors, open } = await context();
      const url = await write(`saving-${engine}.html`, built);
      const page = await open(url);
      await settled(page);
      const primary = page.locator(".tx-shell .sh-primary");
      assert.equal((await primary.textContent()).trim(), "Save a copy");
      await page.click(".tx-shell [role=menubar] button:text('File')");
      const items = await page
        .locator("[role=menu] [role=menuitem]")
        .allTextContents();
      assert.ok(!items.some((t) => /^Save(?! a copy)/.test(t)), items.join());
      await page.keyboard.press("Escape");
      assert.equal(await state(page), "saved");
      assert.equal(await status(page), "No unsaved changes");
      await typeInLead(page, "Overall, ");
      assert.equal(await state(page), "unsaved");
      report.recovery = await recovery(page);
      report.problem = await page.evaluate(
        () => window.htmlText.saving.problem,
      );
      if (report.recovery === "ready") {
        await waitState(page, "draft");
        assert.match(await status(page), /draft kept in this browser/);
      } else assert.match(await status(page), /no draft in this browser/);
      const download = page.waitForEvent("download");
      await page.keyboard.press(`${mod}+s`);
      const copy = await readFile(await (await download).path(), "utf8");
      assert.equal(await state(page), "copied");
      assert.match(await status(page), /Copy download requested/);
      // The download may have been cancelled: leaving still warns.
      assert.ok(
        await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }),
        "leaving after a copy request warns",
      );
      assert.deepEqual(changed(built, copy), [
        "-" + built.split("\n").find((l) => l.startsWith(LEAD)),
        "+" +
          copy.split("\n").find((l) => l.startsWith('<p class="lead">Overall')),
      ]);
      // Distinct states: an edit after the copy is unsaved again.
      await page.keyboard.type("x");
      assert.notEqual(await state(page), "copied");
      await page.keyboard.press("Backspace");
      const reopened = await open(await write(`copy-${engine}.html`, copy));
      assert.match(await lead(reopened), /^Overall, Revenue grew/);
      assert.equal(
        await reopened.evaluate(() => window.htmlText.serialize()),
        copy,
      );
      assert.equal(await state(reopened), "saved");
      assert.deepEqual(errors, []);
      await ctx.close();
      pass(
        `Save a copy is the labelled action; saved, unsaved, ${report.recovery === "ready" ? "draft, " : ""}copied states; the copy reopens canonical`,
      );
    }

    // ---- draft recovery after reopening ----
    {
      const { ctx, errors, open } = await context();
      const url = await write(`recover-${engine}.html`, built);
      let page = await open(url);
      await settled(page);
      if ((await recovery(page)) !== "ready") {
        assert.notEqual(engine, "chromium", "Chrome and Edge keep drafts");
        await ctx.close();
        console.log(
          `INFO text saving [${engine}]: no draft recovery (${report.problem})`,
        );
      } else {
        await typeInLead(page, "Overall, ");
        await waitState(page, "draft");
        await page.close();
        // Reopen: the draft is offered and cannot be dismissed with Escape.
        page = await open(url);
        await page.waitForSelector("dialog.sh-dialog[open]");
        await page.keyboard.press("Escape");
        assert.ok(await page.locator("dialog.sh-dialog[open]").count());
        assert.match(await lead(page), /^Revenue grew/);
        await page.click("dialog.sh-dialog button:text('Restore draft')");
        assert.match(await lead(page), /^Overall, Revenue grew/);
        assert.match(await status(page), /^Draft restored/);
        await waitState(page, "draft");
        // Restoring starts a new history: undo cannot bring back zones the draft replaced.
        assert.equal(
          await page.evaluate(() => window.htmlText.commands.enabled("undo")),
          false,
        );
        await page.close();
        // Discarded, it is gone.
        page = await open(url);
        await page.waitForSelector("dialog.sh-dialog[open]");
        await page.click("dialog.sh-dialog button:text('Discard draft')");
        assert.match(await lead(page), /^Revenue grew/);
        await page.waitForFunction(
          () =>
            document.querySelector(".tx-shell [role=status]").textContent ===
            "Draft discarded.",
        );
        await page.close();
        page = await open(url);
        await settled(page);
        assert.equal(await page.locator("dialog[open]").count(), 0);
        assert.equal(await recovery(page), "ready");
        await page.close();

        // A draft of an older revision of the file is restored as a copy.
        page = await open(url);
        await settled(page);
        await typeInLead(page, "Draft: ");
        await waitState(page, "draft");
        await page.close();
        // Changed elsewhere: another cover line, and the image and its asset removed. The draft
        // keeps the zones it was made with, so it still has its image.
        const elsewhere = built
          .replace(
            "Prepared by the planning team, October 2026",
            "Prepared by the planning team, November 2026",
          )
          .replace(/<figure class="image" id="fig-site"[^]*?<\/figure>\n/, "")
          .replace(/<script id="assets"[^\n]*\n/, "");
        assert.doesNotMatch(elsewhere, /data-asset="a1"|id="assets"/);
        await write(`recover-${engine}.html`, elsewhere);
        page = await open(url, {
          disk: elsewhere,
          picker: engine === "chromium",
          gate: true,
        });
        // Before the draft store answers, Save does nothing: the draft found next is older than
        // the file, and a file bound now could be overwritten by it.
        assert.equal(await recovery(page), "opening");
        if (engine === "chromium") {
          await typeInLead(page, "Early ");
          await page.keyboard.press(`${mod}+s`);
          await page.waitForTimeout(200);
          assert.deepEqual(
            await page.evaluate(() => [window.disk.picks, window.disk.writes]),
            [0, 0],
          );
        }
        await page.evaluate(() => window.releaseStorage());
        await page.waitForSelector("dialog.sh-dialog[open]");
        assert.match(
          await page.locator("dialog.sh-dialog").textContent(),
          /The file has changed since the draft was made/,
        );
        // Nothing saves while the draft awaits a choice.
        assert.equal(
          await page.evaluate(() => window.htmlText.saving.ready),
          false,
        );
        await page.click("dialog.sh-dialog button:text('Restore as a copy')");
        assert.match(await lead(page), /^Draft: Revenue grew/);
        if (engine === "chromium") {
          await page.click(".tx-shell .sh-primary");
          await page.waitForFunction(() =>
            /Save failed/.test(
              document.querySelector(".tx-shell [role=status]").textContent,
            ),
          );
          assert.match(await status(page), /older version of the file/);
          assert.equal(await page.evaluate(() => window.disk.writes), 0);
          // A new, empty file is accepted.
          await page.evaluate(() => (window.disk.text = ""));
          await page.click(".tx-shell .sh-primary");
          await page.waitForFunction(() => window.disk.writes === 1);
          const saved = await page.evaluate(() => window.disk.text);
          assert.match(saved, /<p class="lead">Draft: <mark/);
          // The draft replaces the article: the other file's change is not merged into it.
          assert.match(saved, /October 2026/);
          assert.match(saved, /data-asset="a1"/);
          assert.match(
            saved,
            /<script id="assets" type="application\/json">\{"a1"/,
          );
          // The saved copy is a complete, valid file that reopens as the same document.
          const copyUrl = await write(`recovered-${engine}.html`, saved);
          const copyPage = await open(copyUrl);
          assert.equal(
            await copyPage.evaluate(() => window.htmlText.serialize()),
            saved,
          );
        }
        assert.deepEqual(errors, []);
        await ctx.close();
        pass(
          "a draft is offered on reopening: restored (with a new history), discarded, or restored as a copy with its own zones when the file changed; Save waits for the draft store",
        );
      }
    }

    // ---- direct Save: cancelled, refused, delayed and externally changed (Chromium, Edge) ----
    if (engine === "chromium") {
      const { ctx, errors, open } = await context();
      const url = await write("direct.html", built);
      const page = await open(url, { disk: built });
      await settled(page);
      assert.equal(
        (await page.locator(".tx-shell .sh-primary").textContent()).trim(),
        "Save",
      );
      await typeInLead(page, "Overall, ");
      const disk = () => page.evaluate(() => window.disk);

      await page.evaluate(() => (window.disk.cancel = true));
      await page.keyboard.press(`${mod}+s`);
      await page.waitForFunction(() =>
        /cancelled/.test(
          document.querySelector(".tx-shell [role=status]").textContent,
        ),
      );
      assert.equal(
        await status(page),
        "Save cancelled. Your work remains open.",
      );
      assert.equal((await disk()).writes, 0);
      assert.ok(await page.evaluate(() => window.htmlText.saving.dirty));

      await page.evaluate(() => {
        window.disk.cancel = false;
        window.disk.fail = true;
      });
      await page.keyboard.press(`${mod}+s`);
      await page.waitForFunction(() =>
        /Save failed/.test(
          document.querySelector(".tx-shell [role=status]").textContent,
        ),
      );
      assert.match(
        await status(page),
        /The disk is full\. Your work remains open/,
      );
      assert.equal((await disk()).writes, 0);
      assert.equal((await disk()).text, built);
      assert.ok(await page.evaluate(() => window.htmlText.saving.dirty));
      pass(
        "a cancelled or failed save keeps the work, unsaved, and writes nothing",
      );

      // Delayed: an edit made while the write is pending stays unsaved.
      await page.evaluate(() => {
        window.disk.fail = false;
        window.disk.hold = new Promise((r) => (window.disk.release = r));
      });
      await page.keyboard.press(`${mod}+s`);
      await page.waitForSelector(".tx-shell [role=status][data-state=saving]");
      assert.equal(
        await page.locator(".tx-shell .sh-primary").isDisabled(),
        true,
        "one save at a time",
      );
      await page.keyboard.type("really ");
      await page.evaluate(() => window.disk.release());
      await page.waitForFunction(() => window.disk.writes === 1);
      await page.waitForFunction(() => !window.htmlText.saving.busy);
      assert.equal(
        await status(page),
        "Earlier revision saved. Later changes remain unsaved.",
      );
      assert.match((await disk()).text, /<p class="lead">Overall, <mark/);
      await waitState(page, "draft");
      await page.evaluate(() => (window.disk.hold = null));
      await page.keyboard.press(`${mod}+s`);
      await page.waitForFunction(() => window.disk.writes === 2);
      await waitState(page, "saved");
      assert.match(
        (await disk()).text,
        /<p class="lead">Overall, really <mark/,
      );
      pass(
        "edits made during a delayed save stay unsaved, and the next save writes them",
      );

      // External change: the bound file was modified by another program.
      await page.keyboard.type("!");
      await page.evaluate(
        () => (window.disk.text += "\n<!-- changed elsewhere -->"),
      );
      const before = (await disk()).text;
      await page.keyboard.press(`${mod}+s`);
      await page.waitForFunction(() =>
        /Save failed/.test(
          document.querySelector(".tx-shell [role=status]").textContent,
        ),
      );
      assert.match(await status(page), /changed externally/);
      assert.equal((await disk()).text, before);
      assert.equal((await disk()).writes, 2);
      pass(
        "a file changed by another program is detected before it is overwritten",
      );

      // A clean save removes the draft: reopening offers nothing.
      await page.keyboard.press("Backspace");
      await page.evaluate(
        () =>
          (window.disk.text = window.disk.text.replace(
            "\n<!-- changed elsewhere -->",
            "",
          )),
      );
      await page.keyboard.press(`${mod}+s`);
      await page.waitForFunction(() => window.disk.writes === 3);
      await waitState(page, "saved");
      await page.waitForTimeout(100);
      const saved = (await disk()).text;
      await page.close();
      await write("direct.html", saved);
      const again = await open(url, { disk: saved });
      await settled(again);
      assert.equal(await again.locator("dialog[open]").count(), 0);
      assert.equal(
        await again.evaluate(() => window.htmlText.serialize()),
        saved,
      );
      assert.deepEqual(errors, []);
      await ctx.close();
      pass("a saved file reopens canonical with no draft left behind");
    }
  } finally {
    await browser.close();
  }
  return report;
}

for (const engine of ENGINES) await run(engine);
