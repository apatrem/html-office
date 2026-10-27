// ADR-013 X02c in browsers: Slides charts through the shared clipboard, and charts to other
// applications. Two decks in two tabs: every chart type copied and pasted with identical JSON
// (labels such as "true" and "0012", Gantt highlight), one undo step, save, reopen and check; each
// carrier alone; the picture (title and unit above the plot, 2×) and the async upgrade to image/png
// (granted, not granted, refused, pasted before it resolves, two copies in quick succession);
// offline pastes shown from the sanitised preview with ids of their own; hostile charts and SVG
// (refused or neutralised, no request, no script).
// Chromium runs every case with the real clipboard. CLIPBOARD_ENGINES=chromium,firefox,webkit adds
// Firefox and WebKit: real copy, dispatched paste of the copied flavours, offline previews and
// hostile cases; the async clipboard cases stay in Chromium, where permissions can be granted.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { ASSETS, upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';
import { MIME, SCHEMA } from '../packages/shared/clipboard/index.mjs';
import { strictValidate } from '../packages/shared/charts/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'work/slides-charts-clipboard');
fs.rmSync(DIR, { recursive: true, force: true });
for (const d of ['a', 'b']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

// One slide per chart type, with labels that a careless reader would retype.
const CHARTS = {
  column: { title: 'Hours by task', unit: 'hours', categories: ['true', '0012', '2026'], series: [{ name: 'Week 1', values: [12, null, 3.5] }, { name: 'Week 2', values: [8, 2, 4] }], highlight: 1 },
  hbar: { title: 'Plots', unit: 'beds', categories: ['North', 'South'], series: [{ name: 'Beds', values: [4, 6] }], decimals: 1, suffix: ' beds' },
  stacked: { title: 'Share', unit: '%', categories: ['2025', '2026'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }], percent: true },
  line: { title: 'Trend', unit: 'visits', categories: ['T1', 'T2', 'T3'], series: [{ name: 'Visits', values: [3, 5, 4] }], labels: 'all' },
  waterfall: { title: 'Bridge', unit: 'hours', items: [{ label: 'Start', value: 10, total: true }, { label: 'false', value: -2 }, { label: 'End', total: true }] },
  bubble: { title: 'Effort', unit: 'size: people', xLabel: 'Cost', yLabel: 'Value', points: [{ name: '0012', x: 1, y: 2, size: 3 }, { name: 'B', x: 2, y: 1, size: 1 }] },
  gantt: { title: 'Plan', tasks: [{ name: 'Dig', start: '2026-11', end: '2027-01', group: 'Phase 1', highlight: true }, { name: 'Sow', start: '2027-02' }] }
};
for (const [type, data] of Object.entries(CHARTS)) { const e = strictValidate(type, data); if (e.length) throw new Error(`${type} fixture: ${e}`); }
const slides = Object.entries(CHARTS).map(([type, data], i) =>
  `<section class="slide" id="s${90 + i}" data-layout="default"><h1>${type}</h1><figure class="chart w-8" data-type="${type}"><script type="application/json">${JSON.stringify(data)}</script></figure><p class="source">Source: fictional</p></section>`).join('');
const example = upgrade(fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'));
const A = path.join(DIR, 'a/deck.html'), B = path.join(DIR, 'b/deck.html');
fs.writeFileSync(A, example.replace('</main>', slides + '</main>'));
fs.writeFileSync(B, example);
const SLIDE = { column: 's90', hbar: 's91', stacked: 's92', line: 's93', waterfall: 's94', bubble: 's95', gantt: 's96' };

const listen = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));
let hits = [];
const counter = createServer((req, res) => { hits.push(req.url); res.end(''); });
const resources = await listen(counter);

const initScript = () => {
  globalThis.clipEvent = (type, data) => {
    const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    return event;
  };
  addEventListener('copy', e => { globalThis.copied = Object.fromEntries([...e.clipboardData.types].map(t => [t, e.clipboardData.getData(t)])); });
};
async function context(browser, { offline = false, grant = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (grant) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(initScript);
  if (init) await ctx.addInitScript(init);
  await ctx.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => offline ? r.abort() : r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  return ctx;
}
async function open(ctx, file) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  await page.keyboard.press('e');
  page.errors = errors;
  return page;
}
const banner = page => page.evaluate(() => document.querySelector('.hs-banner')?.textContent || '');
const mainHTML = page => page.evaluate(() => window.deckEngine.serialize().match(/<main[\s\S]*<\/main>/)[0]);
const charts = (page, slide) => page.evaluate(s => [...document.querySelectorAll(`#${s} > figure.chart`)].map(f => ({
  type: f.dataset.type, json: f.querySelector(':scope > script').textContent, live: f.classList.contains('live'),
  preview: !!f.querySelector(':scope > .hs-chart-preview') })), slide);
