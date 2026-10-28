// T07 from file:// in Chromium, Firefox and WebKit: paste from Word, Docs, Excel and web pages,
// html-office envelopes, plain text, Markdown import, drop, and copying a table as the envelope.
// Paste and copy run through dispatched clipboard events (native pasteboards are in
// docs/MANUAL-CHECKS.md). After each paste the document saves as a valid, canonical file, and
// one undo restores it exactly.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/clipboard-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
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
const path = join(out, "clipboard.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;
const fixture = (name) =>
  readFile(new URL(`../fixtures/clipboard/${name}`, import.meta.url), "utf8");
const shared = (name) =>
  readFile(
    new URL(`../../shared/clipboard/fixtures/${name}`, import.meta.url),
    "utf8",
  );

// The saved text is a valid file, without protected blocks beyond the example's, that reopens
// as the same document.
function check(text) {
  const file = parseFile(text);
  const report = validateFile(file);
  assert.deepEqual(report.errors, []);
  assert.equal(report.protected.length, 0, "no protected block");
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return text;
}
const article = (text) =>
  text.slice(
    text.indexOf('<article id="doc" data-format'),
    text.indexOf("</article>") + 10,
  );

// The lines of `after` that `before` does not have, joined.
const added = (before, after) =>
  diffLines(article(before).split("\n"), article(after).split("\n"))
    .filter((e) => e.op === "+")
    .map((e) => e.text)
    .join("\n");

// A paste event carrying a DataTransfer (Firefox's constructor ignores clipboardData).
const init = () => {
  globalThis.transfer = (types) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(types))
      data.setData(type, value);
    return data;
  };
  globalThis.clipboardEvent = (name, data) => {
    const event = new ClipboardEvent(name, {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    if (event.clipboardData !== data)
      Object.defineProperty(event, "clipboardData", { value: data });
    return event;
  };
};

async function run(engine) {
  const pass = (name) =>
    console.log(`PASS text clipboard [${engine}]: ${name}`);
  const browser = await playwright[engine].launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("dialog", (d) => {
      errors.push(`dialog: ${d.message()}`);
      d.dismiss();
    });
    page.on("request", (r) => {
      if (!r.url().startsWith("file:")) requests.push(r.url());
    });
    await page.addInitScript(init);
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    const status = () =>
      page.evaluate(
        () => document.querySelector(".tx-shell [role=status]").textContent,
      );
    // Puts the caret at the end (or start) of the textblock holding `text`.
    const caret = (text, end = true) =>
      page.evaluate(
        ([text, end]) => {
          const { view } = window.htmlText;
          let at = null;
          view.state.doc.descendants((node, pos) => {
            if (
              at === null &&
              node.isTextblock &&
              node.textContent.includes(text)
            )
              at = end ? pos + node.nodeSize - 1 : pos + 1;
          });
          const S = window.htmlText.TextSelection;
          view.dispatch(
            view.state.tr.setSelection(S.create(view.state.doc, at, at)),
          );
          view.focus();
        },
        [text, end],
      );
    const paste = (types) =>
      page.evaluate((types) => {
        const { view } = window.htmlText;
        view.dom.dispatchEvent(clipboardEvent("paste", transfer(types)));
      }, types);
    const undo = () =>
      page.evaluate(() => window.htmlText.commands.run("undo"));
    // Pastes, checks the saved file and that one undo restores the document; returns the article.
    async function pasted(types, at = "ahead of plan") {
      await caret(at);
      const before = await saved();
      await paste(types);
      const after = check(await saved());
      assert.notEqual(after, before, "the paste changed the document");
      await undo();
      assert.equal(await saved(), before, "one undo restores the document");
      return added(before, after);
    }

    // ---- other applications ----
    let doc = await pasted({
      "text/html": await fixture("word-document.html"),
    });
    assert.match(
      doc,
      /<h2 id="sec-next-steps">Next steps<\/h2>\n<ul>\n<li>Order compost<ul>/,
    );
    assert.match(doc, /<ol>\n<li>Book the hall<\/li>/);
    assert.match(doc, /<figure class="table" id="tab-1">/);
    await paste({ "text/html": await fixture("word-document.html") });
    assert.match(
      await status(),
      /Left out: 1 image, 2 Word footnotes or comments\./,
    );
    await undo();
    pass(
      "Word: headings, lists, marks, links and a table; notes and the picture left out",
    );

    doc = await pasted({ "text/html": await fixture("docs-document.html") });
    assert.match(doc, /<h1 id="sec-volunteer-plan">Volunteer plan<\/h1>/);
    assert.match(doc, /<li>Watering<ul>\n<li>North beds<\/li>/);
    pass("Google Docs: headings, span styles, nested lists, table");

    for (const name of [
      "excel-macos.html",
      "sheets-fr.html",
      "word-macos.html",
      "docs.html",
    ]) {
      doc = await pasted({
        "text/html": await shared(name),
        "text/plain": "x",
      });
      assert.match(doc, /<figure class="table" id="tab-1">/, name);
    }
    pass("Excel, Sheets, Word and Docs tables become Text tables");

    doc = await pasted({
      "text/html":
        (await fixture("web-page.html")) +
        '<img src="https://example.org/x.png" onerror="window.__ran=1"><script>window.__ran=1</script>' +
        '<iframe src="https://example.org/frame"></iframe><a href="javascript:window.__ran=1">j</a>' +
        '<p style="background:url(https://example.org/bg.png)" onclick="window.__ran=1">styled</p>',
    });
    assert.match(doc, /<h1 id="spring-harvest">Spring harvest<\/h1>/);
    assert.doesNotMatch(doc, /__ran|javascript|onclick|style=/);
    assert.equal(await page.evaluate(() => window.__ran), undefined);
    assert.deepEqual(requests, [], "the paste loaded nothing");
    pass(
      "a web page: content kept, scripts, frames, media and styles inert and dropped",
    );

    // ---- html-office envelopes ----
    const table = {
      rows: [
        [{ text: "Region", header: true, colspan: 2 }, { covered: true }],
        [{ text: "North" }, { text: "1.9", align: "right", bold: true }],
        [{ text: "Total" }, { text: "4.2", align: "right" }],
      ],
      headerRows: 1,
      totalRows: [2],
    };
    const envelope = JSON.stringify({
      schema: "html-office-clip/1",
      kind: "table",
      source: { product: "slides", format: "1" },
      table,
    });
    const expected =
      '<figure class="table" id="tab-1">\n<table>\n<thead>\n<tr><th colspan="2">Region</th></tr>\n</thead>\n<tbody>\n' +
      '<tr><td>North</td><td class="ta-r"><strong>1.9</strong></td></tr>\n<tr class="total"><td>Total</td><td class="ta-r">4.2</td></tr>\n</tbody>\n</table>\n</figure>';
    doc = await pasted({
      "application/x-html-office+json": envelope,
      "text/html": "<p>ignored</p>",
      "text/plain": "ignored",
    });
    assert.ok(doc.includes(expected), "custom carrier");
    const attribute = envelope.replace(
      /[&"<>]/g,
      (c) => `&#${c.charCodeAt(0)};`,
    );
    doc = await pasted({
      "text/html": `<table data-html-office="${attribute}"><tr><td>ignored</td></tr></table>`,
    });
    assert.ok(doc.includes(expected), "HTML carrier");
    pass(
      "html-office tables through the envelope, from its own type or the HTML attribute",
    );

    const unchanged = async (types, message) => {
      await caret("ahead of plan");
      const before = await saved();
      await paste(types);
      assert.equal(await saved(), before);
      assert.match(await status(), message);
    };
    await unchanged(
      {
        "application/x-html-office+json":
          '{"schema":"html-office-clip/1","kind":"table","table":{"rows":[]}}',
        "text/plain": "fallback",
      },
      /^Nothing was pasted: .*rows must be a non-empty array/,
    );
    await unchanged(
      {
        "application/x-html-office+json": JSON.stringify({
          schema: "html-office-clip/1",
          kind: "chart",
          chart: {},
        }),
      },
      // A chart is T11's: a broken one is refused there.
      /^Paste failed: .*Document unchanged\./,
    );
    const big = Array.from({ length: 1001 }, () => [{ text: "x" }]);
    await unchanged(
      {
        "application/x-html-office+json": JSON.stringify({
          schema: "html-office-clip/1",
          kind: "table",
          table: { rows: big },
        }),
      },
      /^Nothing was pasted: a Text table holds at most 1,000 rows and 30 columns\./,
    );
    doc = await pasted({
      "application/x-html-office+json": JSON.stringify({
        schema: "html-office-clip/9",
        kind: "table",
      }),
      "text/plain": "From a newer version",
    });
    assert.match(doc, /Table 1<\/a>\.From a newer version<\/p>/);
    pass(
      "broken, chart and oversized envelopes refused; a newer schema skipped",
    );

    // ---- plain text, and where the paste lands ----
    doc = await pasted({ "text/plain": "First line\n\nSecond line" });
    assert.match(
      doc,
      /ahead of plan\.<span class="footnote">[^\n]*First line<\/p>\n<p>Second line<\/p>/,
    );
    await caret("ahead of plan");
    await page.evaluate(() => {
      const { view } = window.htmlText;
      const mac = /Mac/.test(navigator.platform);
      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "V",
          shiftKey: true,
          metaKey: mac,
          ctrlKey: !mac,
          bubbles: true,
        }),
      );
    });
    const before = await saved();
    await paste({ "text/html": "<h2>Rich</h2>", "text/plain": "Plain words" });
    assert.match(
      article(check(await saved())),
      /ahead of plan\.<span[^\n]*Plain words<\/p>/,
    );
    await undo();
    assert.equal(await saved(), before);
    // Shift released, as a real keyboard does (ProseMirror reads Shift for plain pastes).
    await page.keyboard.press("Shift");
    pass("plain text: lines become paragraphs; Shift paste ignores the HTML");

    doc = await pasted(
      {
        "text/html":
          "<h2>A</h2><ul><li>b</li></ul><table><tr><td>1</td><td>2</td></tr></table>",
      },
      "West",
    );
    assert.match(doc, /<tr><td>WestA<br>b<br>1 2<\/td>/);
    doc = await pasted(
      { "text/html": "<p>x = 1</p><p>y = 2</p>" },
      "growth   = 0.12",
    );
    assert.match(doc, /growth {3}= 0\.12x = 1\ny = 2<\/code><\/pre>/);
    pass("in a table cell the paste becomes lines; in code, text");

    // ---- copy ----
    const copy = (select) =>
      page.evaluate((select) => {
        const { view } = window.htmlText;
        if (select === "table") {
          let at = null;
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === "table_figure" && at === null) at = pos;
          });
          view.dispatch(
            view.state.tr.setSelection(
              window.htmlText.NodeSelection.create(view.state.doc, at),
            ),
          );
        }
        const data = new DataTransfer();
        view.dom.dispatchEvent(clipboardEvent("copy", data));
        return Object.fromEntries(
          [...data.types].map((t) => [t, data.getData(t)]),
        );
      }, select);
    const flavours = await copy("table");
    const sent = JSON.parse(flavours["application/x-html-office+json"]);
    assert.equal(sent.schema, "html-office-clip/1");
    assert.deepEqual(sent.source, { product: "text", format: "1" });
    assert.equal(sent.table.headerRows, 2);
    assert.deepEqual(sent.table.totalRows, [5]);
    assert.deepEqual(sent.table.columns, [
      { width: 40 },
      { width: 30 },
      { width: 30 },
    ]);
    assert.match(flavours["text/html"], /data-html-office="/);
    assert.match(
      flavours["text/html"],
      /<th rowspan="2"[^>]* style="[^"]*background-color:/,
    );
    assert.equal(
      flavours["text/plain"],
      "Region\tRevenue\t\n\t2025\t2026\nNorth\t1.6\t1.9\nSouth\t1.2\t1.4\nWest\t0.8\t0.9\nTotal\t3.6\t4.2",
    );
    // As from another Text document (this copy's token dropped): the envelope is read.
    doc = await pasted(
      {
        ...flavours,
        "text/html": flavours["text/html"].replace(/ data-tx-clip="[^"]*"/, ""),
      },
      "Grow where",
    );
    assert.match(
      doc,
      /<figure class="table" id="tab-1">\n<table>\n<colgroup><col data-width="40"><col data-width="30"><col data-width="30"><\/colgroup>\n<thead>\n<tr><th rowspan="2">Region<\/th><th colspan="2">Revenue<\/th><\/tr>/,
    );
    pass(
      "a selected table copies as the envelope, a styled table and TSV, and pastes back",
    );

    // A mixed selection copies as the subset's own markup and pastes back as itself.
    const mixed = await page.evaluate(() => {
      const { view } = window.htmlText;
      let from = null,
        to = null;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.attrs.id === "sec-plan")
          from = pos + 1;
        if (node.type.name === "blockquote" && to === null)
          to = pos + node.nodeSize - 2;
      });
      const S = window.htmlText.TextSelection;
      view.dispatch(
        view.state.tr.setSelection(S.create(view.state.doc, from, to)),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    assert.match(
      mixed["text/html"],
      /<h1 class="new-page" id="sec-plan"[^>]*>2027 plan<\/h1>/,
    );
    // No editor markup; the internal clipboard's token (T09) is the one attribute it adds.
    assert.doesNotMatch(
      mixed["text/html"].replace(/ data-tx-clip="[^"]*"/, ""),
      /tx-|style=|contenteditable/,
    );
    assert.match(mixed["text/plain"], /^2027 plan\n\nThe plan keeps/);
    // As from another Text document (without this copy's token, which the internal clipboard of
    // T09 would take): the HTML is mapped and reads back as itself.
    doc = await pasted(
      {
        ...mixed,
        "text/html": mixed["text/html"].replace(/ data-tx-clip="[^"]*"/, ""),
      },
      "Planning team",
    );
    assert.match(
      doc,
      /^(<li><a href="#sec-2027-plan">[^\n]*\n)?<h1 class="new-page" id="sec-2027-plan">2027 plan<\/h1>\n<p class="ta-j">The plan keeps[^\n]*\n<ul>\n<li>Open two sites in the <u>south<\/u> region<\/li>/,
    );
    // This copy pasted in a table cell, with its token: lines of the cell, not the copied blocks.
    doc = await pasted(mixed, "West");
    assert.match(doc, /<tr><td>West2027 plan<br>The plan keeps/);
    pass("a mixed selection copies as subset HTML and pastes back as itself");

    // ---- T08–T13 content: from another document, and copied out ----
    doc = await pasted({
      "text/html":
        '<p>See <a class="xref" href="#sec-plan">Section 7</a>, <a class="xref" href="#sec-elsewhere">Section 9</a> and <mark class="comment" data-ref="t-x">this</mark>.</p>' +
        '<figure class="image" id="fig-x" data-width="text"><img data-asset="a9" alt="Photo"></figure>' +
        '<section class="comments"><aside class="comment-thread" id="t-x" data-status="open" data-quote="this"><p class="comment" data-author="A" data-date="2026-10-15T14:02Z">Hi</p></aside></section>',
      "text/plain": "See Section 7, Section 9 and this.",
    });
    assert.match(
      doc,
      /See <a class="xref" href="#sec-plan">Section \d+<\/a>, Section 9 and this\.<\/p>$/,
    );
    // The paragraph pasted into keeps its own comment (c1); nothing pasted adds one.
    assert.doesNotMatch(doc, /t-x|data-asset|<img/);
    const everything = await page.evaluate(() => {
      const { view } = window.htmlText;
      const S = window.htmlText.TextSelection;
      view.dispatch(
        view.state.tr.setSelection(
          S.create(view.state.doc, 1, view.state.doc.content.size - 1),
        ),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      return data.getData("text/html");
    });
    assert.match(everything, /data-pm-slice/);
    assert.doesNotMatch(everything, /class="comment|data-asset|<img/);
    pass(
      "pasted content brings no comment, asset or dangling cross-reference; copies leave them out",
    );

    // Inside the document (T09's internal clipboard): a copied comment anchor is not repeated;
    // a whole anchor cut moves with its text.
    const anchors = () =>
      page.evaluate(
        () =>
          window.htmlText
            .serialize()
            .split('<mark class="comment" data-ref="c1">').length - 1,
      );
    const clip = (name, data) =>
      page.evaluate(
        ([name, data]) => {
          const { view } = window.htmlText;
          if (name !== "paste") {
            let from = null;
            view.state.doc.descendants((node, pos) => {
              if (
                from === null &&
                node.isText &&
                node.text.startsWith("Revenue grew")
              )
                from = pos;
            });
            const S = window.htmlText.TextSelection;
            view.dispatch(
              view.state.tr.setSelection(
                S.create(
                  view.state.doc,
                  from,
                  from + "Revenue grew 18% in 2026".length,
                ),
              ),
            );
          }
          const transfer = new DataTransfer();
          for (const [t, v] of Object.entries(data ?? {}))
            transfer.setData(t, v);
          view.dom.dispatchEvent(clipboardEvent(name, transfer));
          return Object.fromEntries(
            [...transfer.types].map((t) => [t, transfer.getData(t)]),
          );
        },
        [name, data],
      );
    assert.equal(await anchors(), 1);
    const copied = await clip("copy");
    assert.match(copied["text/html"], /data-tx-clip=/);
    await caret("Planning team");
    await clip("paste", copied);
    let text = check(await saved());
    assert.equal(await anchors(), 1, "a copy repeats no anchor");
    assert.equal(text.split("Revenue grew").length - 1, 3);
    await undo();
    const cut = await clip("cut");
    await caret("Planning team");
    await clip("paste", cut);
    text = check(await saved());
    assert.equal(await anchors(), 1, "a cut anchor moves with its text");
    assert.match(
      text,
      /Planning team[^\n]*<mark class="comment" data-ref="c1">Revenue grew 18% in 2026<\/mark>/,
    );
    await undo();
    await undo();
    pass(
      "inside the document a copy repeats no comment anchor; a cut one moves",
    );

    // ---- integration review: rich table copies, undo steps, references, plain text ----
    const serialize = () => page.evaluate(() => window.htmlText.serialize());
    const count = (text, part) => text.split(part).length - 1;
    const initial = await serialize();
    // A table copied with a note in a cell pastes back in this document with the note.
    const tableCopy = await page.evaluate(() => {
      const { view, NodeSelection } = window.htmlText;
      const { schema } = view.state;
      let figure = null,
        cellEnd = null;
      view.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "table_figure" &&
          node.attrs.id === "tab-regions"
        )
          figure = pos;
        if (
          figure !== null &&
          cellEnd === null &&
          node.type.name === "table_cell"
        )
          cellEnd = pos + node.nodeSize - 1;
      });
      view.dispatch(
        view.state.tr.insert(
          cellEnd,
          schema.nodes.footnote.create(null, schema.text("Cell note.")),
        ),
      );
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, figure),
        ),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    assert.equal(count(await serialize(), "Cell note."), 1, "the note is in");
    assert.match(tableCopy["text/html"], /data-tx-clip=/);
    await caret("Grow where");
    const ahead = await serialize();
    await paste(tableCopy);
    let out = check(await serialize());
    assert.equal(
      count(out, "Cell note."),
      2,
      "the pasted table keeps its note",
    );
    await undo();
    assert.equal(await serialize(), ahead);
    await undo();
    assert.equal(await serialize(), initial);

    // Typing just before this document's own paste, or one chart pasted after another, stays
    // when the paste is undone.
    const textCopy = await clip("copy");
    await caret("Planning team");
    await page.keyboard.type("Z");
    const afterTyping = await serialize();
    await paste(textCopy);
    await undo();
    assert.equal(await serialize(), afterTyping);
    await undo();
    assert.equal(await serialize(), initial);
    const chartCopy = await page.evaluate(() => {
      const { view, NodeSelection } = window.htmlText;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.type.name === "chart") at = pos;
      });
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    const charts = count(initial, '<figure class="chart"');
    await caret("Grow where");
    await paste(chartCopy);
    await caret("Grow where");
    await paste(chartCopy);
    assert.equal(
      count(check(await serialize()), '<figure class="chart"'),
      charts + 2,
    );
    await undo();
    assert.equal(count(await serialize(), '<figure class="chart"'), charts + 1);
    await undo();
    assert.equal(await serialize(), initial);

    // A paste that deletes a reference's target, or a copy whose target was deleted since,
    // brings no cross-reference without its target.
    // The target heading selected whole and replaced by the paste.
    await page.evaluate(() => {
      const { view, NodeSelection } = window.htmlText;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (
          at === null &&
          node.type.name === "heading" &&
          node.attrs.id === "sec-plan"
        )
          at = pos;
      });
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)),
      );
    });
    await paste({
      "text/html": '<p>See <a class="xref" href="#sec-plan">Section 3</a>.</p>',
    });
    out = check(await serialize());
    assert.doesNotMatch(out, /id="sec-plan"/);
    assert.match(out, /See Section 3\./);
    assert.ok(
      count(out, 'href="#sec-plan"') <= count(initial, 'href="#sec-plan"'),
    );
    await undo();
    assert.equal(await serialize(), initial);
    const refCopy = await page.evaluate(() => {
      const { view, TextSelection } = window.htmlText;
      let block = null;
      view.state.doc.descendants((node, pos) => {
        if (
          block === null &&
          node.isTextblock &&
          node.textContent.startsWith("The north region")
        )
          block = { pos, node };
      });
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            block.pos + 1,
            block.pos + block.node.nodeSize - 1,
          ),
        ),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      let figure = null;
      view.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "table_figure" &&
          node.attrs.id === "tab-regions"
        )
          figure = { pos, size: node.nodeSize };
      });
      view.dispatch(view.state.tr.delete(figure.pos, figure.pos + figure.size));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    const refs = count(await serialize(), 'href="#tab-regions"');
    await caret("Grow where");
    await paste(refCopy);
    out = await serialize();
    assert.equal(
      count(out, 'href="#tab-regions"'),
      refs,
      "no new dangling reference",
    );
    assert.equal(count(out, "The north region led growth"), 2);
    await undo();
    await undo();
    assert.equal(await serialize(), initial);

    // Plain text pasted inside commented text is not commented.
    await page.evaluate(() => {
      const { view, TextSelection } = window.htmlText;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text.startsWith("Revenue grew"))
          at = pos + "Revenue".length;
      });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
      );
      view.focus();
    });
    await page.keyboard.down("Shift");
    await paste({ "text/plain": "x\ny", "text/html": "<b>ignored</b>" });
    await page.keyboard.up("Shift");
    out = check(await serialize());
    assert.match(out, /data-ref="c1">Revenue<\/mark>x<\/p>/);
    assert.doesNotMatch(out, /data-ref="c1">y/);
    await undo();
    assert.equal(await serialize(), initial);
    pass(
      "a table copy keeps its notes; delegated pastes are undo steps; no reference without its target; plain text is not commented",
    );

    // ---- review fixes: tables in an empty paragraph, undo steps, text from a cell ----
    await caret("Northwind Gardens (fictional)");
    await page.keyboard.press("Enter");
    const empty = await saved();
    await paste({
      "text/html": "<table><tr><td>A</td><td>B</td></tr></table>",
    });
    assert.match(
      added(empty, check(await saved())),
      /^<figure class="table" id="tab-1">\n<table>\n<tbody>\n<tr><td>A<\/td><td>B<\/td><\/tr>/,
    );
    await undo();
    await page.keyboard.type("typed");
    const typed = await saved();
    await paste({ "text/plain": "pasted" });
    await paste({ "text/plain": "again" });
    await undo();
    await undo();
    assert.equal(await saved(), typed, "each paste is its own undo step");
    await undo();
    await undo();
    // Text selected inside one cell pastes as text.
    const inCell = await page.evaluate(() => {
      const { view } = window.htmlText;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text === "South") at = pos;
      });
      view.dispatch(
        view.state.tr.setSelection(
          window.htmlText.TextSelection.create(view.state.doc, at, at + 3),
        ),
      );
      const data = new DataTransfer();
      view.dom.dispatchEvent(clipboardEvent("copy", data));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    doc = await pasted(inCell, "Grow where");
    assert.match(doc, /Grow where the soil is already rich\.Sou<\/p>/);
    pass(
      "a table stays a table in an empty paragraph; one undo per paste; text from a cell is text",
    );

    // ---- drop ----
    await caret("ahead of plan");
    const dropBefore = await saved();
    await page.evaluate(() => {
      const { view } = window.htmlText;
      const target = [...view.dom.querySelectorAll("blockquote p")][0];
      const box = target.getBoundingClientRect();
      const data = transfer({ "text/html": "<p>Dropped <b>words</b></p>" });
      const event = new DragEvent("drop", {
        clientX: box.right - 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      });
      if (event.dataTransfer !== data)
        Object.defineProperty(event, "dataTransfer", { value: data });
      target.dispatchEvent(event);
    });
    assert.match(
      article(check(await saved())),
      /<blockquote>\n<p>Grow where the soil is already rich\.Dropped <strong>words<\/strong><\/p>/,
    );
    await undo();
    assert.equal(await saved(), dropBefore);
    pass("content dropped from outside lands where it is dropped");

    // ---- Markdown and Paste as plain text ----
    await caret("ahead of plan");
    const mdBefore = await saved();
    await page.evaluate(() => window.htmlText.commands.run("markdown"));
    await page.fill("textarea.tx-md", await fixture("report.md"));
    await page.click("dialog .sh-primary");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    doc = article(check(await saved()));
    assert.match(doc, /<h1 id="sec-garden-report">Garden report<\/h1>/);
    assert.match(doc, /<tr><td class="ta-l"><em>Herbs<\/em> \| spices<\/td>/);

    assert.match(
      await status(),
      /^Markdown inserted\. Left out: 1 image, 1 horizontal rule\. Adapted to the document's styles: /,
    );
    await undo();
    assert.equal(await saved(), mdBefore, "one undo removes the import");
    await caret("ahead of plan");
    await page.evaluate(() => window.htmlText.commands.run("markdown"));
    await page.fill("textarea.tx-md", "&notit; &copycat; &amp; &#x41; &copy;");
    await page.click("dialog .sh-primary");
    assert.match(
      article(check(await saved())),
      /Table 1<\/a>\.&amp;notit; &amp;copycat; &amp; A ©<\/p>/,
    );
    await undo();
    await page.evaluate(() => window.htmlText.commands.run("markdown"));
    await page.click("dialog .sh-primary");
    assert.match(
      await page.textContent("dialog .tx-md-err"),
      /nothing to insert/,
    );
    await page.keyboard.press("Escape");
    pass(
      "Insert › Markdown: CommonMark with tables, reported, undone in one step",
    );

    await caret("ahead of plan");
    await page.evaluate(() => {
      navigator.clipboard.readText = async () => "Plain one\nPlain two";
    });
    await page.evaluate(() => window.htmlText.commands.run("paste-plain"));
    await page.waitForFunction(() =>
      window.htmlText.serialize().includes("Plain two"),
    );
    assert.match(
      article(check(await saved())),
      /Plain one<\/p>\n<p>Plain two<\/p>/,
    );
    await undo();
    await page.evaluate(() => {
      navigator.clipboard.readText = async () => {
        throw new DOMException("denied", "NotAllowedError");
      };
    });
    await page.evaluate(() => window.htmlText.commands.run("paste-plain"));
    await page.waitForFunction(() =>
      /does not let the page read the clipboard/.test(
        document.querySelector(".tx-shell [role=status]").textContent,
      ),
    );
    pass(
      "Edit › Paste as plain text, and its message where the browser refuses",
    );

    assert.deepEqual(errors, []);
    // Nothing pasted loads anything. The chart copy draws its picture as a blob, and the pasted
    // chart is redrawn with T11's pinned, integrity-checked library.
    assert.deepEqual(
      requests.filter(
        (u) =>
          !u.startsWith("blob:") &&
          !u.startsWith("https://cdn.jsdelivr.net/npm/echarts@"),
      ),
      [],
    );
  } finally {
    await browser.close();
  }
}

for (const engine of ENGINES) await run(engine);
