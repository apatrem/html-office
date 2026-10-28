// T09 from file:// in Chromium, Firefox and WebKit: footnotes show as numbered references with a
// hover preview and a generated notes list; Insert › Footnote and its shortcut open a new note,
// Escape leaves it, a click on the list opens one; print keeps the references closed and the
// notes as endnotes; undo; every saved result is valid, canonical and holds no generated markup.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/footnotes-browser.mjs   (default: chromium)
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
const path = join(out, "footnotes.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

function check(text) {
  const report = validateFile(parseFile(text));
  assert.deepEqual(report.errors, []);
  const file = parseFile(text);
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  assert.doesNotMatch(
    text.match(/<article[\s\S]*?<\/article>/)[0],
    /tx-|data-tx-/,
    "nothing generated is saved",
  );
  return diffLines(built.split("\n"), text.split("\n"))
    .filter((e) => e.op === "+")
    .map((e) => e.text);
}

async function run(name) {
  const pass = (what) => console.log(`PASS text footnotes [${name}]: ${what}`);
  const browser = await playwright[name].launch();
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
    // A computed style; for content, the text as drawn (Firefox keeps attr() unresolved, WebKit
    // lists the strings).
    const style = (selector, pseudo, prop) =>
      page.evaluate(
        ([s, p, k]) => {
          const el = document.querySelector(s);
          const value = getComputedStyle(el, p)[k];
          if (k !== "content" || value === "none" || value === "normal")
            return value;
          return [...value.matchAll(/attr\(([\w-]+)\)|"([^"]*)"/g)]
            .map((m) => (m[1] ? (el.getAttribute(m[1]) ?? "") : m[2]))
            .join("");
        },
        [selector, pseudo, prop],
      );
    // The cursor at the end of an element's text (End does not move the caret on macOS).
    const cursorAtEnd = (selector) =>
      page.evaluate((s) => {
        const { view } = window.htmlText;
        const el = document.querySelector(s);
        const pos = view.posAtDOM(el, el.childNodes.length);
        const $pos = view.state.doc.resolve(pos);
        const sel = view.state.selection.constructor.near($pos, -1);
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
        view.focus();
      }, selector);
    const notes = () =>
      page
        .locator("#doc .tx-notes li")
        .evaluateAll((items) => items.map((li) => li.textContent));
    const open = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#doc .footnote")].map((f) =>
          f.classList.contains("tx-open"),
        ),
      );

    // ---- a numbered reference, a hover preview and the notes list ----
    const note = "#doc p.lead .footnote";
    assert.equal(await page.getAttribute(note, "data-tx-note"), "1");
    assert.equal(await style(note, "::before", "content"), "1");
    assert.equal(await style(note, null, "fontSize"), "0px", "closed");
    assert.deepEqual(await notes(), [
      "Fictional management accounts, unaudited.",
    ]);
    await page
      .locator(note)
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.hover(note);
    assert.equal(
      await style(`${note}:hover`, "::after", "content"),
      "Fictional management accounts, unaudited.",
    );
    pass("a numbered reference with a hover preview, and the notes list");

    // ---- insert by shortcut and by menu; Escape leaves the note ----
    await cursorAtEnd("#doc p.ta-j");
    await page.keyboard.press(`${mod}+Alt+KeyF`);
    await page.keyboard.type("A second note.");
    assert.deepEqual(await open(), [false, true]);
    assert.deepEqual(await notes(), [
      "Fictional management accounts, unaudited.",
      "A second note.",
    ]);
    await page.keyboard.press("Escape");
    assert.deepEqual(await open(), [false, false]);
    await page.keyboard.type(" After.");
    let lines = check(await saved());
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /is available\.<span class="footnote">A second note\.<\/span> After\.<\/p>$/,
    );
    // Insert › Footnote in a list item, after that paragraph: the third note.
    await cursorAtEnd("#doc ul > li");
    await page.click(".tx-shell [role=menubar] button:text-is('Insert')");
    await page.click("[role=menu] [role^=menuitem]:has-text('Footnote')");
    await page.keyboard.type("In a list.");
    assert.deepEqual(await notes(), [
      "Fictional management accounts, unaudited.",
      "A second note.",
      "In a list.",
    ]);
    pass(
      "Insert › Footnote and its shortcut open a new note; Escape leaves it",
    );

    // ---- the notes list opens a note; print keeps references closed ----
    await page.locator("#doc .tx-notes li").nth(0).click();
    assert.deepEqual(await open(), [true, false, false]);
    assert.equal(
      await page.evaluate(() => {
        const { $from } = window.htmlText.view.state.selection;
        return $from.parent.type.name;
      }),
      "footnote",
    );
    await page.emulateMedia({ media: "print" });
    assert.equal(await style(note, null, "fontSize"), "0px", "closed in print");
    assert.notEqual(await style("#doc .tx-notes", null, "display"), "none");
    assert.equal(
      await style("#doc ul .footnote", "::before", "content"),
      "3",
      "print numbers the endnotes as the screen does",
    );
    await page.emulateMedia({ media: "screen" });
    pass("a click in the notes list opens that note; print keeps the endnotes");

    // ---- formatting inside a note shows in the list; print never shows a preview ----
    await page.locator("#doc .tx-notes li").nth(1).click();
    await page.evaluate(() => {
      const { view } = window.htmlText;
      const { $from } = view.state.selection;
      const start = $from.start();
      view.dispatch(
        view.state.tr.setSelection(
          view.state.selection.constructor.create(
            view.state.doc,
            start + 2,
            start + 8,
          ),
        ),
      );
    });
    await page.keyboard.press(`${mod}+b`);
    assert.equal(
      await page.locator("#doc .tx-notes li").nth(1).innerHTML(),
      "A <strong>second</strong> note.",
    );
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.press("Escape");
    await page.hover(note);
    await page.emulateMedia({ media: "print" });
    assert.equal(
      await style(note, "::after", "content"),
      "none",
      "no hover preview in print",
    );
    await page.emulateMedia({ media: "screen" });
    pass(
      "formatting inside a note shows in the notes list; print shows no preview",
    );

    // ---- cut a sentence with its note and paste it elsewhere ----
    const before = await saved();
    await page.evaluate(() => {
      const { view } = window.htmlText;
      let from, to;
      view.state.doc.descendants((node, pos) => {
        if (
          from === undefined &&
          node.isText &&
          node.text.startsWith(", ahead of plan.")
        )
          from = pos;
        if (
          node.type.name === "footnote" &&
          from !== undefined &&
          to === undefined
        )
          to = pos + node.nodeSize;
      });
      view.dispatch(
        view.state.tr.setSelection(
          view.state.selection.constructor.create(view.state.doc, from, to),
        ),
      );
      view.focus();
    });
    // Clipboard events with one DataTransfer, as the editor receives them from the keyboard
    // (WebKit on Linux delivers no paste for a synthetic shortcut).
    // What the editor wrote is read where the event ends (Firefox copies the event's
    // DataTransfer), then given to a paste event in a new one.
    const clip = (type) =>
      page.evaluate((t) => {
        if (!window.clipListener) {
          window.clipListener = (e) =>
            (window.clipped = Object.fromEntries(
              [...e.clipboardData.types].map((k) => [
                k,
                e.clipboardData.getData(k),
              ]),
            ));
          for (const k of ["copy", "cut"])
            window.addEventListener(k, window.clipListener);
        }
        const data = new DataTransfer();
        if (t === "paste")
          for (const [k, v] of Object.entries(window.clipped ?? {}))
            data.setData(k, v);
        window.htmlText.view.dom.dispatchEvent(
          new ClipboardEvent(t, {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, type);
    await clip("cut");
    await cursorAtEnd("#doc ul > li:last-child");
    await clip("paste");
    lines = check(await saved());
    assert.ok(
      lines.some((l) =>
        /, ahead of plan\.<span class="footnote">Fictional management accounts, unaudited\.<\/span><\/li>/.test(
          l,
        ),
      ),
      lines.join("\n"),
    );
    assert.deepEqual((await notes())[0], "A second note.");
    for (let i = 0; i < 4 && (await saved()) !== before; i++)
      await page.keyboard.press(`${mod}+z`);
    assert.equal(await saved(), before, "undo restores the cut and the paste");
    pass("cut and paste carry a sentence's note, and the numbers follow");

    // ---- undo: the last note goes first, and the list follows ----
    for (let i = 0; i < 5 && (await notes()).length === 3; i++)
      await page.keyboard.press(`${mod}+z`);
    assert.deepEqual(await notes(), [
      "Fictional management accounts, unaudited.",
      "A second note.",
    ]);
    lines = check(await saved());
    assert.equal(lines.length, 1);
    pass("undo removes notes and renumbers the list");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
