// T10 from file:// in Chromium, Firefox and WebKit: insert a table, type and move with Tab, select
// cells with the pointer, merge and split, rows and columns, header and total rows, widths,
// caption, and tables through the clipboard (a cell selection copies as the envelope; a pasted
// table fills the grid). Each saved result is valid and canonical, and undo restores it.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/tables-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
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
const path = join(out, "tables.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

function check(text) {
  const file = parseFile(text);
  const report = validateFile(file);
  assert.deepEqual(report.errors, []);
  assert.equal(report.protected.length, 0, "no protected block");
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return text;
}
// The figure with this ID, as saved.
const figure = (text, id) => {
  const at = text.indexOf(`<figure class="table" id="${id}">`);
  assert.ok(at >= 0, id);
  return text.slice(at, text.indexOf("</figure>", at) + 9);
};

const init = () => {
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
  const pass = (name) => console.log(`PASS text tables [${engine}]: ${name}`);
  const browser = await playwright[engine].launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.addInitScript(init);
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    const cmd = (id) =>
      page.evaluate((id) => window.htmlText.commands.run(id), id);
    const enabled = (id) =>
      page.evaluate((id) => window.htmlText.commands.enabled(id), id);
    // The cell (td or th) whose text is `text`, in the table with this ID.
    const cell = (id, text) =>
      page
        .locator(`#doc figure#${id} :is(td, th)`, { hasText: text })
        .filter({ hasText: new RegExp(`^${text}$`) })
        .first();
    // The caret at the end of the cell whose text is `text`, in the table with this ID.
    const caretIn = (id, text) =>
      page.evaluate(
        ([id, text]) => {
          const { view, TextSelection } = window.htmlText;
          let at = null,
            inside = false;
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === "table_figure")
              inside = node.attrs.id === id;
            if (
              inside &&
              at === null &&
              node.type.spec.tableRole?.includes("cell") &&
              node.textContent === text
            )
              at = pos + node.nodeSize - 1;
          });
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, at),
            ),
          );
          view.focus();
        },
        [id, text],
      );

    // ---- insert, type, Tab ----
    await page.locator("#doc p", { hasText: "Grow where" }).first().click();
    await page.click(".tx-shell [role=menubar] button:text-is('Insert')");
    await page.click("[role=menu] [role^=menuitem]:has-text('Table')");
    await page.keyboard.type("Site");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Beds");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("North");
    await page.keyboard.press("Tab");
    await page.keyboard.type("24");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("Share");
    let text = check(await saved());
    assert.equal(
      figure(text, "tab-1"),
      `<figure class="table" id="tab-1">
<table>
<thead>
<tr><th>Site</th><th>Beds</th><th>Share</th></tr>
</thead>
<tbody>
<tr><td>North</td><td>24</td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
</tbody>
</table>
</figure>`,
    );
    // Tab in the last cell adds a row.
    // The caret in the last cell (empty), then Tab.
    await page.evaluate(() => {
      const { view, TextSelection } = window.htmlText;
      let last = null;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "table_figure" && node.attrs.id === "tab-1")
          last = pos + node.nodeSize - 4;
      });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, last)),
      );
      view.focus();
    });
    await page.keyboard.press("Tab");
    await page.keyboard.type("x");
    assert.match(
      figure(check(await saved()), "tab-1"),
      /<tr><td>x<\/td><td><\/td><td><\/td><\/tr>\n<\/tbody>/,
    );
    // Enter never splits a cell into paragraphs.
    await page.keyboard.press("Enter");
    assert.match(figure(await saved(), "tab-1"), /<td>x<\/td>/);
    pass("Insert › Table, typing, Tab and Shift+Tab, Tab adds a row");

    // ---- pointer cell selection, merge, split ----
    const drag = async (id, from, to) => {
      await caretIn(id, from);
      await page
        .locator(`#doc figure#${id}`)
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      const a = await cell(id, from).boundingBox();
      const b = await cell(id, to).boundingBox();
      await page.mouse.move(a.x + 5, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 5, b.y + b.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(
        ([from, to]) => {
          const s = window.htmlText.view.state.selection;
          return (
            s instanceof window.htmlText.CellSelection &&
            s.$anchorCell.nodeAfter.textContent === from &&
            s.$headCell.nodeAfter.textContent === to
          );
        },
        [from, to],
      );
    };
    await caretIn("tab-regions", "North");
    const before = await saved();
    await drag("tab-regions", "North", "1.4");
    assert.equal(
      await page.locator("#doc figure#tab-regions .selectedCell").count(),
      6,
    );
    assert.ok(await enabled("merge-cells"));
    await cmd("merge-cells");
    text = check(await saved());
    assert.match(
      figure(text, "tab-regions"),
      /<tr><td colspan="3" rowspan="2">North<br>1\.6<br>1\.9<br>South<br>1\.2<br>1\.4<\/td><\/tr>\n<tr><\/tr>/,
    );
    await cmd("split-cell");
    check(await saved());
    await cmd("undo");
    await cmd("undo");
    assert.equal(await saved(), before);
    // Across the header's boundary: unavailable.
    await drag("tab-regions", "2025", "1.6");
    assert.equal(await enabled("merge-cells"), false);
    pass(
      "pointer cell selection; merge joins lines; split; undo; no merge across the header",
    );

    // ---- rows, columns, styles from the Table menu ----
    await caretIn("tab-regions", "South");
    for (const id of ["row-below", "column-right"]) await cmd(id);
    text = figure(check(await saved()), "tab-regions");
    assert.match(
      text,
      /<colgroup><col data-width="40"><col><col class="emphasis" data-width="30"><col data-width="30"><\/colgroup>/,
    );
    assert.match(
      text,
      /<tr><td>South<\/td><td><\/td><td class="ta-r">1\.2<\/td><td class="ta-r">1\.4<\/td><\/tr>\n<tr><td><\/td><td><\/td><td><\/td><td><\/td><\/tr>/,
    );
    await cmd("undo");
    await cmd("undo");
    await caretIn("tab-regions", "West");
    await cmd("total-rows");
    await cmd("row-headers");
    await cmd("compact");
    await page.evaluate(() => window.htmlText.commands.run("column-width"));
    await page.fill("dialog input[type=number]", "55");
    await page.click("dialog .sh-primary");
    text = figure(check(await saved()), "tab-regions");
    assert.match(
      text,
      /<table class="compact">\n<colgroup><col data-width="55">/,
    );
    assert.match(text, /<tr class="total"><th>West<\/th>/);
    await caretIn("tab-regions", "1.6");
    await cmd("header-rows");
    assert.match(
      figure(check(await saved()), "tab-regions"),
      /<tr><th>North<\/th><th class="ta-r">1\.6<\/th><th class="ta-r">1\.9<\/th><\/tr>\n<\/thead>/,
    );
    await cmd("caption");
    assert.doesNotMatch(figure(await saved(), "tab-regions"), /figcaption/);
    await cmd("caption");
    await page.keyboard.type("Regions");
    assert.match(
      figure(check(await saved()), "tab-regions"),
      /^<figure class="table" id="tab-regions">\n<figcaption>Regions<\/figcaption>/,
    );
    for (let i = 0; i < 9; i++) await cmd("undo");
    await caretIn("tab-regions", "West");
    await cmd("delete-table");
    assert.doesNotMatch(check(await saved()), /id="tab-regions"/);
    await cmd("undo");
    pass(
      "rows, columns, total rows, row headers, density, width, header rows, caption, delete",
    );

    // ---- clipboard ----
    await drag("tab-regions", "1.6", "1.4");
    const flavours = await page.evaluate(() => {
      const data = new DataTransfer();
      window.htmlText.view.dom.dispatchEvent(clipboardEvent("copy", data));
      return Object.fromEntries(
        [...data.types].map((t) => [t, data.getData(t)]),
      );
    });
    const sent = JSON.parse(flavours["application/x-html-office+json"]);
    assert.deepEqual(sent.table.rows, [
      [
        { text: "1.6", align: "right" },
        { text: "1.9", align: "right" },
      ],
      [
        { text: "1.2", align: "right" },
        { text: "1.4", align: "right" },
      ],
    ]);
    assert.equal(flavours["text/plain"], "1.6\t1.9\n1.2\t1.4");
    // Pasted on the West row's second cell: fills the cells and adds a row.
    await caretIn("tab-regions", "0.8");
    const beforePaste = await saved();
    await page.evaluate((flavours) => {
      const data = new DataTransfer();
      for (const [t, v] of Object.entries(flavours)) data.setData(t, v);
      window.htmlText.view.dom.dispatchEvent(clipboardEvent("paste", data));
    }, flavours);
    text = figure(check(await saved()), "tab-regions");
    assert.match(
      text,
      /<tr><td>West<\/td><td class="ta-r">1\.6<\/td><td class="ta-r">1\.9<\/td><\/tr>\n<tr class="total"><td>Total<\/td><td class="ta-r">1\.2<\/td><td class="ta-r">1\.4<\/td><\/tr>/,
    );
    await cmd("undo");
    assert.equal(await saved(), beforePaste);
    // An Excel table pasted in the last row grows the table.
    await caretIn("tab-regions", "4.2");
    await page.evaluate((html) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      window.htmlText.view.dom.dispatchEvent(clipboardEvent("paste", data));
    }, "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>");
    text = figure(check(await saved()), "tab-regions");
    assert.match(
      text,
      /<colgroup><col data-width="40"><col class="emphasis" data-width="30"><col data-width="30"><col><\/colgroup>/,
    );
    assert.match(
      text,
      /<td class="ta-r">3\.6<\/td><td>a<\/td><td>b<\/td><\/tr>\n<tr><td><\/td><td><\/td><td>c<\/td><td>d<\/td><\/tr>/,
    );
    await cmd("undo");
    // Text on a cell selection fills each selected cell.
    await drag("tab-regions", "1.6", "1.4");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "n/a");
      window.htmlText.view.dom.dispatchEvent(clipboardEvent("paste", data));
    });
    text = figure(check(await saved()), "tab-regions");
    assert.equal((text.match(/>n\/a</g) ?? []).length, 4);
    await cmd("undo");
    pass(
      "a cell selection copies as the envelope; pasted tables fill and grow the grid",
    );

    // ---- delete a rectangle across merged cells ----
    await drag("tab-regions", "Region", "2026");
    await page.keyboard.press("Backspace");
    text = figure(check(await saved()), "tab-regions");
    assert.match(
      text,
      /<tr><th rowspan="2"><\/th><th colspan="2"><\/th><\/tr>\n<tr><th class="ta-r"><\/th><th class="ta-r"><\/th><\/tr>/,
    );
    await cmd("undo");
    pass("a cell selection across merged cells empties them");

    // ---- Shift+arrow from a cell's text; text pasted on merged cells ----
    await caretIn("tab-regions", "1.6");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(
      await page.evaluate(() => {
        const { view, CellSelection } = window.htmlText;
        const sel = view.state.selection;
        return sel instanceof CellSelection
          ? [
              sel.$anchorCell.nodeAfter.textContent,
              sel.$headCell.nodeAfter.textContent,
            ].join(",")
          : sel.constructor.name;
      }),
      "1.6,1.9",
    );
    await drag("tab-regions", "1.6", "1.2");
    await cmd("merge-cells");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "X");
      window.htmlText.view.dom.dispatchEvent(clipboardEvent("paste", data));
    });
    assert.match(
      figure(check(await saved()), "tab-regions"),
      /<td class="ta-r" rowspan="2">X<\/td>/,
    );
    await cmd("undo");
    await cmd("undo");
    pass("Shift+arrow selects cells; text pasted on a merged cell keeps it");

    // ---- numbering (T08): a caption added to a table numbers it among the tables ----
    const labels = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#doc figure.table > figcaption")].map(
          (f) => [f.parentElement.id, f.dataset.txLabel],
        ),
      );
    const labelled = await labels();
    assert.ok(!labelled.some(([id]) => id === "tab-1"));
    await caretIn("tab-1", "Site");
    await cmd("caption");
    await page.keyboard.type("Sites");
    const after = await labels();
    assert.ok(after.some(([id]) => id === "tab-1"));
    assert.deepEqual(
      after.map(([, label]) => label),
      after.map((_, i) => `Table ${i + 1}`),
    );
    check(await saved());
    await cmd("undo");
    await cmd("undo");
    assert.deepEqual(await labels(), labelled);
    pass("a caption added to a table numbers it, and the others follow");

    // ---- print ----
    await page.emulateMedia({ media: "print" });
    const shown = await page.evaluate(() => {
      const t = document.querySelector("#doc figure#tab-regions table");
      const head = t.querySelector("tr.tx-head th");
      return {
        width: t.getBoundingClientRect().width,
        head: getComputedStyle(head).fontWeight,
        selected: document.querySelectorAll(".selectedCell").length,
      };
    });
    assert.ok(shown.width > 300);
    await page.emulateMedia({ media: "screen" });
    pass("tables render in print");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const engine of ENGINES) await run(engine);
