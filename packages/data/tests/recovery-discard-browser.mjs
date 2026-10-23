import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { dataBarWorkbook } from "../fixtures/bars.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const source = await buildWorkbook(dataBarWorkbook(), { offline: true });
const injection = `const nativeOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=nativeOpen(...args);request.addEventListener('success',()=>{const db=request.result,transaction=db.transaction.bind(db);db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]==='readwrite'){const objectStore=tx.objectStore.bind(tx);tx.objectStore=(...args)=>{const store=objectStore(...args);store.delete=()=>{throw new DOMException('Delete denied','SecurityError')};return store}}return tx}});return request};`;
const browser = await chromium.launch();
try {
  for (const mode of [
    "delete",
    "delayed",
    "worker-compatible",
    "worker-incompatible",
  ]) {
    const failure = mode === "delete";
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      errors = [];
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => errors.push(e.message));
    if (mode === "delayed")
      await page.addInitScript(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          Worker.prototype,
          "onmessage",
        );
        Object.defineProperty(Worker.prototype, "onmessage", {
          configurable: true,
          get: descriptor.get,
          set(handler) {
            descriptor.set.call(this, (event) => {
              if (event.data.kind === "ready" && event.data.discarded) {
                globalThis.discardAckWaiting = true;
                globalThis.releaseDiscardAck = () => handler(event);
                return;
              }
              handler(event);
            });
          },
        });
      });
    await page.addInitScript(() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.kind === "init") globalThis.discardRecoveryWorker = this;
        return post.call(this, message);
      };
    });
    const file = resolve(out, `recovery-discard-${mode}.html`),
      html = failure
        ? source.replace(
            /(<script id="recovery-worker-source"[^>]*>)/,
            "$1" + injection,
          )
        : source;
    await writeFile(file, html);
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page.getByLabel("Cell address", { exact: true }).fill("F6");
    await page.keyboard.press("Tab");
    await page.getByLabel("Cell value", { exact: true }).fill("400");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    if (mode === "worker-incompatible")
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("html-office-data-recovery", 1);
            request.onsuccess = () => {
              const db = request.result,
                tx = db.transaction("drafts", "readwrite"),
                cursor = tx.objectStore("drafts").openCursor();
              cursor.onsuccess = () => {
                if (cursor.result)
                  cursor.result.update({ ...cursor.result.value, schema: 999 });
              };
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
          }),
      );
    // A newer disk revision shares document identity/path but must retain the old draft's overwrite protection.
    const newer = dataBarWorkbook();
    newer.sheets[0].cells.F6.input.value = 600;
    let newerHTML = await buildWorkbook(newer, { offline: true });
    if (failure)
      newerHTML = newerHTML.replace(
        /(<script id="recovery-worker-source"[^>]*>)/,
        "$1" + injection,
      );
    await writeFile(file, newerHTML);
    await page.reload();
    if (mode.startsWith("worker-")) {
      await page.locator("#recovery-dialog").waitFor();
      await page.evaluate(() => {
        globalThis.discardRecoveryWorker.terminate();
        globalThis.discardRecoveryWorker.onerror({
          message: "Injected worker failure before discard",
        });
      });
      await page
        .locator("#recovery-message")
        .filter({ hasText: "Injected worker failure before discard" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Discard draft", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true,
      );
      if (mode === "worker-incompatible") {
        assert.equal(await page.locator("#restore-draft").isDisabled(), true);
        assert.match(
          await page.locator("#recovery-message").textContent(),
          /Reopen this file to resolve the incompatible recovery record/,
        );
      } else {
        await page
          .getByRole("button", { name: "Open draft as a copy", exact: true })
          .click();
        await page
          .getByText("Saved results are current.", { exact: true })
          .waitFor();
        assert.equal(
          await page.getByLabel("Cell value", { exact: true }).inputValue(),
          "=B1*Inputs!C8",
        );
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `PASS recovery discard: ${mode} failure disables unavailable actions, retains protection and gives restore/reopen guidance`,
      );
      continue;
    }
    await page
      .getByRole("button", { name: "Open draft as a copy", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Discard draft", exact: true })
      .click();
    if (failure) {
      await page
        .locator("#recovery-message")
        .filter({ hasText: "Draft not discarded: Delete denied" })
        .waitFor();
      assert.equal(
        await page.locator("#recovery-dialog").evaluate((el) => el.open),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true,
      );
      const records = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("html-office-data-recovery", 1);
            request.onsuccess = () => {
              const db = request.result,
                query = db.transaction("drafts").objectStore("drafts").getAll();
              query.onsuccess = () => {
                db.close();
                resolve(query.result);
              };
              query.onerror = () => reject(query.error);
            };
            request.onerror = () => reject(request.error);
          }),
      );
      assert.equal(records.length, 1);
      assert.equal(records[0].documentId, newer.id);
      await page
        .getByRole("button", { name: "Open draft as a copy", exact: true })
        .click();
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      await page.evaluate((text) => {
        globalThis.discardWrites = 0;
        globalThis.showSaveFilePicker = async () => ({
          name: "newer.html",
          getFile: async () => ({ text: async () => text }),
          createWritable: async () => {
            globalThis.discardWrites++;
            throw new Error("Must not write");
          },
        });
      }, newerHTML);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .locator("#save-status")
        .filter({ hasText: "Recovered copy cannot overwrite an existing file" })
        .waitFor();
      assert.equal(await page.evaluate(() => globalThis.discardWrites), 0);
      const waiting = page.waitForEvent("download");
      await command(page, "Save a copy");
      const saved = resolve(out, "recovery-failed-discard-protected-copy.html");
      await (await waiting).saveAs(saved);
      assert.equal(
        readHTML(await readFile(saved, "utf8")).book.sheets[0].cells.F6.input
          .value,
        400,
      );
      console.log(
        "PASS recovery discard: failed deletion retains the record/dialog/protection; restored copy cannot overwrite the newer source",
      );
    } else {
      await page.waitForFunction(() => globalThis.discardAckWaiting);
      assert.equal(
        await page.locator("#recovery-dialog").evaluate((el) => el.open),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true,
      );
      await page.evaluate(() => globalThis.releaseDiscardAck());
      await page.waitForFunction(
        () => !document.getElementById("recovery-dialog").open,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        false,
      );
      console.log(
        "PASS recovery discard: only successful deletion acknowledgement resolves the draft and releases direct Save",
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
