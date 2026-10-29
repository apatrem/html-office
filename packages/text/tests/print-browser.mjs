// T14 from file://: print and the read-only print preview. In Chromium, every table, chart,
// footnote and wrapped-image fixture is printed to PDF and compared with the preview page by page:
// the page count, the text each preview page holds (found on the same PDF page), the page of every
// linked heading and table, page numbers and the running header on every page; then repeated table
// headers, endnotes, explicit page breaks, the contents' links, hidden comments, and the header
// setting. Firefox and WebKit (no page.pdf) check the preview itself.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/print-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { LAYOUT_CSS, CHARTE_CSS } from "../theme/index.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { readPDF } from "./pdf.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const fixture = (name) =>
  readFile(new URL(`../fixtures/valid/${name}.html`, import.meta.url), "utf8");
// Fixtures without a look get the default charte and layout theme, so they have pages.
const themed = (html) =>
  html.includes('<style id="theme">')
    ? html
    : html.replace(
        "</head>",
        () =>
          `<style id="charte">${CHARTE_CSS}</style>\n<style id="theme">${LAYOUT_CSS}</style>\n</head>`,
      );
const engine = await buildEngine();
const print = await fixture("print");
const variant = (page, margins) =>
  print.replace(
    " data-header=",
    () => ` data-page="${page}" data-margins="${margins}" data-header=`,
  );
const DOCUMENTS = [
  ["print", print],
  ["print-letter-wide", variant("letter", "wide")],
  ["print-a4-narrow", variant("a4", "narrow")],
  ["example", await fixture("example")],
  ["tables", themed(await fixture("tables"))],
  ["figures", themed(await fixture("figures"))],
  ["inline", themed(await fixture("inline"))],
  ["blocks", themed(await fixture("blocks"))],
];
const urls = {};
for (const [name, html] of DOCUMENTS) {
  const path = join(out, `print-${name}.html`);
  await writeFile(path, await buildDocument(html, engine));
  urls[name] = pathToFileURL(path).href;
}
const HEADER = "Riverside libraries · Annual report 2026";
// Text compared between the preview and the PDF: letters and digits (fonts may draw no-break
// spaces, CJK and emoji with glyphs the PDF does not map back).
const plain = (text) => text.replace(/[^A-Za-z0-9]/g, "");

// What the preview shows: its pages, the text on each (text node pieces, in document order), the
// page of each element with an ID, the header and footer of each page.
const previewed = (page) =>
  page.evaluate(() => {
    const doc = document.getElementById("doc");
    const box = doc.getBoundingClientRect();
    const cs = getComputedStyle(doc);
    const stride =
      box.width + parseFloat(cs.columnGap) - 2 * parseFloat(cs.paddingTop);
    const at = (rect) => Math.floor((rect.left - box.left + 1) / stride);
    const text = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      if (n.parentElement.closest("svg")) continue;
      let current = null,
        piece = "";
      const flush = () => {
        if (piece.trim()) (text[current] ??= []).push(piece);
        piece = "";
      };
      for (let k = 0; k < n.length; k++) {
        range.setStart(n, k);
        range.setEnd(n, k + 1);
        const r = range.getClientRects()[0];
        if (!r?.width) continue;
        if (at(r) !== current) {
          if (current !== null) flush();
          current = at(r);
        }
        piece += n.data[k];
      }
      if (current !== null) flush();
    }
    const ids = {};
    for (const el of doc.querySelectorAll("[id]")) {
      const r = el.getClientRects()[0];
      if (r?.width) ids[el.id] = at(r);
    }
    const pages = [...document.querySelectorAll(".tx-page")];
    return {
      count: window.htmlText.preview.pages,
      text,
      ids,
      heads: pages.map((p) => p.querySelector(".tx-page-head").textContent),
      feet: pages.map((p) => p.querySelector(".tx-page-foot").textContent),
      repeats: [...document.querySelectorAll(".tx-repeat")].map((t) => ({
        page: at(t.getBoundingClientRect()),
        top: t.getBoundingClientRect().top - box.top,
        margin: parseFloat(cs.paddingTop),
        cells: t.querySelectorAll("th").length,
        text: t.textContent,
      })),
      wrapped: [...doc.querySelectorAll("figure.image[data-wrap]")].map(
        (f) => new Set([...f.nextElementSibling.getClientRects()].map(at)).size,
      ),
    };
  });

