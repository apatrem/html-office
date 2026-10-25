// ADR-013 X02a in the browser: Data → Data through each carrier (custom
// type, the text/html attribute, the semantic table), tables from Excel,
// Google Sheets, Word and Docs, hostile clipboards, and no network on paste.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const fixture = (name) =>
  readFile(
    new URL(`../../shared/clipboard/fixtures/${name}.html`, import.meta.url),
    "utf8",
  );
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
book.sheets[0].cells.C2 = {
  formula: "=$B2+B$3+$B$3",
  format: { kind: "number", digits: 2 },
};
book.sheets[0].cells.C3 = { formula: "=SUM(B2:B3)" };
book.sheets[0].links = { A2: { url: "https://example.com/participants" } };
const html = await buildWorkbook(book, { offline: true }),
  browser = await chromium.launch(),
  shortcut = process.platform === "darwin" ? "Meta" : "Control",
  MIME = "application/x-html-office+json";
// Resources referenced by pasted HTML would be fetched from here.
const hits = [],
  resources = createServer((req, res) => {
    hits.push(req.url);
    res.end("");
  }).listen(0);
await new Promise((done) => resources.on("listening", done));
const base = `http://127.0.0.1:${resources.address().port}`;

async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
async function saved(page, name) {
  const waiting = page.waitForEvent("download");
  await command(page, "Save a copy");
  const file = resolve(out, name);
  await (await waiting).saveAs(file);
  return readHTML(await readFile(file, "utf8")).book;
}
const statusText = (page, text) =>
  page.locator("#status").filter({ hasText: text }).waitFor();
