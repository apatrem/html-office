import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const original = await buildWorkbook(fixture, { offline: true });
const browser = await chromium.launch();
async function setup(mode, html = original) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ original }) => {
      const disk = (globalThis.diskProbe = {
        text: original,
        writes: 0,
        fail: false,
        held: false,
        release: null,
        cancel: false,
      });
      globalThis.showSaveFilePicker = async () => {
        if (disk.cancel) throw new DOMException("Cancelled", "AbortError");
        return {
          name: "workbook.html",
          async getFile() {
            const text = disk.text;
            return { text: async () => text };
          },
          async createWritable() {
            let next;
            return {
              async write(value) {
                if (disk.fail) throw new Error("Disk full");
                next = value;
                if (disk.held)
                  await new Promise((resolve) => (disk.release = resolve));
              },
              async close() {
                disk.text = next;
                disk.writes++;
              },
              async abort() {},
            };
          },
        };
      };
    },
    { original: html },
  );
  const file = resolve(out, `persistence-${mode}.html`);
  await writeFile(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return { page, context, file, errors };
}
async function edit(page, value) {
  await page.getByLabel("Cell value").fill(String(value));
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
}
async function copy(page, name) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const file = resolve(out, name);
  await (await waiting).saveAs(file);
  return readHTML(await readFile(file, "utf8")).book;
}
try {
  {
    const { page, context, errors } = await setup("durable");
    await edit(page, 140);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to workbook.html.", { exact: true }).waitFor();
    let disk = readHTML(await page.evaluate(() => diskProbe.text)).book;
    assert.equal(disk.sheets[1].cells.B2.result.value, 3500);
    await edit(page, 180);
    await page.evaluate(() => (diskProbe.text += "\n<!-- external edit -->"));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .locator("#save-status")
      .filter({ hasText: "changed externally" })
      .waitFor();
    assert.equal(
      await page.evaluate(() =>
        diskProbe.text.endsWith("<!-- external edit -->"),
      ),
      true,
    );
    assert.equal(
      (await copy(page, "conflict-kept.html")).sheets[0].cells.B2.input.value,
      180,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: selected-file Save, external conflict and memory preservation",
    );
  }
  {
    const { page, context, errors } = await setup("concurrent");
    await edit(page, 140);
    await page.evaluate(() => (diskProbe.held = true));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => diskProbe.release);
    await edit(page, 160);
    await page.evaluate(() => diskProbe.release());
    await page.waitForFunction(() => diskProbe.writes === 1);
    await page
      .locator("#save-status")
      .filter({ hasText: /unsaved/i })
      .waitFor();
    assert.equal(
      readHTML(await page.evaluate(() => diskProbe.text)).book.sheets[0].cells
        .B2.input.value,
      140,
    );
    assert.equal(
      (await copy(page, "later-edits.html")).sheets[0].cells.B2.input.value,
      160,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: edits during a delayed save remain dirty and recoverable",
    );
  }
  {
    const { page, context, errors } = await setup("failed");
    await edit(page, 140);
    await page.evaluate(() => (diskProbe.fail = true));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .locator("#save-status")
      .filter({ hasText: "Disk full" })
      .waitFor();
    assert.equal(await page.evaluate(() => diskProbe.writes), 0);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    await page.reload();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    assert.equal(await page.getByLabel("Cell value").inputValue(), "140");
    assert.equal(
      (await copy(page, "restored.html")).sheets[1].cells.B2.result.value,
      3500,
    );
    await page.evaluate(() => {
      diskProbe.fail = false;
      diskProbe.cancel = true;
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByText("Save cancelled. Your work remains open.", { exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("Cell value").inputValue(), "140");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: write/picker failures, reload and explicit draft restore",
    );
  }
  {
    const { page, context, file, errors } = await setup("newer");
    await edit(page, 140);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const parsed = readHTML(original);
    parsed.book.sheets[0].cells.B2.input.value = 120;
    await writeFile(file, replaceHTML(original, parsed, parsed.book));
    await page.reload();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Open draft as a copy", exact: true })
      .click();
    assert.equal(await page.getByLabel("Cell value").inputValue(), "140");
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    await page.reload();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Open draft as a copy", exact: true })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .locator("#save-status")
      .filter({ hasText: "cannot overwrite" })
      .waitFor();
    assert.equal(
      readHTML(await readFile(file, "utf8")).book.sheets[0].cells.B2.input
        .value,
      120,
    );
    assert.equal(
      (await copy(page, "older-draft-copy.html")).sheets[0].cells.B2.input
        .value,
      140,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: a draft from another disk revision cannot overwrite newer work",
    );
  }
  {
    const injection = `const nativeOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=nativeOpen(...args);request.addEventListener('success',()=>{const db=request.result,transaction=db.transaction.bind(db);db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]==='readwrite'){const objectStore=tx.objectStore.bind(tx);tx.objectStore=(...args)=>{const store=objectStore(...args);store.put=()=>{throw new DOMException('Quota exceeded','QuotaExceededError')};return store}}return tx}});return request};`;
    const limited = original.replace(
      /(<script id="recovery-worker-source"[^>]*>)/,
      "$1" + injection,
    );
    const { page, context, errors } = await setup("quota", limited);
    await edit(page, 140);
    await page
      .locator("#save-status")
      .filter({ hasText: "Quota exceeded" })
      .waitFor();
    assert.equal(
      (await copy(page, "quota-kept.html")).sheets[1].cells.B2.result.value,
      3500,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: recovery quota failures preserve the editable workbook",
    );
  }
  {
    const { page, context, errors } = await setup("startup");
    await edit(page, 140);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    await page.addInitScript(() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.kind === "init")
          return setTimeout(() => post.call(this, message), 1200);
        return post.call(this, message);
      };
    });
    await page.reload();
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Save", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Save", exact: true })
        .isDisabled(),
      true,
    );
    await page.reload();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    assert.equal(await page.getByLabel("Cell value").inputValue(), "140");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: startup Save waits for an explicit recovery decision",
    );
  }
  for (const transition of ["replace", "undo", "recalculate"]) {
    const { page, context, errors } = await setup(`failed-${transition}`);
    if (transition === "undo") await edit(page, 120);
    await page.evaluate(() => {
      const originalPost = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.method === "calculate" && !globalThis.failedOnce) {
          globalThis.failedOnce = true;
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id: message.id,
                    error: "Injected calculation failure",
                  },
                }),
              ),
            0,
          );
          return;
        }
        return originalPost.call(this, message);
      };
    });
    if (transition === "undo") await page.getByLabel("Cell address").fill("B3");
    await page.getByLabel("Cell value").fill("140");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .locator("#status")
      .filter({ hasText: "Injected calculation failure" })
      .waitFor();
    if (transition === "replace") {
      await page.getByLabel("Cell address").fill("B3");
      await edit(page, 30);
    } else if (transition === "undo") {
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    } else {
      await page
        .getByRole("button", { name: "Recalculate", exact: true })
        .click();
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
    }
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const exported = await copy(page, `failed-${transition}-copy.html`);
    await page.reload();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    const recovered = await copy(page, `failed-${transition}-restored.html`);
    assert.deepEqual(recovered, exported);
    assert.equal(
      recovered.sheets[0].cells.B2.input.value,
      transition === "recalculate" ? 140 : 100,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS persistence: failed edit + ${transition} recovery equals exported workbook`,
    );
  }
  {
    const { page, context, errors } = await setup("pending");
    await page.addInitScript(() => {});
    // Delay only the calculation worker, leaving recovery and Save a copy active.
    await page.evaluate(() => {
      const worker = globalThis.Worker;
      globalThis.Worker = class extends worker {
        postMessage(message) {
          if (message.method === "calculate")
            return setTimeout(() => super.postMessage(message), 500);
          return super.postMessage(message);
        }
      };
    });
    await page.getByLabel("Cell value").fill("170");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    const saved = await copy(page, "pending-copy.html");
    assert.equal(saved.sheets[0].cells.B2.input.value, 170);
    assert.equal(saved.snapshot, undefined);
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS persistence: saving during calculation includes the attempted input with stale results",
    );
  }
} finally {
  await browser.close();
}
