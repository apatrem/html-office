// T11 from file:// in Chromium, Firefox and WebKit. Saved previews show with no request; editing a
// chart loads the pinned ECharts with SRI (served locally here) and saves a new preview; a blocked
// or tampered library keeps the previews and says so; the offline build draws with no request,
// creating an ECharts instance only for charts that scroll into view; charts copy and paste as
// ADR-013 envelopes, a Slides chart's untrusted preview sanitised.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/charts-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import {
  buildEngine,
  buildDocument,
  embeddedECharts,
} from "../tools/build.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { ECHARTS_URL } from "../../shared/charts/echarts.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const repo = new URL("../../../", import.meta.url);
const out = resolve(new URL("dist/text-test/", repo).pathname);
await mkdir(out, { recursive: true });
const library = await readFile(
  new URL("node_modules/echarts/dist/echarts.min.js", repo),
);
const example = await readFile(
  new URL("../fixtures/valid/example.html", import.meta.url),
  "utf8",
);
const engine = await buildEngine();
const write = async (name, html) => {
  const path = join(out, name);
  await writeFile(path, html);
  return pathToFileURL(path).href;
};
const standard = await write(
  "charts.html",
  await buildDocument(example, engine),
);
// Many charts without a saved preview, far apart: only those in view are drawn.
const chart = (i) =>
  `<figure class="chart" id="fig-c${i}" data-type="column" data-width="text">\n<script type="application/json">{"title":"Chart ${i}","unit":"EUR","categories":["a","b"],"series":[{"name":"s","values":[${i},2]}]}</script>\n</figure>`;
const filler = Array.from(
  { length: 30 },
  (_, i) => `<p>Filler paragraph ${i} of a long document.</p>`,
).join("\n");
const long = example.replace(
  '<section class="comments">',
  () =>
    `${Array.from({ length: 8 }, (_, i) => `${filler}\n${chart(i)}`).join("\n")}\n<section class="comments">`,
);
const offline = await write(
  "charts-offline.html",
  await buildDocument(long, engine, { echarts: await embeddedECharts() }),
);

function check(text) {
  const report = validateFile(parseFile(text));
  assert.deepEqual(report.errors, []);
  const file = parseFile(text);
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return text.match(/<article[\s\S]*?<\/article>/)[0];
}
const figure = (article, id) =>
  article.match(
    new RegExp(`<figure class="chart" id="${id}"[\\s\\S]*?</figure>`),
  )[0];

