// T08 from file:// in Chromium, Firefox and WebKit: stale labels and contents are rewritten on
// open (an unsaved change), heading numbers and caption labels show on screen and in print,
// missing targets are flagged, the heading-numbers setting, Insert › Contents and the
// cross-reference dialog. Each saved result is valid, canonical, and differs only where expected.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/numbering-browser.mjs   (default: chromium)
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
const example = await readFile(
  new URL("../fixtures/valid/example.html", import.meta.url),
  "utf8",
);
// Stale generated content, as an LLM might write it: wrong labels, an outdated contents list.
const stale = example
  .replace(
    '<a class="xref" href="#fig-revenue">Figure 1</a>',
    () => '<a class="xref" href="#fig-revenue">Figure 7</a>',
  )
  .replace(
    '<li><a href="#sec-plan">3 2027 plan</a></li>',
    () => '<li><a href="#sec-plan">Plan</a></li>',
  )
  .replace(
    "the west region stayed flat.",
    () =>
      'the west region stayed flat (<a class="xref" href="#sec-gone">Section 4</a>).',
  );
assert.notEqual(stale, example);
const engine = await buildEngine();
const built = await buildDocument(stale, engine);
const path = join(out, "numbering.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

// The saved text is a valid file that reopens as the same document; returns its changed lines.
function check(text, base = built) {
  const report = validateFile(parseFile(text));
  assert.deepEqual(report.errors, []);
  const file = parseFile(text);
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return diffLines(base.split("\n"), text.split("\n"))
    .filter((e) => e.op === "+")
    .map((e) => e.text);
}

async function run(name) {
  const pass = (what) => console.log(`PASS text numbering [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    const menu = async (menuName, item) => {
      await page.click(
        `.tx-shell [role=menubar] button:text-is('${menuName}')`,
      );
      await page.click(`[role=menu] [role^=menuitem]:has-text('${item}')`);
    };
    // The ::before text as drawn. Engines report content differently: Chromium joins the strings
    // ("2.1 "), WebKit lists them ("2.1" " "), Firefox keeps attr() unresolved.
    const before = (selector) =>
      page
        .evaluate((s) => {
          const el = document.querySelector(s);
          const content = getComputedStyle(el, "::before").content;
          if (content === "none" || content === "normal") return "none";
          const parts = content.matchAll(/attr\(([\w-]+)\)|"([^"]*)"/g);
          return `"${[...parts].map((m) => (m[1] ? (el.getAttribute(m[1]) ?? "") : m[2])).join("")}"`;
        }, selector)
        .then((content) => content.replace(/\u2002/g, " "));

    // ---- open: stale content rewritten, shown as an unsaved change ----
    assert.match(
      await page.getAttribute(".tx-shell [role=status]", "data-state"),
      /^(unsaved|draft)$/,
    );
    let lines = check(await saved());
    assert.deepEqual(lines.sort(), [
      '<li><a href="#sec-plan">3 2027 plan</a></li>',
      example.split("\n").find((l) => l.startsWith('<p class="lead">')),
    ]);
    // Undo cannot bring back the stale labels: rewriting them is not an edit.
    assert.equal(
      await page.isDisabled('.tx-shell button[aria-label="Undo"]'),
      true,
    );
    pass(
      "stale labels and contents are rewritten on open, outside the history",
    );

    // ---- numbers on screen and in print; missing targets flagged ----
    assert.equal(await before("#sec-regions"), '"2.1 "');
    assert.equal(await before("#sec-method"), '"3.1 "');
    assert.equal(await before("#sec-contacts"), "none");
    assert.equal(await before("#fig-revenue figcaption"), '"Figure 1. "');
    assert.equal(await before("#fig-site figcaption"), '"Figure 2. "');
    assert.equal(await before("#tab-regions figcaption"), '"Table 1. "');
    const missing = page.locator('#doc a.xref[href="#sec-gone"]');
    assert.equal(await missing.getAttribute("class"), "xref tx-missing");
    assert.match(await missing.getAttribute("title"), /points nowhere/);
    await page.emulateMedia({ media: "print" });
    assert.equal(await before("#sec-regions"), '"2.1 "');
    assert.equal(await before("#tab-regions figcaption"), '"Table 1. "');
    await page.emulateMedia({ media: "screen" });
    pass(
      "heading numbers and caption labels show on screen and in print; a missing target is flagged",
    );

    // ---- the heading-numbers setting ----
    await page.click(".tx-float button:has-text('Theme & page')");
    await page.click(".tx-numbers button:has-text('None')");
    assert.equal(await before("#sec-regions"), "none");
    await page.click(".tx-numbers button:has-text('Numbered')");
    await page.click(".tx-formats button:has-text('I.A.1')");
    assert.equal(await before("#sec-regions"), '"II.A "');
    lines = check(await saved());
    assert.ok(
      lines.includes(
        '<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on" data-heading-format="I.A.1.a">',
      ),
    );
    assert.ok(
      lines.includes('<li><a href="#sec-regions">II.A Regions</a></li>'),
    );
    await page.click(".tx-formats button:has-text('Theme default')");
    assert.equal(await before("#sec-regions"), '"2.1 "');
    assert.doesNotMatch(
      (await saved()).match(/<article[^>]*>/)[0],
      /data-heading-format/,
    );
    await page.keyboard.press("Escape");
    pass("heading numbers and their format change from the document settings");

    // ---- Insert › Cross-reference… ----
    await page
      .locator("#doc blockquote p")
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.click("#doc blockquote p", { position: { x: 2, y: 6 } });
    await page.waitForFunction(() =>
      document
        .querySelector("#doc blockquote p")
        .contains(
          window.htmlText.view.domAtPos(
            window.htmlText.view.state.selection.from,
          ).node,
        ),
    );
    await page.keyboard.press("Home");
    await menu("Insert", "Cross-reference");
    const list = page.locator("dialog.sh-dialog select");
    assert.deepEqual(
      (await list.locator("option").allTextContents()).map((t) => t.trim()),
      [
        "Section 1 · Executive summary",
        "Section 2 · 2026 results",
        "Figure 1 · Revenue by quarter, 2026",
        "Section 2.1 · Regions",
        "Figure 2 · The north site",
        "Table 1 · Revenue by region, EUR million",
        "Section 3 · 2027 plan",
        "Section 3.1 · Method",
        "Contacts",
      ],
    );
    await list.selectOption("tab-regions");
    await page.click("dialog.sh-dialog button:text('Insert')");
    // The dialog's close event, which hands the selection back, is asynchronous.
    await page.waitForSelector("dialog.sh-dialog", { state: "detached" });
    await page.keyboard.type(" shows it. ");
    lines = check(await saved());
    assert.ok(
      lines.includes(
        '<p><a class="xref" href="#tab-regions">Table 1</a> shows it. Grow where the soil is already rich.</p>',
      ),
      lines.join("\n"),
    );
    // Cancel inserts nothing.
    await menu("Insert", "Cross-reference");
    await page.click("dialog.sh-dialog button:text('Cancel')");
    await page.waitForSelector("dialog.sh-dialog", { state: "detached" });
    assert.deepEqual(check(await saved()), lines);
    pass(
      "the cross-reference dialog inserts a labelled reference; Cancel does nothing",
    );

    // ---- Insert › Contents, levels, and renumbering after deleting a section ----
    await page.click("#doc #sec-contacts", { position: { x: 4, y: 6 } });
    await menu("Insert", "Contents");
    await menu("Format", "Level 1");
    lines = check(await saved());
    assert.ok(lines.includes('<nav class="toc" data-depth="1">'));
    assert.equal(
      await page.locator("#doc nav.toc").nth(1).locator("li").count(),
      3,
    );
    // Delete the "Executive summary" heading: everything renumbers.
    await page.evaluate(() => {
      const { view } = window.htmlText;
      let at;
      view.state.doc.forEach((node, pos) => {
        if (node.attrs.id === "sec-summary") at = pos;
      });
      view.dispatch(
        view.state.tr.delete(at, at + view.state.doc.nodeAt(at).nodeSize),
      );
    });
    assert.equal(await before("#sec-regions"), '"1.1 "');
    lines = check(await saved());
    assert.ok(
      lines.includes('<li><a href="#sec-regions">1.1 Regions</a></li>'),
    );
    assert.ok(lines.includes('<li><a href="#sec-plan">2 2027 plan</a></li>'));
    pass(
      "Insert › Contents, its levels, and renumbering after a deleted section",
    );

    // ---- a saved copy reopens as saved: nothing left to rewrite ----
    const copy = await saved();
    const copyPath = join(out, `numbering-copy-${name}.html`);
    await writeFile(copyPath, copy);
    const reopened = await context.newPage();
    await reopened.goto(pathToFileURL(copyPath).href);
    await reopened.waitForFunction(() => window.htmlText);
    assert.equal(
      await reopened.getAttribute(".tx-shell [role=status]", "data-state"),
      "saved",
    );
    assert.equal(
      await reopened.evaluate(() => window.htmlText.serialize()),
      copy,
    );
    await reopened.close();
    pass("a saved copy reopens with nothing to rewrite");

    // ---- a draft restored with another theme numbers with that theme ----
    // The draft is made under a Roman heading format; the file then changes to decimals.
    const roman = built.replace(
      '--heading-format:"1.1.1.1"',
      '--heading-format:"I.A.1.a"',
    );
    assert.notEqual(roman, built);
    const draftPath = join(out, `numbering-draft-${name}.html`);
    await writeFile(draftPath, roman);
    let other = await context.newPage();
    await other.goto(pathToFileURL(draftPath).href);
    await other.waitForFunction(
      () => window.htmlText?.saving.recovery !== "opening",
    );
    if (
      (await other.evaluate(() => window.htmlText.saving.recovery)) === "ready"
    ) {
      assert.match(
        await other.evaluate(() => window.htmlText.serialize()),
        /<li><a href="#sec-regions">II\.A Regions<\/a><\/li>/,
      );
      await other.evaluate(() => {
        const { view } = window.htmlText;
        view.dispatch(view.state.tr.insertText("Draft ", 1));
      });
      await other.waitForFunction(
        () =>
          document.querySelector(".tx-shell [role=status]").dataset.state ===
          "draft",
      );
      await other.close();
      await writeFile(draftPath, built);
      other = await context.newPage();
      await other.goto(pathToFileURL(draftPath).href);
      await other.waitForSelector("dialog.sh-dialog[open]");
      await other.click("dialog.sh-dialog button:text('Restore as a copy')");
      const restored = await other.evaluate(() => window.htmlText.serialize());
      assert.match(restored, /--heading-format:"I\.A\.1\.a"/);
      assert.match(
        restored,
        /<li><a href="#sec-regions">II\.A Regions<\/a><\/li>/,
      );
      await other.close();
      pass("a draft restored with another theme numbers with that theme");
    } else console.log(`INFO text numbering [${name}]: no draft recovery`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
