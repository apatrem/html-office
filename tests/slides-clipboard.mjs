// ADR-013 X02b in browsers: Slides tables through the shared clipboard (packages/shared/clipboard).
// Two decks in two tabs, opened from two file:// paths and served from two localhost ports:
// copy a table with the keyboard and with Edit › Copy, paste it with the keyboard and Edit › Paste,
// one undo step, save, reopen and check; each carrier alone (custom type, data-html-office,
// semantic HTML, TSV); tables from Excel, Sheets, Word and Docs; hostile clipboards (deck
// unchanged, no request, no script); merged cells through the editor's row and column commands
// and print; Slides ⇄ Data.
// Every engine runs every case. Chromium pastes from the real clipboard (keyboard and Edit › Paste);
// CLIPBOARD_ENGINES=chromium,firefox,webkit adds Firefox and WebKit, where the copy is real (keyboard
// and menu) and the paste a dispatched event carrying the copied flavours: their headless clipboards
// are not the native pasteboards, which stay in ADR-013's manual matrix.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { ASSETS, upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';
import { parseInert } from './helpers/inert-dom.mjs';
import { readTable, MIME, ATTRIBUTE } from '../packages/shared/clipboard/index.mjs';
import { buildWorkbook } from '../packages/data/tools/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'work/slides-clipboard');
fs.rmSync(DIR, { recursive: true, force: true });
for (const d of ['a', 'b', 'data']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

// Deck A carries a canonical table with every feature Slides tables have; deck B is the example.
const SOURCE = '<table class="t"><tbody><tr><th rowspan="2">Plot</th><th class="ta-c" colspan="2">Hours</th></tr>' +
  '<tr><th class="n">Spring</th><th class="n">Summer</th></tr>' +
  '<tr><td>Revenue <b>growth</b></td><td class="n">120</td><td class="n"><span class="c-acc">45</span></td></tr>' +
  '<tr><td><i>Shared</i> beds<br>north</td><td class="n"><span class="neg">−8</span></td><td class="n">0012</td></tr>' +
  '<tr class="tot"><td>Total</td><td class="n">112</td><td class="n">57</td></tr></tbody></table>';
const example = upgrade(fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'));
// s91: a rowspan in a one-row thead stops at its row group, as browsers draw it.
const deckA = example.replace('</main>', `<section class="slide" id="s90" data-layout="default"><h1>Clipboard fixture</h1>${SOURCE}<p class="source">Source: fictional</p></section>` +
  '<section class="slide" id="s91" data-layout="default"><h1>Row groups</h1><table class="t"><thead><tr><th rowspan="2">A</th><th>B</th></tr></thead><tbody><tr><td>c</td><td>d</td></tr></tbody></table></section></main>');
const A = path.join(DIR, 'a/deck.html'), B = path.join(DIR, 'b/deck.html');
fs.writeFileSync(A, deckA);
fs.writeFileSync(B, example);
const fixture = name => fs.readFileSync(path.join(ROOT, `packages/shared/clipboard/fixtures/${name}.html`), 'utf8');

// Two localhost ports, one deck each; a third server only counts requests.
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));
const serve = file => createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(file)); });
const servers = [serve(A), serve(B)];
const [httpA, httpB] = await Promise.all(servers.map(listen));
let hits = [];
const counter = createServer((req, res) => { hits.push(req.url); res.end(''); });
const resources = await listen(counter);