async function run(name) {
  const pass = (what) => console.log(`PASS text print [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const open = async (doc) => {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.addInitScript(() => {
        window.printed = 0;
        window.print = () => window.printed++;
      });
      await page.goto(urls[doc]);
      await page.waitForFunction(() => window.htmlText);
      return { page, errors };
    };
    const menu = async (page, menuName, item) => {
      await page.click(
        `.tx-shell [role=menubar] button:text-is('${menuName}')`,
      );
      await page.click(`[role=menu] [role^=menuitem]:has-text('${item}')`);
    };
    const preview = async (page) => {
      await menu(page, "File", "Print preview");
      await page.waitForSelector(".tx-preview-bar");
      await page.evaluate(() => document.fonts.ready);
      return previewed(page);
    };
    const closePreview = async (page) => {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".tx-preview-bar", { state: "detached" });
    };

    // ---- the preview against the PDF, page by page (Chromium prints) ----
    if (name === "chromium")
      for (const [doc] of DOCUMENTS) {
        const { page, errors } = await open(doc);
        const shown = await preview(page);
        await closePreview(page);
        const pdf = readPDF(
          await page.pdf({
            path: join(out, `print-${doc}.pdf`),
            preferCSSPageSize: true,
          }),
        );
        const pages = pdf.pages.map((p) => p.text.replace(/\s+/g, " "));
        assert.equal(pages.length, shown.count, `${doc}: page count`);
        assert.equal(shown.feet.length, shown.count, doc);
        pages.forEach((text, i) => {
          const all = plain(text);
          for (const piece of shown.text[i] ?? [])
            assert.ok(
              all.includes(plain(piece)),
              `${doc}: ${JSON.stringify(piece)} printed on page ${i + 1}`,
            );
          assert.ok(text.includes(`${i + 1} / ${pages.length}`), `${doc} ${i}`);
          assert.equal(shown.feet[i], `${i + 1} / ${pages.length}`);
        });
        assert.ok(Object.keys(pdf.destinations).length > 0 || doc !== "print");
        for (const [id, { page: at }] of Object.entries(pdf.destinations))
          assert.equal(at, shown.ids[id], `${doc}: #${id} on the same page`);
        if (doc.startsWith("print")) {
          for (const [i, text] of pages.entries())
            assert.ok(text.startsWith(`${HEADER} ${i + 1} / `), `${doc} ${i}`);
          assert.deepEqual(new Set(shown.heads), new Set([HEADER]));
        } else assert.deepEqual(new Set(shown.heads), new Set([""]));
        assert.deepEqual(errors, [], doc);
        await page.close();
      }
    if (name === "chromium")
      pass(
        "preview and PDF: same pages, same text on each, same page for each heading and table (8 documents, A4/Letter, three margins)",
      );

    // ---- print.html: repeated headers, wrapped images, endnotes, breaks, links, comments ----
    {
      const { page, errors } = await open("print");
      const shown = await preview(page);
      const table = shown.ids["tab-branches"];
      if (name !== "chromium")
        console.log(
          `INFO text print [${name}]: ${shown.count} preview pages; table on page ${table + 1}, its header repeated on ${shown.repeats.map((r) => r.page + 1).join(", ") || "none"}; Plan on ${shown.ids["sec-plan"] + 1}, Annex on ${shown.ids["sec-annex"] + 1}`,
        );
      // Firefox breaks columns its own way (it has no column breaks; the preview makes them).
      const exact = name !== "firefox";
      if (exact) assert.ok(shown.count >= 8, `${shown.count} pages`);
      // The table with merged cells continues on two more pages, its header drawn on each.
      if (exact) assert.equal(shown.repeats.length, 2);
      shown.repeats.forEach((r, i) => {
        if (exact) assert.equal(r.page, table + 1 + i);
        else assert.ok(r.page > table);
        assert.ok(Math.abs(r.top - r.margin) < 1, `at the top: ${r.top}`);
        assert.equal(r.cells, 5);
        // A footnote in a header cell shows as its number, as it prints.
        assert.equal(plain(r.text), plain("Branch Loans Visits3 2025 2026"));
      });
      // A wrapped image whose paragraph starts on one page and ends on the next (where breaks
      // fall depends on the engine; this is the fixture's layout in Chromium).
      if (name === "chromium")
        assert.ok(
          shown.wrapped.some((n) => n > 1),
          shown.wrapped.join(),
        );
      // A page break before "Plan for 2027", "start on a new page" for "Annex".
      assert.equal(shown.ids["sec-annex"], shown.ids["sec-plan"] + 1);
      assert.equal(shown.text[shown.ids["sec-plan"]][0], "Plan for 2027");
      assert.equal(shown.text[shown.ids["sec-annex"]][0], "Annex");
      assert.ok(shown.heads.every((h) => h === HEADER));
      // Printing from the preview prints the document, not the preview's pages or its rules.
      const inPreview =
        name === "chromium" &&
        readPDF(await page.pdf({ preferCSSPageSize: true })).pages.map((p) =>
          p.text.replace(/\s+/g, " "),
        );
      pass(
        "preview: a merged table over three pages with its header on each, page breaks, header and page numbers",
      );

      // Read-only: typing, shortcuts and the editor are off; Print prints; Escape closes.
      const before = await page.evaluate(() => window.htmlText.serialize());
      assert.equal(
        await page.evaluate(() => document.getElementById("doc").inert),
        true,
      );
      await page.keyboard.type("xyz");
      await page.keyboard.press("Backspace");
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await page.mouse.click(300, 400);
      await page.keyboard.type("q");
      assert.equal(
        await page.evaluate(() => window.htmlText.serialize()),
        before,
      );
      await page.click(".tx-preview-bar button:has-text('Print / PDF')");
      assert.equal(await page.evaluate(() => window.printed), 1);
      await closePreview(page);
      assert.deepEqual(
        await page.evaluate(() => [
          document.documentElement.classList.contains("tx-preview"),
          document.getElementById("doc").inert,
          document.querySelectorAll(".tx-page, .tx-repeat").length,
          document.activeElement.id,
        ]),
        [false, false, 0, "doc"],
      );
      await page.keyboard.type("Z");
      assert.notEqual(
        await page.evaluate(() => window.htmlText.serialize()),
        before,
      );
      pass(
        "the preview is read-only, prints with the button and closes with Escape back to editing",
      );
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );

      if (name === "chromium") {
        const pdf = readPDF(await page.pdf({ preferCSSPageSize: true }));
        const pages = pdf.pages.map((p) => p.text.replace(/\s+/g, " "));
        const flat = pages.map(plain);
        // Repeated header rows: both header rows at the top of each continuation page.
        assert.deepEqual(inPreview, pages);
        // (The header's note number is painted last on the page.)
        const head = plain("Branch Loans Visits 2025 2026");
        const body = (i) =>
          plain(pages[i].slice(`${HEADER} ${i + 1} / ${pages.length}`.length));
        for (const i of [table + 1, table + 2])
          assert.ok(body(i).startsWith(head), pages[i]);
        // Endnotes: the notes list, numbered as on screen, on the last page.
        assert.match(
          pages.at(-1),
          /Notes 1\. Fictional figures, rounded to the nearest hundred\. 2\. Counted at the door\. 3\. Door counts, all entrances\. 4\. Branches 9 and 10 share a building\. 5\. Sources: fictional branch returns\./,
        );
        // Explicit breaks: each section starts its page.
        assert.ok(body(shown.ids["sec-plan"]).startsWith("3Planfor2027"));
        assert.ok(body(shown.ids["sec-annex"]).startsWith("4Annex"));
        // The contents link to the headings (no page numbers), and the PDF keeps the links.
        const links = pdf.pages[0].links.join(" ");
        for (const id of [
          "sec-summary",
          "sec-visits",
          "sec-branches",
          "sec-plan",
          "sec-annex",
        ]) {
          assert.match(links, new RegExp(`/Dest /${id}\\b`));
          assert.equal(pdf.destinations[id].page, shown.ids[id]);
        }
        // Comments are hidden: neither the thread nor its quotation's marking prints.
        assert.ok(
          !flat.some((t) => t.includes(plain("Confirm with the budget"))),
        );
        assert.ok(!flat.some((t) => t.includes("Sam")));
        pass(
          "PDF: repeated table headers, endnotes, page breaks, linked contents, no comments; printing from the preview gives the same PDF",
        );
      }

      // An engine without column breaks: the preview still starts those sections on a page.
      const noBreaks = await page.addStyleTag({
        content:
          ":root.tx-preview #doc.ProseMirror .new-page{break-before:auto!important}:root.tx-preview #doc.ProseMirror hr.page-break{break-after:auto!important}",
      });
      const pushed = await preview(page);
      // Both sections are pushed by the preview's own margins.
      assert.equal(
        await page.evaluate(
          () =>
            [...document.querySelectorAll("style")]
              .map((s) => s.textContent)
              .join()
              .match(/#doc>:nth-child\(\d+\)\{margin-top/g)?.length,
        ),
        2,
      );
      assert.equal(pushed.count, shown.count);
      assert.deepEqual(
        ["sec-plan", "sec-annex"].map((id) => pushed.ids[id]),
        ["sec-plan", "sec-annex"].map((id) => shown.ids[id]),
      );
      assert.equal(pushed.text[pushed.ids["sec-plan"]][0], "Plan for 2027");
      assert.equal(pushed.text[pushed.ids["sec-annex"]][0], "Annex");
      await closePreview(page);
      await noBreaks.evaluate((el) => el.remove());
      pass(
        "without column breaks, the preview still starts a page where print does",
      );

      // A table added while the preview is open (a paste completing): its header is copied
      // before the pages are drawn again.
      await preview(page);
      await page.evaluate(() => {
        const { view } = window.htmlText;
        const s = view.state;
        let figure, end;
        s.doc.forEach((node, offset) => {
          if (node.attrs.id === "tab-branches") figure = node;
          if (node.type.name === "comments") end = offset;
        });
        view.dispatch(
          s.tr.insert(
            end,
            figure.type.create({ id: "tab-copy" }, figure.content),
          ),
        );
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const grown = await previewed(page);
      assert.ok(grown.count > shown.count, `${grown.count} pages`);
      assert.equal(grown.feet.length, grown.count);
      assert.ok(
        grown.repeats.length >= (exact ? 4 : shown.repeats.length),
        `${grown.repeats.length} copies`,
      );
      for (const r of grown.repeats) assert.equal(r.cells, 5);
      await closePreview(page);
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      assert.equal(await page.locator("#tab-copy").count(), 0);
      pass(
        "a table added while previewing gets its pages and repeated headers",
      );

      // ---- the running header: Document settings, undo, save ----
      await menu(page, "File", "Document settings…");
      // The preview's classes never restyle the panel's choices.
      assert.equal(
        await page
          .locator(".tx-drawer [role=radiogroup][aria-label='Page format']")
          .evaluate((el) => getComputedStyle(el).position),
        "static",
      );
      const field = page.getByLabel("Text at the top of every printed page");
      assert.equal(await field.inputValue(), HEADER);
      await field.fill('  Draft "B" \\ for the board  ');
      await field.press("Enter");
      assert.equal(
        await page.evaluate(() => window.htmlText.view.state.doc.attrs.header),
        'Draft "B" \\ for the board',
      );
      const saved = await page.evaluate(() => window.htmlText.serialize());
      assert.match(
        saved,
        / data-header="Draft &quot;B&quot; \\ for the board">/,
      );
      assert.deepEqual(validateFile(parseFile(saved)).errors, []);
      if (name === "chromium") {
        const pdf = readPDF(await page.pdf({ preferCSSPageSize: true }));
        for (const p of pdf.pages)
          assert.ok(
            p.text
              .replace(/\s+/g, " ")
              .startsWith('Draft "B" \\ for the board '),
          );
      }
      await field.fill("");
      await field.press("Enter");
      assert.equal(
        await page.evaluate(() => window.htmlText.view.state.doc.attrs.header),
        null,
      );
      const bare = await preview(page);
      assert.deepEqual(new Set(bare.heads), new Set([""]));
      await closePreview(page);
      if (name === "chromium") {
        const pdf = readPDF(await page.pdf({ preferCSSPageSize: true }));
        assert.ok(
          pdf.pages[1].text
            .replace(/\s+/g, " ")
            .startsWith(`2 / ${pdf.pages.length}`),
        );
      }
      // Each change is one undo step; the field follows undo.
      await page.click('.tx-shell button[aria-label="Undo"]');
      assert.equal(await field.inputValue(), 'Draft "B" \\ for the board');
      await page.click('.tx-shell button[aria-label="Undo"]');
      assert.equal(await field.inputValue(), HEADER);
      pass(
        "the running header is set, printed, removed and undone from Document settings, and saved valid",
      );

      if (name !== "chromium") {
        // Engines without page.pdf(): report what they parse of the page margin boxes.
        const margins = await page.evaluate(() =>
          [...document.styleSheets].some((s) =>
            [...s.cssRules].some(
              (r) => r instanceof CSSPageRule && r.cssRules?.length,
            ),
          ),
        );
        console.log(
          `INFO text print [${name}]: ${shown.count} preview pages; @page margin boxes parsed: ${margins}`,
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }

    // ---- a draft restored while the preview is open is what the preview shows ----
    if (name === "chromium") {
      let { page } = await open("print");
      await page.evaluate(() =>
        window.htmlText.commands.run("header", "Draft header"),
      );
      await page.waitForSelector(".tx-shell [role=status][data-state=draft]");
      await page.close();
      ({ page } = await open("print"));
      await page.waitForSelector("dialog.sh-dialog[open]");
      await page.evaluate(() => window.htmlText.commands.run("preview"));
      assert.deepEqual(
        new Set(await page.locator(".tx-page-head").allTextContents()),
        new Set([HEADER]),
      );
      await page.click("dialog.sh-dialog button:text('Restore draft')");
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.deepEqual(
        new Set(await page.locator(".tx-page-head").allTextContents()),
        new Set(["Draft header"]),
      );
      await page.close();
      pass("a draft restored while previewing is previewed");
    }
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