const last = async (page, slide) => (await charts(page, slide)).pop();
async function select(page, sel) {
  await page.bringToFront();
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.locator(sel).click({ position: { x: 120, y: 12 } });
}
let lastCopy = null, realPaste = false;
async function copy(page, type, { wait = 600 } = {}) {
  await select(page, `#${SLIDE[type]} > figure.chart`);
  await page.waitForTimeout(wait); // the picture is drawn on selection
  await page.evaluate(() => { globalThis.copied = null; document.querySelector('.hs-banner')?.remove(); });
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForFunction(() => globalThis.copied);
  return lastCopy = await page.evaluate(() => globalThis.copied);
}
const dispatchPaste = (page, flavours) => page.evaluate(f => {
  const data = new DataTransfer();
  for (const [t, v] of Object.entries(f)) data.setData(t, v);
  (document.activeElement || document.body).dispatchEvent(clipEvent('paste', data));
}, flavours);
async function paste(page, slide, flavours = 'keyboard') {
  await page.bringToFront();
  await page.locator(`#${slide}`).scrollIntoViewIfNeeded();
  await page.locator(`#${slide}`).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.hs-banner')?.remove());
  if (flavours === 'keyboard' && !realPaste) flavours = lastCopy;
  if (flavours === 'keyboard') await page.keyboard.press('ControlOrMeta+v');
  else await dispatchPaste(page, flavours);
  await page.waitForFunction(() => document.querySelector('.hs-banner'));
  return banner(page);
}
// The PNG on the async clipboard, as rows of "is there ink" per band.
const clipboardPicture = page => page.evaluate(async () => {
  const items = await navigator.clipboard.read(), item = items.find(i => i.types.includes('image/png'));
  if (!item) return { types: items.flatMap(i => i.types) };
  const bmp = await createImageBitmap(await item.getType('image/png'));
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  const ink = (y0, y1) => { const d = x.getImageData(0, y0, bmp.width, y1 - y0).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) n++; return n; };
  const html = items.find(i => i.types.includes('text/html'));
  return { types: items.flatMap(i => i.types), width: bmp.width, height: bmp.height, title: ink(0, 56), unit: ink(66, 112),
    html: html ? await (await html.getType('text/html')).text() : '' };
});