// Firefox's ClipboardEvent constructor ignores clipboardData: it is attached as an own property.
const initScript = () => {
  globalThis.clipEvent = (type, data) => {
    const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    return event;
  };
  // What the last copy event carried, read after the engine's handler.
  addEventListener('copy', e => { globalThis.copied = Object.fromEntries([...e.clipboardData.types].map(t => [t, e.clipboardData.getData(t)])); });
};
async function open(ctx, url) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  await page.keyboard.press('e');
  page.errors = errors;
  return page;
}
const banner = page => page.evaluate(() => document.querySelector('.hs-banner')?.textContent || '');
const mainHTML = page => page.evaluate(() => window.deckEngine.serialize().match(/<main[\s\S]*<\/main>/)[0]);
const tables = (page, slide) => page.evaluate(s => [...document.querySelectorAll(`#${s} > table`)].map(t => {
  const c = t.cloneNode(true);
  c.removeAttribute('data-id'); c.removeAttribute('style'); c.classList.remove('hs-sel');
  return c.outerHTML;
}), slide);
const last = async (page, slide) => (await tables(page, slide)).pop();
async function selectTable(page, sel) {
  await page.bringToFront();
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.locator(sel).click({ position: { x: 20, y: 8 } });
}
async function focusSlide(page, slide) {
  await page.bringToFront();
  await page.locator(`#${slide}`).scrollIntoViewIfNeeded();
  await page.locator(`#${slide}`).click({ position: { x: 4, y: 4 } }); // the margin: current slide, nothing selected
  await page.keyboard.press('Escape');
}
async function menu(page, name, entry) {
  await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
  await page.locator('.sh-pop [role=menuitem]').filter({ has: page.locator('.sh-mlabel').getByText(entry, { exact: true }) }).click();
}
// The flavours of the last copy, pasted by a dispatched event where the clipboard is not real.
let lastCopy = null, realPaste = false;
async function copy(page, sel, how = 'keyboard') {
  await selectTable(page, sel);
  await page.evaluate(() => { globalThis.copied = null; });
  if (how === 'keyboard') await page.keyboard.press('ControlOrMeta+c');
  else await menu(page, 'Edit', 'Copy');
  await page.waitForFunction(() => globalThis.copied);
  return lastCopy = await page.evaluate(() => globalThis.copied);
}
// A paste of exactly these flavours, as another page would write them.
const dispatchPaste = (page, flavours) => page.evaluate(f => {
  const data = new DataTransfer();
  for (const [t, v] of Object.entries(f)) data.setData(t, v);
  (document.activeElement || document.body).dispatchEvent(clipEvent('paste', data));
}, flavours);
async function paste(page, slide, flavours) {
  await focusSlide(page, slide);
  await page.evaluate(() => document.querySelector('.hs-banner')?.remove());
  if (flavours === 'keyboard' && !realPaste) flavours = lastCopy;
  if (flavours === 'keyboard') await page.keyboard.press('ControlOrMeta+v');
  else if (flavours === 'menu') await menu(page, 'Edit', 'Paste');
  else await dispatchPaste(page, flavours);
  await page.waitForFunction(() => document.querySelector('.hs-banner'));
  return banner(page);
}