// A paste event carrying exactly these flavours, as another page would.
function paste(page, flavours) {
  return page.evaluate((flavours) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(flavours))
      data.setData(type, value);
    document.querySelector("#grid").dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, flavours);
}
try {
  const context = await browser.newContext({
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    }),
    errors = [];
  const open = async (url) => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    return page;
  };
  const file = async (name) => {
    const path = resolve(out, name);
    await writeFile(path, html);
    return pathToFileURL(path).href;
  };
  const source = await open(await file("clip-html-source.html")),
    page = await open(await file("clip-html-target.html"));

  // Copy writes the envelope, a semantic table and plain values together.
  await source.bringToFront();
  await source.evaluate(() =>
    document.addEventListener("copy", (event) => {
      const data = event.clipboardData;
      globalThis.copied = Object.fromEntries(
        [...data.types].map((type) => [type, data.getData(type)]),
      );
    }),
  );
  await jump(source, "A2");
  for (const key of ["Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowDown"])
    await source.keyboard.press(key);
  await source.keyboard.press(shortcut + "+c");
  await statusText(source, "other applications receive a formatted table");
  const copied = await source.evaluate(() => globalThis.copied);
  assert.deepEqual(Object.keys(copied).sort(), [
    MIME,
    "text/html",
    "text/plain",
  ]);
  const envelope = JSON.parse(copied[MIME]);
  assert.equal(envelope.schema, "html-office-clip/1");
  assert.deepEqual(envelope.source, {
    product: "data",
    format: "html-data/0.2",
    locale: "en-US",
    stale: false,
  });
  assert.deepEqual(envelope.range.origin, { row: 2, column: 1 });
  assert.equal(envelope.table.rows[0][1].text, "100");
  assert.equal(
    copied["text/plain"],
    "Participants\t100\t150\nFee per participant\t25\t125",
  );
  const sent = copied["text/html"];
  assert.match(sent, /<table data-html-office="/);
  assert.match(
    sent,
    /x:num="25"[^>]*mso-number-format:'&quot;€&quot;#,##0.00'/,
  );
  assert.match(
    sent,
    /<a href="https:\/\/example.com\/participants">Participants<\/a>/,
  );
  // Charte colours become literal styles for Word and Excel.
  assert.match(sent, /background-color:rgb\(/);
  assert.doesNotMatch(sent, /var\(--/);

  // 1. The custom type, through the real clipboard, between two files.
  await page.bringToFront();
  await jump(page, "E5");
  await page.keyboard.press(shortcut + "+v");
  await statusText(page, "Calculated locally");
  let book2 = await saved(page, "clip-html-custom.html");
  let cells = book2.sheets[0].cells;
  assert.equal(cells.F5.input.value, 100);
  assert.equal(cells.G5.formula, "=$B5+F$3+$B$3");
  assert.deepEqual(book2.sheets[0].links.E5, {
    url: "https://example.com/participants",
  });

  // 2. No custom type (Safari across files, another browser): the envelope
  // comes from the text/html attribute and keeps formulas.
  await jump(page, "E10");
  await paste(page, { "text/html": sent, "text/plain": copied["text/plain"] });
  await statusText(page, "Calculated locally");
  cells = (await saved(page, "clip-html-attribute.html")).sheets[0].cells;
  assert.equal(cells.G10.formula, "=$B10+F$3+$B$3");
  assert.equal(cells.F11.cellStyle, "assumption");

  // 3. No attribute either: the semantic table pastes displayed values.
  await jump(page, "E15");
  await paste(page, {
    "text/html": sent.replace(/ data-html-office="[^"]*"/, ""),
    "text/plain": copied["text/plain"],
  });
  await statusText(page, "Calculated locally");
  cells = (await saved(page, "clip-html-semantic.html")).sheets[0].cells;
  assert.deepEqual(cells.F15.input, { type: "number", value: 100 });
  assert.deepEqual(cells.G15.input, { type: "number", value: 150 });
  assert.equal(cells.G15.formula, undefined);
  assert.deepEqual(cells.F16.input, { type: "text", value: "€25.00" });

  // 4. Excel: grouped numbers are ambiguous, so the paste dialog opens; the
  // table's emphasis and links survive the dialog.
  await jump(page, "A20");
  await paste(page, {
    "text/html": await fixture("excel-macos"),
    "text/plain": "ignored",
  });
  await page.getByRole("dialog").filter({ hasText: "Paste values" }).waitFor();
  assert.match(
    await page.locator("#paste-preview").textContent(),
    /Ambiguous value "1,235"/,
  );
  await page.getByLabel("Value typing").selectOption("en-US");
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await statusText(page, "1 merged cell was unmerged");
  book2 = await saved(page, "clip-html-excel.html");
  cells = book2.sheets[0].cells;
  assert.deepEqual(cells.B22.input, { type: "number", value: 1235 });
  assert.deepEqual(cells.C22.format, { kind: "percent", digits: 1 });
  assert.equal(cells.D22.input.type, "date");
  assert.equal(cells.E22.input.value, "0012");
  assert.deepEqual(cells.A21.style, { bold: true });
  assert.deepEqual(book2.sheets[0].links.A22, {
    url: "https://example.com/north",
  });

  // 5. Docs: unambiguous, pasted at once as one undoable step.
  await jump(page, "A30");
  await paste(page, { "text/html": await fixture("docs"), "text/plain": "x" });
  await statusText(page, "2 merged cells were unmerged");
  cells = (await saved(page, "clip-html-docs.html")).sheets[0].cells;
  assert.deepEqual(cells.B31.input, { type: "date", value: 46461 });
  assert.deepEqual(cells.C32.input, { type: "boolean", value: true });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await statusText(page, "Undo restored the previous workbook.");
  const before = await saved(page, "clip-html-before-hostile.html");
  assert.equal(before.sheets[0].cells.B31, undefined);

  // 6. Hostile clipboards leave the workbook unchanged.
  const valid = "<table><tr><td>1</td></tr></table>";
  for (const [flavours, message] of [
    [
      {
        [MIME]:
          '{"schema":"html-office-clip/1","kind":"table","table":{"rows":[[{"text":"x","__proto__":{}}]]}}',
        "text/html": valid,
        "text/plain": "1",
      },
      "unknown field __proto__",
    ],
    [
      {
        "text/html": `<table data-html-office="{&quot;schema&quot;:&quot;html-office-clip/1&quot;,&quot;kind&quot;:&quot;table&quot;}"><tr><td>1</td></tr></table>`,
        "text/plain": "1",
      },
      "a table needs a table or a range",
    ],
    [
      {
        [MIME]: JSON.stringify({
          ...envelope,
          range: {
            ...envelope.range,
            links: { "0,0": { url: "javascript:alert(1)" } },
          },
        }),
        "text/plain": "1",
      },
      "Links accept only https, http or mailto targets",
    ],
    [
      {
        [MIME]: JSON.stringify({
          schema: "html-office-clip/1",
          kind: "chart",
          chart: {},
        }),
      },
      "Charts cannot be pasted into Data yet",
    ],
    [
      {
        "text/html":
          '<table><tr><td colspan="1000" rowspan="65534">x</td></tr>' +
          "<tr><td>y</td></tr>".repeat(2100) +
          "</table>",
        "text/plain": "x",
      },
      "larger than 2,000,000 cells",
    ],
  ]) {
    await paste(page, flavours);
    await statusText(page, message);
    await statusText(page, "Workbook unchanged.");
  }
  assert.deepEqual(await saved(page, "clip-html-hostile.html"), before);

  // 7. A newer envelope version is skipped with a notice.
  await jump(page, "A40");
  await paste(page, {
    [MIME]: '{"schema":"html-office-clip/9"}',
    "text/html": "<table><tr><td>Kept</td><td>7</td></tr></table>",
  });
  await statusText(page, "unsupported format (html-office-clip/9)");
  cells = (await saved(page, "clip-html-newer.html")).sheets[0].cells;
  assert.deepEqual(cells.B40.input, { type: "number", value: 7 });

  // 7b. Data's custom type from before X02a still pastes, signed zero intact.
  await jump(page, "A50");
  await paste(page, {
    "application/x-html-office-range+json":
      '{"schema":"html-office-range/1","origin":{"row":1,"column":1},"cells":[[{"input":{"type":"number","value":-0}},{"formula":"=A1*2"}]]}',
  });
  await statusText(page, "Calculated locally");
  cells = (await saved(page, "clip-html-legacy.html")).sheets[0].cells;
  assert.ok(Object.is(cells.A50.input.value, -0));
  assert.equal(cells.B50.formula, "=A50*2");

  // 8. No script runs and nothing is fetched while pasting resource-bearing
  // HTML.
  await jump(page, "A45");
  await paste(page, {
    "text/html": `<table><tr><td>safe<img src="${base}/img.png" onerror="globalThis.ran=1"><img srcset="${base}/srcset.png 2x">
      <iframe src="${base}/frame"></iframe><link rel="stylesheet" href="${base}/css"><video poster="${base}/poster"></video>
      <object data="${base}/object"></object><style>@import "${base}/import";td{background:url(${base}/bg)}</style>
      <script>globalThis.ran = 2</script></td><td onmouseover="globalThis.ran=3">2</td></tr></table>`,
  });
  await statusText(page, "Calculated locally");
  await page.waitForTimeout(1000);
  assert.deepEqual(hits, []);
  assert.equal(await page.evaluate(() => globalThis.ran), undefined);
  cells = (await saved(page, "clip-html-resources.html")).sheets[0].cells;
  assert.deepEqual(cells.A45.input, { type: "text", value: "safe" });

  // 9. Two documents served from two localhost ports.
  const servers = [];
  for (let i = 0; i < 2; i++) {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(html);
    }).listen(0);
    await new Promise((done) => server.on("listening", done));
    servers.push(server);
  }
  const [left, right] = await Promise.all(
    servers.map((s) => open(`http://127.0.0.1:${s.address().port}/`)),
  );
  await left.bringToFront();
  await jump(left, "B2");
  await left.keyboard.press("Shift+ArrowRight");
  await left.keyboard.press(shortcut + "+c");
  await statusText(left, "Range copied");
  await right.bringToFront();
  await jump(right, "D7");
  await right.keyboard.press(shortcut + "+v");
  await statusText(right, "Calculated locally");
  cells = (await saved(right, "clip-html-ports.html")).sheets[0].cells;
  assert.equal(cells.E7.formula, "=$B7+D$3+$B$3");
  for (const server of servers) server.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS clipboard HTML: envelope through custom type and text/html, semantic fall-back, Excel/Docs tables, hostile clipboards, no network, two ports",
  );
} finally {
  await browser.close();
  resources.close();
}