const engines = { chromium, firefox, webkit };
for (const name of (process.env.CLIPBOARD_ENGINES ?? 'chromium').split(',')) {
  const full = name === 'chromium';
  realPaste = full;
  const browser = await engines[name].launch();
  console.log(`\n# ${name} ${browser.version()}`);
  try {
    const ctx = await context(browser, { grant: full });
    const a = await open(ctx, A), b = await open(ctx, B);
    // 1. Every chart type, keyboard copy and paste: identical JSON, drawn with this deck's charte.
    for (const type of Object.keys(CHARTS)) {
      const flavours = await copy(a, type);
      const envelope = JSON.parse(flavours[MIME]);
      ok(envelope.schema === SCHEMA && envelope.kind === 'chart' && envelope.chart.type === type && /^<svg/.test(envelope.chart.svg) &&
        envelope.table.headerRows === 1 && /data-html-office="/.test(flavours['text/html']) && flavours['text/plain'].startsWith(CHARTS[type].title + '\n'),
        `${type}: the envelope (JSON, preview, data table), the figure and TSV are written`);
      const html0 = await mainHTML(b);
      const said = await paste(b, 's05');
      const got = await last(b, 's05');
      ok(said.startsWith('Chart pasted') && got?.type === type && got.json === JSON.stringify(CHARTS[type]) && got.live,
        `${type}: pasted with identical JSON and drawn (${said})` + (got?.json === JSON.stringify(CHARTS[type]) ? '' : '\n      ' + got?.json));
      await b.keyboard.press('ControlOrMeta+z');
      ok(await mainHTML(b) === html0, `${type}: one undo removes the paste`);
    }
    const column = await copy(a, 'column');
    ok(/<img alt="Hours by task" src="data:image\/png;base64,/.test(column['text/html']), 'the picture drawn on selection is in the copy event\'s text/html');
    // 2. Each carrier alone.
    await paste(b, 's05', { 'text/html': column['text/html'], 'text/plain': column['text/plain'] });
    ok((await last(b, 's05'))?.json === JSON.stringify(CHARTS.column), 'without the custom type, the chart comes from text/html');
    await b.keyboard.press('ControlOrMeta+z');
    const html0 = await mainHTML(b);
    await paste(b, 's05', { 'text/html': column['text/html'].replace(/ data-html-office="[^"]*"/, ''), 'text/plain': column['text/plain'] });
    const asTable = await b.evaluate(() => [...[...document.querySelectorAll('#s05 > table')].pop().rows].map(r => [...r.cells].map(c => c.textContent)));
    ok(JSON.stringify(asTable.slice(0, 3)) === '[["Hours by task","",""],["Category","Week 1","Week 2"],["true","12","8"]]',
      'without the attribute, the figure is not a table: text/plain gives the title and the data as a table ' + JSON.stringify(asTable.slice(0, 3)));
    await b.keyboard.press('ControlOrMeta+z');
    ok(await mainHTML(b) === html0, 'undone');

    // 3. Hostile charts: refused, deck unchanged.
    const envelope = chart => JSON.stringify({ schema: SCHEMA, kind: 'chart', chart });
    const refused = [
      ['an invalid chart (no categories)', { type: 'column', data: { series: [] } }],
      ['an unknown chart field', { type: 'column', data: { ...CHARTS.column, onclick: 'x' } }],
      ['a wrongly typed title', { type: 'column', data: { ...CHARTS.column, title: 42 } }],
      ['__proto__ in chart data', JSON.parse(`{"type":"column","data":{"categories":["a"],"series":[{"name":"s","values":[1]}],"__proto__":{"x":1}}}`)],
      ['an unknown type', { type: 'pie', data: {} }],
      ['chart JSON over 1 Mi', { type: 'column', data: { ...CHARTS.column, title: 'x'.repeat(2 ** 20) } }],
      ['more than 10,000 points', { type: 'line', data: { categories: Array.from({ length: 10001 }, (_, i) => 'c' + i), series: [{ name: 's', values: Array.from({ length: 10001 }, () => 1) }] } }]];
    const unchanged = await mainHTML(b);
    for (const [what, chart] of refused) {
      const msg = await paste(b, 's05', { [MIME]: envelope(chart), 'text/html': '<table><tr><td>valid</td></tr></table>', 'text/plain': 'x' });
      ok(/^Paste failed/.test(msg) && await mainHTML(b) === unchanged, `refused, deck unchanged: ${what} ("${msg.slice(0, 110)}")`);
    }
    ok(!a.errors.length && !b.errors.length, `no JavaScript error (${[...a.errors, ...b.errors]})`);

    // 4. Offline: the sanitised preview, with ids of its own, then hostile SVG.
    const off = await context(browser, { offline: true });
    const c = await open(off, B);
    const line = await copy(a, 'line'); // clipped series: ids and url(#…) references
    await paste(c, 's05', line);
    const said = await paste(c, 's05', line);
    const previews = await c.evaluate(() => [...document.querySelectorAll('#s05 > figure.chart')].slice(-2).map(f => {
      const s = f.querySelector(':scope > svg.render'), ids = [...s.querySelectorAll('[id]')].map(n => n.id);
      const refs = [...s.querySelectorAll('[clip-path]')].map(n => n.getAttribute('clip-path').slice(5, -1));
      return { ids, resolved: refs.length > 0 && refs.every(r => ids.includes(r)), badge: !!f.querySelector('.hs-chart-preview'), texts: s.querySelectorAll('text[font-size]').length };
    }));
    ok(/Shown as a preview/.test(said) && previews.length === 2 && previews.every(p => p.badge && p.resolved && p.texts > 0) &&
      !previews[0].ids.some(id => previews[1].ids.includes(id)), `two offline pastes: distinct ids, working references, font sizes kept, marked as previews (${JSON.stringify(previews)})`);
    const style = 'font-size:12px;font-family:Arial;font:bold 13px Georgia';
    const hostileSVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" onload="globalThis.ran=1">` +
      `<script>globalThis.ran=2</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x<img src="${resources}/fo.png"></div></foreignObject>` +
      `<image href="${resources}/image.png" width="10" height="10"/><use href="${resources}/use.svg#a"/><a href="javascript:globalThis.ran=3"><text>link</text></a>` +
      `<style>@import "${resources}/import.css"; text{fill:url(${resources}/fill)}</style>` +
      `<defs><clipPath id="k"><rect width="10" height="10"/></clipPath></defs>` +
      `<g clip-path="url(#k)" fill="url(${resources}/g)" stroke="url(#missing)" onclick="globalThis.ran=4">` +
      `<rect width="5" height="5" fill="url(#k)" style="fill:url(${resources}/s)"/><path d="M0 0L5 5" stroke="#123456" filter="url(${resources}/f)"/>` +
      `<text style="font-size:12px;font-family:x;background:url(${resources}/t)" x="1">a</text>` +
      `<text style="font-size:expression(alert(1));font-family:a\\62 c" x="2">b</text>` +
      `<text style="font-family:${'A'.repeat(500)};font-weight:bold;fill:#abc" x="3">c</text>` +
      `<text style="${style}" x="4">d</text><text style="font-size:9999px;font-family:url(x)" x="5">e</text></g></svg>`;
    hits = [];
    const hostileMsg = await paste(c, 's05', { [MIME]: envelope({ type: 'column', data: CHARTS.column, svg: hostileSVG }) });
    await c.waitForTimeout(800);
    const cleaned = await c.evaluate(() => { const s = [...document.querySelectorAll('#s05 > figure.chart')].pop().querySelector(':scope > svg.render'); return s.outerHTML; });
    const elements = [...cleaned.matchAll(/<([a-zA-Z]+)/g)].map(m => m[1]);
    ok(hostileMsg.startsWith('Chart pasted') && elements.every(e => ['svg', 'defs', 'clipPath', 'rect', 'g', 'path', 'text'].includes(e)) &&
      !/script|foreignObject|image|<use|<a |href|onload|onclick|style|@import|url\(http|expression|filter|\\\\/.test(cleaned),
      `hostile SVG rebuilt from the allow-list only\n      ${cleaned}`);
    ok(/clip-path="url\(#p[\w-]*k\)"/.test(cleaned) && !/stroke="url/.test(cleaned) && /<rect width="5" height="5" fill="url\(#p[\w-]*k\)">/.test(cleaned),
      'references to ids of the pasted SVG are rewritten, others removed');
    ok(cleaned.includes('<text x="1" font-size="12px" font-family="x">a</text>') && cleaned.includes('<text x="2">b</text>') &&
      cleaned.includes('<text x="3" font-weight="bold" fill="#abc">c</text>') && cleaned.includes('<text x="4" font-size="13px" font-family="Georgia" font-weight="bold">d</text>') &&
      cleaned.includes('<text x="5">e</text>'), 'only strict font sizes, families, weights and colours become attributes (no url, expression, escape, oversize or overlong value)');
    ok(hits.length === 0 && await c.evaluate(() => globalThis.ran) === undefined, `no request and no script from the pasted SVG (${hits})`);
    const big = await paste(c, 's05', { [MIME]: envelope({ type: 'column', data: CHARTS.column, svg: '<svg viewBox="0 0 1 1">' + ' '.repeat(2 * 2 ** 20) + '</svg>' }) });
    ok(/drawn when ECharts loads/.test(big) && await c.evaluate(() => /Chart unavailable/.test([...document.querySelectorAll('#s05 > figure.chart')].pop().textContent)),
      `a preview over 2 Mi is dropped ("${big}")`);
    // Save offline, check, reopen online: drawn from the JSON.
    const saved = path.join(DIR, 'b/offline.html');
    fs.writeFileSync(saved, await c.evaluate(() => window.deckEngine.serialize()));
    const check = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), saved, '--json'], { encoding: 'utf8' });
    ok(check.status === 0, 'the deck saved offline with pasted previews passes the checker' + (check.status ? ': ' + check.stdout.slice(0, 600) : ''));
    const again = await open(ctx, saved);
    ok((await charts(again, 's05')).slice(-4).every(f => f.live), 'reopened online: the pasted charts are drawn from their JSON');
    ok(!c.errors.length && !again.errors.length, `no JavaScript error (${[...c.errors, ...again.errors]})`);
    await off.close();

    // 5. Save and reopen an online paste.
    await paste(b, 's05', column);
    const file = path.join(DIR, 'b/saved.html');
    fs.writeFileSync(file, await b.evaluate(() => window.deckEngine.serialize()));
    const checked = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), file], { encoding: 'utf8' });
    ok(checked.status === 0, 'the saved deck passes the checker' + (checked.status ? ': ' + checked.stdout.slice(-400) : ''));
    const reopened = await open(ctx, file);
    ok((await last(reopened, 's05'))?.json === JSON.stringify(CHARTS.column), 'reopened: the pasted chart keeps its JSON');
    await ctx.close();

    if (!full) continue;
    // 6. The async upgrade to a picture (Chromium): event write, then image/png in the same gesture.
    {
      const g = await context(browser, { grant: true });
      const a2 = await open(g, A);
      await copy(a2, 'column');
      await a2.waitForFunction(() => /with a picture/.test(document.querySelector('.hs-banner')?.textContent || ''));
      const pic = await clipboardPicture(a2);
      ok(pic.types.includes('image/png') && pic.types.includes('text/html') && /data-html-office="/.test(pic.html) && /<img alt="Hours by task"/.test(pic.html),
        `granted: the event write is replaced by text/html, text/plain and image/png (${pic.types})`);
      // The column chart's axes carry no unit: ink in the unit band comes from the header the picture adds.
      ok(pic.width > 1000 && pic.width % 2 === 0, `the picture is drawn at 2× (${pic.width}×${pic.height})`);
      ok(pic.title > 50 && pic.unit > 20, `the picture shows the title and the unit above the plot (ink ${pic.title} and ${pic.unit})`);
      await copy(a2, 'gantt');
      await a2.waitForFunction(() => /with a picture/.test(document.querySelector('.hs-banner')?.textContent || ''));
      const b2 = await open(g, B);
      realPaste = true;
      await paste(b2, 's05');
      ok((await last(b2, 's05'))?.json === JSON.stringify(CHARTS.gantt), 'after the async upgrade, a paste reads the envelope from text/html');
      await g.close();
    }
    {
      // Not granted: user activation alone. Either way the paste works.
      const g = await context(browser);
      const a2 = await open(g, A), b2 = await open(g, B);
      await copy(a2, 'hbar');
      await a2.waitForTimeout(1500);
      const upgraded = /with a picture/.test(await banner(a2));
      await paste(b2, 's05');
      ok((await last(b2, 's05'))?.json === JSON.stringify(CHARTS.hbar), `not granted: the paste works (${upgraded ? 'async write accepted' : 'event strings kept'})`);
      await g.close();
    }
    {
      // A refused picture: the strings of the copy event stay.
      const g = await context(browser, { grant: true, init: () => { HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(null)); }; } });
      const a2 = await open(g, A), b2 = await open(g, B);
      const f = await copy(a2, 'waterfall');
      await a2.waitForTimeout(800);
      const types = await b2.evaluate(async () => (await navigator.clipboard.read()).flatMap(i => i.types));
      await paste(b2, 's05');
      ok(!/<img/.test(f['text/html']) && !types.includes('image/png') && (await last(b2, 's05'))?.json === JSON.stringify(CHARTS.waterfall),
        `a refused picture leaves the copy event's flavours (${types})`);
      await g.close();
    }
    {
      // A slow picture: a paste before it resolves, then two copies in quick succession.
      const g = await context(browser, { grant: true, init: () => {
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) { toBlob.call(this, b => setTimeout(() => cb(b), 1500), ...rest); };
      } });
      const a2 = await open(g, A), b2 = await open(g, B);
      await copy(a2, 'bubble', { wait: 0 });
      await paste(b2, 's05');
      ok((await last(b2, 's05'))?.json === JSON.stringify(CHARTS.bubble), 'a paste before the picture resolves reads the copy event\'s flavours');
      await copy(a2, 'gantt', { wait: 0 });
      await copy(a2, 'stacked', { wait: 0 });
      await a2.waitForTimeout(4000);
      const html = await b2.evaluate(async () => { const i = (await navigator.clipboard.read()).find(i => i.types.includes('text/html')); return i ? (await i.getType('text/html')).text() : ''; });
      await paste(b2, 's05');
      ok((await last(b2, 's05'))?.type === 'stacked' && !/&quot;type&quot;:&quot;gantt&quot;/.test(html), 'of two quick copies, the later one stays on the clipboard');
      await g.close();
    }
  } finally {
    await browser.close();
  }
}
counter.close();
console.log(fails ? `\n${fails} failure(s)` : '\nAll Slides chart clipboard checks passed');
process.exit(fails ? 1 : 0);
