// ADR-013 X02a gates in Chromium, Firefox and WebKit: the inert <template>
// parse fetches nothing and runs nothing, the reader gives the same tables as
// in Node, and a paste event carries the envelope in every engine.
// Needs: npx playwright install chromium firefox webkit. CLIPBOARD_ENGINES
// (for example "chromium,webkit") limits the run to some engines.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { parseInert } from './helpers/inert-dom.mjs';
import { readTable } from '../packages/shared/clipboard/index.mjs';

const root = new URL('../', import.meta.url);
const fixtures = ['excel-macos', 'sheets-fr', 'word-macos', 'docs'];
const fixture = name => readFileSync(new URL(`packages/shared/clipboard/fixtures/${name}.html`, root), 'utf8');
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));

// Serves the shared module to the page; resources referenced by clipboard
// HTML point at a second server that only counts requests.
const files = await listen(createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/') return res.end('<!doctype html><title>clipboard engines</title><div id="grid" tabindex="0"></div>');
  if (!/^\/packages\/shared\/clipboard\/[\w-]+\.mjs$/.test(path)) return res.writeHead(404).end();
  res.setHeader('content-type', 'text/javascript');
  res.end(await readFile(new URL('.' + path, root)));
}));
let hits = [];
const resourceServer = createServer((req, res) => { hits.push(req.url); res.end(''); });
const resources = await listen(resourceServer);
const hostile = `<table><tr><td>a<img src="${resources}/img.png" onerror="globalThis.ran=1"><img srcset="${resources}/srcset.png 2x">
  <picture><source srcset="${resources}/source.png"></picture><iframe src="${resources}/iframe"></iframe>
  <link rel="stylesheet" href="${resources}/css"><link rel="prefetch" href="${resources}/prefetch">
  <video poster="${resources}/poster"><source src="${resources}/video.mp4"></video><audio src="${resources}/audio"></audio>
  <object data="${resources}/object"></object><embed src="${resources}/embed"><input type="image" src="${resources}/input">
  <svg><image href="${resources}/svg-image"/></svg><table background="${resources}/background"></table>
  <style>@import "${resources}/import";td{background:url(${resources}/bg)}@font-face{font-family:x;src:url(${resources}/font)}</style>
  <div style="background-image:url(${resources}/inline)">b</div>
  <script>globalThis.ran = 2</script><script src="${resources}/script.js"></script>
  <meta http-equiv="refresh" content="0;url=${resources}/refresh"></td><td onclick="globalThis.ran=3">2</td></tr></table>`;
const expected = Object.fromEntries(fixtures.map(name => [name, readTable(parseInert(fixture(name)))]));

const engines = { chromium, firefox, webkit };
for (const type of (process.env.CLIPBOARD_ENGINES ?? 'chromium,firefox,webkit').split(',').map(name => engines[name])) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(files + '/');
    hits = [];
    const result = await page.evaluate(async ({ hostile, sources }) => {
      const m = await import('/packages/shared/clipboard/index.mjs');
      const tables = Object.fromEntries(Object.entries(sources).map(([name, html]) => [name, m.readTable(m.parseInert(html))]));
      // Keep the fragments alive, so nothing is collected before a fetch.
      globalThis.kept = [m.parseInert(hostile), m.parseInert(hostile)];
      const parsed = m.readTable(globalThis.kept[0]);
      // The envelope and the HTML through a real paste event.
      const envelope = { schema: m.SCHEMA, kind: 'table', table: { rows: [[{ text: 'x "y" <z>' }]] } };
      const json = JSON.stringify(envelope);
      const read = [];
      document.getElementById('grid').addEventListener('paste', event => {
        event.preventDefault();
        read.push(m.readClipboard(event.clipboardData));
      });
      const send = flavours => {
        const data = new DataTransfer();
        for (const [t, v] of Object.entries(flavours)) data.setData(t, v);
        document.getElementById('grid').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      };
      send({ [m.MIME]: json, 'text/plain': 'x' });
      send({ 'text/html': m.tableHTML(envelope.table, { envelope: json }), 'text/plain': 'x' });
      send({ 'text/html': hostile, 'text/plain': 'x' });
      return { tables, parsed, read: read.map(r => ({ source: r.source, via: r.via, envelope: r.envelope, table: r.table })), envelope };
    }, { hostile, sources: Object.fromEntries(fixtures.map(name => [name, fixture(name)])) });
    await page.waitForTimeout(1500);
    const name = `${type.name()} ${browser.version()}`;
    assert.deepEqual(hits, [], `${name}: parsing clipboard HTML made requests`);
    assert.equal(await page.evaluate(() => globalThis.ran), undefined, `${name}: clipboard HTML ran script`);
    assert.deepEqual(errors, []);
    assert.deepEqual(result.tables, expected, `${name}: tables differ from the Node reader`);
    assert.deepEqual(result.parsed.table.rows[0].map(c => c.text), ['a\nb', '2']);
    assert.deepEqual(result.read.map(r => [r.source, r.via]), [['envelope', 'custom'], ['envelope', 'html'], ['table', undefined]]);
    for (const r of result.read.slice(0, 2)) assert.deepEqual(r.envelope.table, result.envelope.table);
    console.log(`PASS ${name}: inert parse (no request, no script), fixtures as in Node, envelope through paste events`);
  } finally {
    await browser.close();
  }
}
resourceServer.close();
process.exit(0);