const engines = { chromium, firefox, webkit };
for (const name of (process.env.CLIPBOARD_ENGINES ?? 'chromium').split(',')) {
  const engine = engines[name], full = name === 'chromium';
  realPaste = full;
  const browser = await engine.launch();
  const label = `${name} ${browser.version()}`;
  console.log(`\n# ${label}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  if (full) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(initScript);
  await ctx.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  try {
    for (const [where, urlA, urlB] of [['file://', pathToFileURL(A).href, pathToFileURL(B).href], ['localhost', httpA + '/', httpB + '/']]) {
      const a = await open(ctx, urlA), b = await open(ctx, urlB);
      // 1. Copy: keyboard and Edit › Copy write the same three flavours.
      const flavours = await copy(a, '#s90 > table');
      ok(/^Table copied/.test(await banner(a)), `${where}: keyboard copy of a selected table`);
      ok([MIME, 'text/html', 'text/plain'].every(t => flavours[t]), `${where}: envelope, text/html and text/plain written (${Object.keys(flavours)})`);
      const envelope = JSON.parse(flavours[MIME]);
      ok(envelope.source.product === 'slides' && !('locale' in envelope.source) && envelope.table.headerRows === 2 && envelope.table.totalRows[0] === 4 &&
        envelope.table.rows[0][1].colspan === 2 && envelope.table.rows[0][0].rowspan === 2 && envelope.table.rows[2][0].runs.length === 2,
        `${where}: the envelope carries headers, total, merges and runs, and no locale`);
      ok(flavours['text/plain'].split('\n')[2] === 'Revenue growth\t120\t45', `${where}: text/plain is the displayed text as TSV`);
      const menuCopy = await copy(a, '#s90 > table', 'menu');
      ok(JSON.stringify(menuCopy) === JSON.stringify(flavours), `${where}: Edit › Copy writes the same flavours`);
      if (where === 'file://') {
        // Formatting set on the whole table (by the toolbar) or on a row reaches its cells; header
        // cells keep their own colour and alignment, as the theme draws them.
        await a.evaluate(() => { const t = document.querySelector('#s90 > table'); t.classList.add('t-bold', 'c-alert', 'bg-tint', 'ta-c'); t.rows[3].classList.add('t-italic', 'c-acc'); });
        const styled = JSON.parse((await copy(a, '#s90 > table'))[MIME]).table.rows;
        await a.evaluate(() => { const t = document.querySelector('#s90 > table'); t.classList.remove('t-bold', 'c-alert', 'bg-tint', 'ta-c'); t.rows[3].removeAttribute('class'); });
        const got = JSON.stringify([styled[0][1], styled[1][1], styled[2][0], styled[2][1], styled[3][2]]);
        ok(got === JSON.stringify([
          { text: 'Hours', bold: true, fill: 'tint', header: true, colspan: 2, align: 'center' },
          { text: 'Spring', bold: true, fill: 'tint', header: true, align: 'right' },
          { text: 'Revenue growth', bold: true, color: 'alert', fill: 'tint', align: 'center' },
          { text: '120', bold: true, color: 'alert', fill: 'tint', align: 'right' },
          { text: '0012', bold: true, italic: true, color: 'acc', fill: 'tint', align: 'right' }]),
          'table and row formatting reach the cells (the nearest wins; headers keep their colour and alignment)\n      ' + got);
        const groups = JSON.parse((await copy(a, '#s91 > table'))[MIME]).table;
        ok(JSON.stringify(groups.rows.map(r => r.map(c => c?.text))) === '[["A","B"],["c","d"]]' && !groups.rows[0][0].rowspan,
          `a rowspan does not leave its row group (${JSON.stringify(groups.rows)})`);
        // Text selected in a field keeps the browser's own copy while a table is selected.
        await selectTable(a, '#s90 > table');
        await a.evaluate(() => { const i = document.createElement('input'); i.className = 'probe'; i.value = 'footer text'; document.querySelector('.hs-shell').append(i); i.select(); globalThis.copied = null; });
        await a.keyboard.press('ControlOrMeta+c');
        await a.waitForFunction(() => globalThis.copied);
        ok(!Object.keys(await a.evaluate(() => globalThis.copied)).includes(MIME),
          'copying text selected in an input is not taken over by the selected table');
        await a.evaluate(() => document.querySelector('input.probe').remove());
        await copy(a, '#s90 > table');
      }
      // 2. Paste into the other deck, one undo step; keyboard and Edit › Paste in Chromium.
      const before = (await tables(b, 's05')).length, html0 = await mainHTML(b);
      const said = await paste(b, 's05', 'keyboard');
      ok(said.startsWith('Table pasted') && (await tables(b, 's05')).length === before + 1, `${where}: ${full ? 'keyboard' : 'event'} paste adds a table to the current slide ("${said}")`);
      ok(await last(b, 's05') === SOURCE, `${where}: the pasted table is identical to the copied one` + (await last(b, 's05') === SOURCE ? '' : '\n      ' + await last(b, 's05')));
      ok(await b.evaluate(() => window.deckEngine.selection().length === 1 && document.querySelector(`[data-id="${window.deckEngine.selection()[0]}"]`)?.matches('table.t')),
        `${where}: the pasted table is selected`);
      await b.keyboard.press('ControlOrMeta+z');
      ok(await mainHTML(b) === html0, `${where}: one undo removes the paste`);
      if (full) {
        await a.evaluate(() => {}); // the clipboard still holds the keyboard copy
        const viaMenu = await paste(b, 's05', 'menu');
        ok(viaMenu.startsWith('Table pasted') && await last(b, 's05') === SOURCE, `${where}: Edit › Paste reads the clipboard (sanitised HTML keeps the envelope)`);
        await b.keyboard.press('ControlOrMeta+z');
      }
      if (where === 'localhost') { await a.close(); await b.close(); continue; }

      // 3. Each carrier alone gives the documented result.
      const withoutCustom = { 'text/html': flavours['text/html'], 'text/plain': flavours['text/plain'] };
      await paste(b, 's05', withoutCustom);
      ok(await last(b, 's05') === SOURCE, 'without the custom type, the envelope comes from text/html (identical table)');
      await b.keyboard.press('ControlOrMeta+z');
      const semantic = flavours['text/html'].replace(/ data-html-office="[^"]*"/, '');
      ok(!semantic.includes(ATTRIBUTE), 'fixture: text/html without the attribute');
      await paste(b, 's05', { 'text/html': semantic, 'text/plain': flavours['text/plain'] });
      const fromHTML = await last(b, 's05');
      ok(fromHTML === '<table class="t"><tbody><tr><th rowspan="2">Plot</th><th class="ta-c" colspan="2">Hours</th></tr><tr><th class="n">Spring</th><th class="n">Summer</th></tr>' +
        '<tr><td>Revenue <b>growth</b></td><td class="n">120</td><td class="n">45</td></tr><tr><td><i>Shared </i>beds<br>north</td><td class="n"><b>−8</b></td><td class="n">0012</td></tr>' +
        '<tr><td><b>Total</b></td><td class="n"><b>112</b></td><td class="n"><b>57</b></td></tr></tbody></table>',
        'without the attribute, the semantic table keeps structure, merges, alignment, bold and italic; colours and the total row are lost' + '\n      ' + fromHTML);
      await b.keyboard.press('ControlOrMeta+z');
      await paste(b, 's05', { 'text/plain': flavours['text/plain'] });
      const fromText = await last(b, 's05');
      ok(fromText === '<table class="t"><tbody><tr><td>Plot</td><td>Hours</td><td></td></tr><tr><td></td><td>Spring</td><td>Summer</td></tr><tr><td>Revenue growth</td><td>120</td><td>45</td></tr>' +
        '<tr><td>Shared beds\nnorth</td><td>−8</td><td>0012</td></tr><tr><td>Total</td><td>112</td><td>57</td></tr></tbody></table>'.replace('\n', '<br>'),
        'without HTML, text/plain gives a plain table of the displayed text' + '\n      ' + fromText);
      await b.keyboard.press('ControlOrMeta+z');

      // 4. Hostile clipboards: refused or neutralised, never a request or a script.
      const unchanged = await mainHTML(b);
      const valid = '<table><tr><td>Safe</td><td>1</td></tr></table>';
      const hostile = `<table><tr><td>a<img src="${resources}/img.png" onerror="globalThis.ran=1"><img srcset="${resources}/srcset.png 2x">` +
        `<iframe src="${resources}/iframe"></iframe><link rel="stylesheet" href="${resources}/css"><video poster="${resources}/poster"></video>` +
        `<object data="${resources}/object"></object><svg><image href="${resources}/svg-image"/></svg><style>@import "${resources}/import";td{background:url(${resources}/bg)}</style>` +
        `<script>globalThis.ran = 2</script><a href="javascript:globalThis.ran=3">js</a> <a href="data:text/html,x">data</a></td>` +
        `<td onclick="globalThis.ran=4" style="background:url(${resources}/inline)">2</td></tr></table>`;
      const refused = [
        ['__proto__ in an envelope', { [MIME]: '{"schema":"html-office-clip/1","kind":"table","table":{"rows":[[{"text":"a","__proto__":{"bold":true}}]]}}', 'text/html': valid }],
        ['a malformed html-office-clip/1 envelope beside a valid HTML table', { [MIME]: '{"schema":"html-office-clip/1","kind":"table"}', 'text/html': valid, 'text/plain': 'Safe\t1' }],
        ['a colspan past the slide limit', { 'text/html': '<table><tr><td colspan="1000">x</td></tr></table>' }],
        ['13 columns', { 'text/plain': Array.from({ length: 13 }, (_, i) => 'c' + i).join('\t') }],
        ['51 rows', { 'text/plain': Array.from({ length: 51 }, (_, i) => `r${i}\t1`).join('\n') }],
        ['a range from Data before X02a', { 'application/x-html-office-range+json': '{"schema":"html-office-range/1","cells":[]}' }],
        ['a chart envelope (until X02c)', { [MIME]: '{"schema":"html-office-clip/1","kind":"chart","chart":{"type":"column","data":{}}}' }]];
      for (const [what, f] of refused) {
        const msg = await paste(b, 's05', f);
        ok(/failed|cannot be pasted/.test(msg) && await mainHTML(b) === unchanged, `refused, deck unchanged: ${what} ("${msg}")`);
      }
      const oversize = await paste(b, 's05', { 'text/html': '<table><tr><td>x</td></tr></table>' + ' '.repeat(8 * 2 ** 20), 'text/plain': 'x' });
      ok(/no table/.test(oversize) && await mainHTML(b) === unchanged, `text/html over 8 Mi code units is ignored ("${oversize}")`);
      const newer = await paste(b, 's05', { [MIME]: '{"schema":"html-office-clip/2","kind":"table"}', 'text/html': valid });
      ok(/unsupported format \(html-office-clip\/2\)/.test(newer) && /<td>Safe<\/td><td>1<\/td>/.test(await last(b, 's05')),
        `an unknown envelope version falls through to the semantic table ("${newer}")`);
      await b.keyboard.press('ControlOrMeta+z');
      // Chromium stops nesting at 512 elements: deeper markup becomes siblings, so the table loses its rows.
      const nested = depth => paste(b, 's05', { 'text/html': '<div>'.repeat(depth) + '<table><tr><td>deep</td></tr></table>' + '</div>'.repeat(depth) });
      const deep = await nested(400);
      ok(deep.startsWith('Table pasted') && /<td>deep<\/td>/.test(await last(b, 's05')), `a table nested 400 elements deep is read without recursion ("${deep}")`);
      await b.keyboard.press('ControlOrMeta+z');
      const deeper = await nested(20000);
      ok(/^(Table pasted|The clipboard holds no table)/.test(deeper) && !b.errors.length, `20,000 nested elements: no error ("${deeper}")`);
      if (deeper.startsWith('Table pasted')) await b.keyboard.press('ControlOrMeta+z');
      hits = [];
      const neutral = await paste(b, 's05', { 'text/html': hostile, 'text/plain': 'a\t2' });
      await b.waitForTimeout(1000);
      const pasted = await last(b, 's05');
      ok(neutral.startsWith('Table pasted') && /2 links were not carried over/.test(neutral) && pasted === '<table class="t"><tbody><tr><td>ajs data</td><td>2</td></tr></tbody></table>',
        `active HTML is neutralised: text only ("${neutral}")\n      ${pasted}`);
      ok(hits.length === 0 && await b.evaluate(() => globalThis.ran) === undefined, `no request and no script while pasting (${hits})`);
      await b.keyboard.press('ControlOrMeta+z');

      // 5. Tables from Excel, Google Sheets, Word and Google Docs: their displayed text, as the shared reader gives it.
      for (const f of ['excel-macos', 'sheets-fr', 'word-macos', 'docs']) {
        const expected = readTable(parseInert(fixture(f))).table.rows.map(row => row.filter(s => !s?.covered).map(s => s?.text ?? ''));
        await paste(b, 's05', { 'text/html': fixture(f), 'text/plain': 'x' });
        const got = await b.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table')].pop(); return [...t.rows].map(r => [...r.cells].map(c => c.innerText)); });
        ok(JSON.stringify(got) === JSON.stringify(expected), `${f}: pasted as a table of its displayed text`);
        await b.keyboard.press('ControlOrMeta+z');
      }
      ok(await mainHTML(b) === unchanged, 'every paste above was undone in one step');
      ok(!a.errors.length && !b.errors.length, `no JavaScript error (${[...a.errors, ...b.errors]})`);

      // 6. Merged cells through the editor's table commands, then print, save, reopen and check.
      await paste(b, 's05', 'keyboard');
      const rect = () => b.evaluate(() => {
        const t = [...document.querySelectorAll('#s05 > table')].pop(), rows = [...t.rows], taken = rows.map(() => []);
        rows.forEach((tr, r) => { let c = 0; for (const cell of tr.cells) { while (taken[r][c]) c++; for (let i = r; i < r + cell.rowSpan; i++) for (let j = c; j < c + cell.colSpan; j++) taken[i][j] = (taken[i][j] || 0) + 1; c += cell.colSpan; } });
        return { widths: taken.map(x => x.length), overlap: taken.flat().some(n => n > 1), rows: rows.length, text: t.rows[0].cells[1].textContent, spans: [t.rows[0].cells[0].rowSpan, t.rows[0].cells[1].colSpan] };
      });
      const caret = (r, c) => b.evaluate(([r, c]) => { const t = [...document.querySelectorAll('#s05 > table')].pop(); const range = document.createRange(); range.selectNodeContents(t.rows[r].cells[c]); range.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(range); }, [r, c]);
      const tool = n => b.getByRole('toolbar', { name: 'Slide and selection' }).getByRole('button', { name: n, exact: true });
      await b.locator('#s05 > table').last().dblclick({ position: { x: 20, y: 8 } });
      await caret(0, 1); // in "Hours" (colspan 2)
      await tool('Insert column right').click();
      let g = await rect();
      ok(g.widths.every(w => w === 4) && !g.overlap && g.spans[1] === 2, `insert column right of a merged cell: rectangular, merge kept (${JSON.stringify(g)})`);
      await caret(2, 1); // "120", under the merged header
      await tool('Delete column').click();
      g = await rect();
      ok(g.widths.every(w => w === 3) && !g.overlap && g.spans[1] === 1 && g.text === 'Hours', `delete a column under a merge narrows it (${JSON.stringify(g)})`);
      await caret(0, 0); // "Plot" (rowspan 2)
      await tool('Insert row below').click();
      g = await rect();
      ok(g.rows === 6 && g.widths.every(w => w === 3) && !g.overlap, `insert a row below a row-merged cell (${JSON.stringify(g)})`);
      await caret(0, 0);
      await tool('Delete row').click();
      g = await rect();
      ok(g.rows === 5 && g.widths.every(w => w === 3) && !g.overlap && g.spans[0] === 1, `delete the first row of a row-merged cell keeps its text below (${JSON.stringify(g)})`);
      await b.keyboard.press('Escape');
      await b.keyboard.press('ControlOrMeta+z');
      ok(await last(b, 's05') === SOURCE, 'one undo restores the table after a typing session of table commands' + (await last(b, 's05') === SOURCE ? '' : '\n      ' + await last(b, 's05')));
      await b.locator('#s05 > table').last().click({ position: { x: 20, y: 8 } });
      await menu(b, 'Table', 'Unmerge cells');
      g = await rect();
      ok(g.spans.join() === '1,1' && g.widths.every(w => w === 3) && !g.overlap, `Table › Unmerge cells splits every merge (${JSON.stringify(g)})`);
      await b.keyboard.press('ControlOrMeta+z');
      await b.emulateMedia({ media: 'print' });
      const print = await b.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table')].pop(), w = e => e.getBoundingClientRect().width;
        return [w(t.rows[0].cells[1]), w(t.rows[1].cells[0]) + w(t.rows[1].cells[1])]; });
      await b.emulateMedia({ media: 'screen' });
      ok(Math.abs(print[0] - print[1]) < 1.5, `print: a merged header spans its columns (${print})`);
      const saved = path.join(DIR, 'b/saved.html');
      fs.writeFileSync(saved, await b.evaluate(() => window.deckEngine.serialize()));
      const check = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), saved, '--json'], { encoding: 'utf8' });
      const report = JSON.parse(check.stdout || '{"out":[]}');
      ok(check.status === 0, 'the saved deck passes the checker' + (check.status ? ': ' + JSON.stringify(report.out.filter(x => x.level === 'error')) : ''));
      const again = await open(ctx, pathToFileURL(saved).href);
      ok(await last(again, 's05') === SOURCE, 'reopened: the pasted table is unchanged');
      await again.close();
      // A cell merged down into the total row: a row inserted below it still goes before the total.
      await b.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table')].pop(); t.rows[3].cells[0].rowSpan = 2; t.rows[4].cells[0].remove(); });
      await b.locator('#s05 > table').last().dblclick({ position: { x: 20, y: 8 } });
      await caret(3, 0);
      await tool('Insert row below').click();
      g = await rect();
      const lastRow = await b.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table')].pop(); return [t.rows.length, t.rows[t.rows.length - 1].className, t.rows[3].cells[0].rowSpan]; });
      ok(lastRow.join() === '6,tot,3' && g.widths.every(w => w === 3) && !g.overlap, `insert below a cell merged into the total row keeps the total last (${lastRow})`);
      await b.keyboard.press('Escape');

      // 7. Slides → Data and Data → Slides.
      const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/data/fixtures/two-sheets.json'), 'utf8'));
      Object.assign(book.sheets[0].cells, {
        D1: { input: { type: 'text', value: 'Hours' }, cellStyle: 'header', style: { align: { horizontal: 'centerContinuous' } } },
        E1: { input: { type: 'blank' }, cellStyle: 'header', style: { align: { horizontal: 'centerContinuous' } } },
        F1: { input: { type: 'text', value: 'Note' }, cellStyle: 'header' },
        D2: { input: { type: 'text', value: 'Spring' } }, E2: { input: { type: 'number', value: 120 } }, F2: { input: { type: 'text', value: 'Dry' }, cellStyle: 'alert' },
        D3: { input: { type: 'text', value: 'Summer' } }, E3: { input: { type: 'number', value: 45.5 }, format: { kind: 'number', digits: 0 } }, F3: { input: { type: 'text', value: 'Guide' } },
        D4: { input: { type: 'text', value: 'Total' }, cellStyle: 'total' }, E4: { formula: '=E2+E3', result: { type: 'number', value: 165.5 }, cellStyle: 'total' }, F4: { input: { type: 'blank' }, cellStyle: 'total' }
      });
      book.sheets[0].links = { F3: { url: 'https://example.com/guide' } };
      const workbook = path.join(DIR, 'data/book.html');
      fs.writeFileSync(workbook, await buildWorkbook(book, { offline: true }));
      // Over http: Playwright's WebKit cannot start Data's blob: worker from file://.
      const dataServer = serve(workbook), dataURL = await listen(dataServer);
      const data = await ctx.newPage();
      data.on('pageerror', e => b.errors.push(String(e)));
      await data.goto(dataURL + '/');
      await data.getByText('Saved results are current.', { exact: true }).waitFor();
      const jump = async ref => { await data.getByLabel('Cell address').fill(ref); await data.keyboard.press('Tab'); await data.locator('#grid').focus(); };
      await data.bringToFront();
      await jump('D1:F4');
      await data.evaluate(() => { globalThis.copied = null; });
      await data.keyboard.press('ControlOrMeta+c');
      await data.locator('#status').filter({ hasText: 'Range copied' }).waitFor();
      lastCopy = await data.evaluate(() => globalThis.copied);
      await paste(b, 's05', 'keyboard');
      const fromData = await last(b, 's05');
      ok(fromData === '<table class="t"><tbody><tr><th class="ta-c" colspan="2">Hours</th><th>Note</th></tr><tr><td>Spring</td><td class="n">120</td><td><span class="neg">Dry</span></td></tr>' +
        '<tr><td>Summer</td><td class="n">46</td><td>Guide</td></tr><tr class="tot"><td>Total</td><td class="n">165.5</td><td></td></tr></tbody></table>',
        'Data → Slides: header row, centre across selection as colspan, numbers right-aligned as displayed, alert as neg, total row' + '\n      ' + fromData);
      ok(/1 link was not carried over/.test(await banner(b)), 'Data → Slides: the dropped link is counted');
      await copy(a, '#s90 > table');
      await data.bringToFront();
      await jump('H10');
      if (realPaste) await data.keyboard.press('ControlOrMeta+v');
      else await dispatchPaste(data, lastCopy);
      await data.locator('#status').filter({ hasText: 'Pasted.' }).waitFor();
      const cell = ref => data.evaluate(r => { const el = document.getElementById('grid-' + r); return [el.textContent.trim(), el.className]; }, ref);
      const status = await data.locator('#status').textContent();
      const got = Object.fromEntries(await Promise.all(['H10', 'I10', 'J10', 'H11', 'I11', 'H12', 'I12', 'J12', 'I13', 'J13', 'H14'].map(async r => [r, await cell(r)])));
      ok(got.H10[0] === 'Plot' && /\bheader\b/.test(got.H10[1]) && got.I10[0] === 'Hours' && got.H11[0] === '' && got.I11[0] === 'Spring' &&
        got.H12[0] === 'Revenue growth' && got.I12[0] === '120' && got.J12[0] === '45' && got.I13[0] === '−8' && got.J13[0] === '0012' &&
        got.H14[0] === 'Total' && /\btotal\b/.test(got.H14[1]), 'Slides → Data: header and total styles, merges unmerged, typed numbers, leading zeros kept as text' + '\n      ' + JSON.stringify(got));
      ok(/2 merged cells were unmerged/.test(status) && /2 cells' mixed formatting became plain text/.test(status), `Slides → Data: the paste notice counts merges and flattened cells ("${status}")`);
      ok(!a.errors.length && !b.errors.length, `no JavaScript error (${[...a.errors, ...b.errors]})`);
      await data.close(); await a.close(); await b.close();
      dataServer.close();
    }
  } finally {
    await browser.close();
  }
}
for (const s of [...servers, counter]) s.close();
console.log(fails ? `\n${fails} failure(s)` : '\nAll Slides clipboard checks passed');
process.exit(fails ? 1 : 0);