async function run(name) {
  const pass = (what) => console.log(`PASS text charts [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  // library: "serve", "abort" or "tamper" for the CDN URL; every other request is recorded.
  async function open(url, library_ = "serve") {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const requests = [];
    await context.route("**/*", (route) => {
      const u = route.request().url();
      // Local URLs (the file, pictures drawn from blobs) are not requests to a server.
      if (/^(file|blob|data):/.test(u)) return route.continue();
      requests.push(u);
      if (u !== ECHARTS_URL) return route.abort();
      if (library_ === "abort") return route.abort();
      const body =
        library_ === "tamper"
          ? Buffer.concat([library, Buffer.from("\n// changed")])
          : library;
      return route.fulfill({
        body,
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    return { context, page, requests, errors, saved };
  }
  // Waits until a chart's saved figure has `text` and a preview drawn here (its data-key a hash).
  const drawnFor = (page, id, text = "") =>
    page.waitForFunction(
      ([i, t]) => {
        const html = window.htmlText.serialize();
        const article = html.slice(
          html.indexOf('<article id="doc"'),
          html.indexOf("</article>"),
        );
        const at = article.indexOf(`<figure class="chart" id="${i}"`);
        if (at < 0) return false;
        const fig = article.slice(at, article.indexOf("</figure>", at));
        // Drawn here: a key that is a hash, not "stale" or "pasted".
        return (
          fig.includes(t) &&
          /data-key="[0-9a-z]+"/.test(fig) &&
          !/data-key="(stale|pasted)"/.test(fig)
        );
      },
      [id, text],
    );
  // A click on the plot selects the figure.
  const selectChart = async (page, id) => {
    await page
      .locator(`#${id} .tx-plot`)
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.click(`#${id} .tx-plot`);
    await page.waitForFunction(
      (i) => window.htmlText.view.state.selection.node?.attrs.id === i,
      id,
    );
  };
  // A clipboard event in a new DataTransfer: a paste holds `data`, or what the last copy wrote,
  // read where the copy event ended. Returns the flavours written.
  const clip = (page, type, data) =>
    page.evaluate(
      ([t, d]) => {
        if (!window.clipListener) {
          window.clipListener = (e) =>
            (window.clipped = Object.fromEntries(
              [...e.clipboardData.types].map((k) => [
                k,
                e.clipboardData.getData(k),
              ]),
            ));
          window.addEventListener("copy", window.clipListener);
        }
        const transfer = new DataTransfer();
        if (t === "paste")
          for (const [k, v] of Object.entries(d ?? window.clipped ?? {}))
            transfer.setData(k, v);
        const event = new ClipboardEvent(t, {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        // Firefox's constructor ignores clipboardData: it is attached as an own property.
        if (event.clipboardData !== transfer)
          Object.defineProperty(event, "clipboardData", { value: transfer });
        window.htmlText.view.dom.dispatchEvent(event);
        return window.clipped ?? {};
      },
      [type, data],
    );
  try {
    // ---- saved previews show with no request; editing draws a new one ----
    {
      const { context, page, requests, errors, saved } = await open(standard);
      await page.waitForTimeout(500);
      assert.deepEqual(requests, [], "no request while previews are current");
      assert.equal(
        await page.textContent("#fig-revenue .tx-chart-title"),
        "Revenue by quarter",
      );
      assert.equal(
        await page.locator("#fig-revenue .tx-plot > svg").count(),
        1,
      );
      await page
        .locator("#fig-revenue .tx-plot")
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.dblclick("#fig-revenue .tx-plot");
      await page.waitForSelector("dialog.sh-dialog");
      await page.fill("dialog.sh-dialog input >> nth=1", "EUR m");
      await page.click("dialog.sh-dialog button:text-is('Apply')");
      await drawnFor(page, "fig-revenue", '"unit":"EUR m"');
      assert.deepEqual(requests, [ECHARTS_URL]);
      const article = check(await saved());
      const fig = figure(article, "fig-revenue");
      assert.match(fig, /<svg[^>]* class="render"/);
      // Renderer IDs, if any, are the chart's own.
      for (const [, id] of fig
        .slice(fig.indexOf("<svg"))
        .matchAll(/ id="([^"]+)"/g))
        assert.match(id, /^tx-fig-revenue-/);
      assert.doesNotMatch(fig, /zr\d/);
      // Undo brings the data back; the chart is drawn again for it.
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await page.waitForFunction(() => {
        const t = window.htmlText.serialize();
        return t.includes('"unit":"EUR million"');
      });
      check(await saved());
      pass(
        "previews show with no request; an edited chart loads the pinned library and saves a new preview; undo",
      );

      // ---- copy a chart and paste it: a new figure with its caption and width ----
      await selectChart(page, "fig-revenue");
      const copied = await clip(page, "copy");
      const env = JSON.parse(copied["application/x-html-office+json"]);
      assert.equal(env.kind, "chart");
      assert.equal(env.source.product, "text");
      assert.equal(env.chart.caption, "Revenue by quarter, 2026");
      assert.match(copied["text/html"], /data-html-office=/);
      assert.match(copied["text/plain"], /^Revenue by quarter\n/);
      await page.evaluate(() => {
        const { view } = window.htmlText;
        view.dispatch(
          view.state.tr.setSelection(
            view.state.selection.constructor.atEnd(view.state.doc),
          ),
        );
      });
      await clip(page, "paste");
      const pasted = check(await saved());
      assert.match(
        pasted,
        /<figure class="chart" id="fig-revenue-by-quarter" data-type="column" data-width="text">[^]*?<figcaption>Revenue by quarter, 2026<\/figcaption>/,
      );
      pass("a chart copies as an ADR-013 envelope and pastes as a new figure");
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ---- a blocked library keeps the previews; a Slides chart's preview is sanitised ----
    {
      const { context, page, errors, saved } = await open(standard, "abort");
      const slides = {
        schema: "html-office-clip/1",
        kind: "chart",
        source: { product: "slides", format: "1" },
        chart: {
          type: "hbar",
          data: {
            title: "From Slides",
            unit: "%",
            categories: ["x", "y"],
            series: [{ name: "s", values: [1, 2] }],
          },
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><defs><clipPath id="zr0-c0"><rect width="200" height="100"/></clipPath></defs><g clip-path="url(#zr0-c0)"><rect width="50" height="20" fill="#14517a" onclick="alert(1)"/></g><script>alert(1)</script><image href="https://example.org/x.png"/></svg>',
        },
      };
      await page.evaluate(() => {
        const { view } = window.htmlText;
        view.dispatch(
          view.state.tr.setSelection(
            view.state.selection.constructor.atStart(view.state.doc),
          ),
        );
      });
      await clip(page, "paste", {
        "application/x-html-office+json": JSON.stringify(slides),
        "text/plain": "From Slides",
      });
      await page.waitForFunction(() =>
        /unavailable/.test(
          document.querySelector("#fig-from-slides .tx-chart-state")
            ?.textContent ?? "",
        ),
      );
      const article = check(await saved());
      const fig = figure(article, "fig-from-slides");
      assert.match(fig, /data-key="pasted"/);
      assert.doesNotMatch(
        fig.slice(fig.indexOf("<svg")),
        /script|onclick|<image|zr0-c0|https:/,
      );
      assert.match(fig, /clip-path="url\(#tx-p[a-z0-9]+-0\)"/);
      assert.equal(
        await page.locator("#fig-revenue .tx-plot > svg").count(),
        1,
        "the other previews stay",
      );
      pass(
        "a blocked library keeps every preview and says so; a pasted Slides preview is sanitised",
      );
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ---- a tampered library fails its integrity check ----
    {
      const { context, page, errors } = await open(standard, "tamper");
      await page.dblclick("#fig-revenue .tx-plot");
      await page.waitForSelector("dialog.sh-dialog");
      await page.fill("dialog.sh-dialog input >> nth=1", "EUR k");
      await page.click("dialog.sh-dialog button:text-is('Apply')");
      await page.waitForFunction(() =>
        /integrity/.test(
          document.querySelector("#fig-revenue .tx-chart-state").textContent,
        ),
      );
      assert.equal(
        await page.evaluate(() => typeof window.echarts?.init),
        "undefined",
        "the tampered code never ran",
      );
      pass(
        "a tampered library fails its integrity check and keeps the preview",
      );
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ---- offline: no request; instances only for charts in view ----
    {
      const { context, page, requests, errors, saved } = await open(offline);
      const drawn = async () =>
        (
          (await saved()).match(
            /<figure class="chart" id="fig-c\d"[^]*?<\/figure>/g,
          ) ?? []
        ).filter((f) => f.includes("data-key")).length;
      assert.equal(await drawn(), 0, "nothing in view yet");
      for (let i = 0; i < 8; i++) {
        await page
          .locator(`#fig-c${i} .tx-plot`)
          .evaluate((el) => el.scrollIntoView({ block: "center" }));
        await drawnFor(page, `fig-c${i}`);
        if (i === 2)
          assert.ok(
            (await page.locator(".tx-chart-draw").count()) <= 4,
            "instances only for the charts that came into view",
          );
      }
      assert.equal(await drawn(), 8);
      check(await saved());
      assert.deepEqual(requests, [], "the offline build makes no request");
      pass("offline: no request; charts are drawn when they scroll into view");
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
