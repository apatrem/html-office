// T06 from file:// in Chromium, Firefox and WebKit: block styles, lists, inline formatting, links,
// alignment and page breaks by keyboard, toolbar and menus; composition input (Chromium). After
// each workflow the document must save as a valid file that reopens identically.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/editing-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { diffLines } from "../tools/pack.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";

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
const path = join(out, "editing.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

// The saved text is a valid file that reopens as the same document; returns its changed lines.
function check(text) {
  const report = validateFile(parseFile(text));
  assert.deepEqual(report.errors, []);
  assert.equal(report.protected.length, 0, "no new protected block");
  const file = parseFile(text);
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return diffLines(built.split("\n"), text.split("\n"))
    .filter((e) => e.op === "+")
    .map((e) => e.text);
}

async function run(engine) {
  const pass = (name) => console.log(`PASS text editing [${engine}]: ${name}`);
  const browser = await playwright[engine].launch();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    // Targets are centred first: at the top edge they would sit under the sticky file bar.
    for (const name of ["click", "dblclick"]) {
      const original = page[name].bind(page);
      page[name] = async (selector, options) => {
        if (selector.startsWith("#doc"))
          await page
            .locator(selector)
            .first()
            .evaluate((el) => el.scrollIntoView({ block: "center" }));
        await original(selector, options);
        // The editor reads a pointer selection on the browser's next selectionchange: wait
        // until its selection is in the element clicked (and not empty after a double click).
        if (selector.startsWith("#doc"))
          await page.waitForFunction(
            ([selector, word]) => {
              const view = window.htmlText.view;
              const { from, empty } = view.state.selection;
              const el = document.querySelector(selector);
              return el.contains(view.domAtPos(from).node) && !(word && empty);
            },
            [selector, name === "dblclick"],
          );
      };
    }
    const pressed = (label) =>
      page.getAttribute(
        `.tx-shell button[aria-label="${label}"]`,
        "aria-pressed",
      );
    const menu = async (name, item) => {
      await page.click(`.tx-shell [role=menubar] button:text-is('${name}')`);
      await page.click(`[role=menu] [role^=menuitem]:has-text('${item}')`);
    };

    // ---- inline formatting by keyboard and toolbar ----
    await page.dblclick("#doc p.ta-j", { position: { x: 12, y: 8 } });
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.press(`${mod}+i`);
    await page.click('.tx-shell [aria-label="Underline"]');
    assert.equal(await pressed("Bold"), "true");
    assert.equal(await pressed("Underline"), "true");
    assert.equal(
      await page.locator("#doc p.ta-j > strong > em > u").textContent(),
      "The",
    );
    await page.click('.tx-shell [aria-label="Superscript"]');
    await page.click('.tx-shell [aria-label="Subscript"]');
    assert.equal(await pressed("Superscript"), "false", "sub replaces sup");
    await page.click('.tx-shell [aria-label="Subscript"]');
    let lines = check(await saved());
    assert.deepEqual(lines, [
      '<p class="ta-j"><strong><em><u>The</u></em></strong> plan keeps the current sites and opens two more in the south region, <mark>subject to the spring survey</mark>. A <a href="https://example.org/northwind-plan">public summary</a> is available.</p>',
    ]);
    pass(
      "bold and italic by keyboard, underline and sub/superscript by toolbar, with pressed states",
    );

    // ---- link through the dialog ----
    await page.dblclick("#doc p.ta-j", { position: { x: 60, y: 8 } });
    await page.keyboard.press(`${mod}+k`);
    const field = page.locator("dialog.sh-dialog input[type=url]");
    await field.fill("javascript:alert(1)");
    assert.equal(
      await page
        .locator("dialog.sh-dialog button:text('Save link')")
        .isDisabled(),
      true,
    );
    // The dialog uses the command's own rule: an address the browser would normalise
    // ("https:example.org") is refused here too.
    await field.fill("https:example.org");
    assert.equal(
      await page
        .locator("dialog.sh-dialog button:text('Save link')")
        .isDisabled(),
      true,
    );
    assert.match(
      await page.locator("dialog.sh-dialog .sh-err").first().textContent(),
      /starting with https:\/\//,
    );
    await field.fill("https://example.org/plan");
    await page.click("dialog.sh-dialog button:text('Save link')");
    assert.equal(
      await page
        .locator('#doc p.ta-j a[href="https://example.org/plan"]')
        .count(),
      1,
    );
    assert.equal(await pressed("Link"), "true");
    check(await saved());
    pass("a link is added through the dialog, which refuses a script address");

    // ---- paragraph styles from the toolbar menu; a new heading keeps its ID ----
    await page.click("#doc h4#sec-contacts");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Next steps");
    await page.click(".tx-shell .tx-style");
    await page.click("[role=menu] [role=menuitemradio]:has-text('Heading 2')");
    assert.equal(
      await page.locator(".tx-shell .tx-style").textContent(),
      "Heading 2",
    );
    const id = await page
      .locator("#doc h2:has-text('Next steps')")
      .getAttribute("id");
    assert.equal(id, "sec-next-steps");
    await page.keyboard.type(" for 2027");
    assert.equal(
      await page
        .locator("#doc h2:has-text('Next steps for 2027')")
        .getAttribute("id"),
      id,
    );
    await page.keyboard.press(`${mod}+Alt+3`);
    assert.equal(await page.locator(`#doc h3#${id}`).count(), 1);
    await menu("Format", "Start on a new page");
    assert.equal(await page.locator(`#doc h3#${id}.new-page`).count(), 1);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Key point");
    await page.click(".tx-shell .tx-style");
    await page.click(
      "[role=menu] [role=menuitemradio]:has-text('Key message')",
    );
    assert.equal(
      await page
        .locator("#doc aside.callout.key p:has-text('Key point')")
        .count(),
      1,
    );
    lines = check(await saved());
    assert.ok(
      lines.includes(
        `<h3 class="new-page" id="${id}">Next steps for 2027</h3>`,
      ),
      lines.join("\n"),
    );
    pass(
      "styles from the toolbar menu and keyboard; a new heading's ID stays as it is edited",
    );

    // ---- lists by keyboard and toolbar ----
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${mod}+Alt+0`);
    assert.equal(
      await page.locator(".tx-shell .tx-style").textContent(),
      "Body",
    );
    await page.keyboard.type("First");
    await page.keyboard.press(`${mod}+Shift+8`);
    assert.equal(await pressed("Bulleted list"), "true");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator("#doc li li:has-text('Second')").count(),
      1,
    );
    await page.click('.tx-shell [aria-label="Numbered list"]');
    assert.equal(
      await page.locator("#doc ul > li > ol > li:has-text('Second')").count(),
      1,
    );
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("After the list");
    assert.equal(
      await page.locator("#doc p:has-text('After the list')").count(),
      1,
    );
    assert.equal(await pressed("Bulleted list"), "false");
    lines = check(await saved());
    pass(
      "lists: toolbar and shortcuts, Tab and Shift+Tab levels, Enter on an empty item leaves the list",
    );

    // ---- alignment, page break, cross-block deletion ----
    await page.click('.tx-shell [aria-label="Center"]');
    assert.equal(
      await page.locator("#doc p.ta-c:has-text('After the list')").count(),
      1,
    );
    await page.keyboard.press(`${mod}+Enter`);
    await menu("Insert", "Page break");
    assert.ok((await page.locator("#doc hr.page-break").count()) >= 3);
    // From the middle of one block to the middle of another, then Backspace and Delete.
    await page.click("#doc p.lead", { position: { x: 40, y: 6 } });
    await page.keyboard.down("Shift");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.up("Shift");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    check(await saved());
    pass(
      "alignment, page breaks by keyboard and menu, and deletion across blocks stay in the subset",
    );

    // ---- composition input (IME, dictation) is not interrupted (Chromium) ----
    if (engine === "chromium") {
      await page.click("#doc h1#sec-summary");
      await page.keyboard.press("End");
      const cdp = await page.context().newCDPSession(page);
      for (const [text, selection] of [
        ["に", 1],
        ["にほ", 2],
        ["にほん", 3],
      ])
        await cdp.send("Input.imeSetComposition", {
          text,
          selectionStart: selection,
          selectionEnd: selection,
        });
      await cdp.send("Input.insertText", { text: "日本" });
      assert.match(
        await page.locator("#doc h1#sec-summary").textContent(),
        /Executive summary日本$/,
      );
      lines = check(await saved());
      assert.ok(
        lines.includes('<h1 id="sec-summary">Executive summary日本</h1>'),
      );
      pass("a composition commits once, as typed text");
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const engine of ENGINES) await run(engine);
