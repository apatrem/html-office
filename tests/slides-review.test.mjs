// Slides defects found by the project review of 22 November 2026: each test reproduces one in
// Chromium before its fix (unsafe re-parsing, dropped rich content, Enter in a paragraph, print
// from edit mode, slide identifiers, the deletion notice, an ECharts load that failed once).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ASSETS, asset, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(root, 'work/review-'));
const deckTool = path.join(root, 'plugin/skills/html-slides/tools/deck.mjs');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// A deck written by the tools, then given content the checker would refuse (as a tampered or
// hand-edited file would hold).
const S = (id, body, attrs = '') => `<section class="slide"${id ? ` id="${id}"` : ''} data-layout="default"${attrs}>${body}</section>`;
function deck(name, slides, { raw } = {}) {
  const file = path.join(dir, name + '.html'), content = path.join(dir, name + '.content.html');
  fs.writeFileSync(content, S('s01', '<h1>Placeholder</h1>'));
  execFileSync(process.execPath, [deckTool, 'new', file, '--content', content]);
  const html = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, setZone(html, 'deck', '\n' + (raw ?? slides.join('\n')) + '\n'));
  return file;
}
async function open(t, file, { edit = true, offline = false, viewport = { width: 1100, height: 850 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => (typeof offline === 'function' ? offline() : offline) ? r.abort()
    : r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  if (edit) await page.keyboard.press('e');
  return page;
}
const typeInto = async (page, sel, text) => {
  await page.locator(sel).dblclick();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
};
const slideMenu = async (page, name) => {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Slide' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};
const undoKey = page => page.keyboard.press('Control+z');

// ---- A1: markup that becomes active only when parsed again ----
const MXSS = '<math><mtext><table><mglyph><xmp><img src=x onerror="window.pwned=(window.pwned||0)+1"></xmp></mglyph></table></mtext></math>';
test('undo, duplicate and a restored structure never re-parse a slide into active markup', async t => {
  const file = deck('mxss', [S('s01', `<h1 data-id="e1">Title</h1><div class="body" data-id="e2">Body</div>${MXSS}`), S('s02', '<h1 data-id="e3">Second</h1>')]);
  const page = await open(t, file);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#deck img').length), 0, 'the first parse holds no image');
  await typeInto(page, '#s01 > h1', ' edited');
  await undoKey(page);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.pwned), undefined, 'undo made an image with onerror');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#deck img[onerror]').length), 0);
  // duplicate the slide (its HTML is parsed again), then undo that structure change
  await page.locator('#s01 > h1').click();
  await page.evaluate(() => document.querySelector('#s01').scrollIntoView());
  await slideMenu(page, 'Duplicate slide');
  await page.waitForFunction(() => document.querySelectorAll('#deck > section.slide').length === 3);
  await undoKey(page);
  await page.waitForFunction(() => document.querySelectorAll('#deck > section.slide').length === 2);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.pwned), undefined, 'duplicate or a restored structure made an image with onerror');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#deck img[onerror], #deck xmp, #deck math').length), 0);
  assert.deepEqual(page.errors, []);
});

test('Save refuses a deck whose markup would change when the file is reopened', async t => {
  const file = deck('mxss-save', [S('s01', `<h1 data-id="e1">Title</h1>${MXSS}`)]);
  const page = await open(t, file);
  await typeInto(page, '#s01 > h1', ' edited');
  await page.evaluate(() => { window.__writes = 0; window.showSaveFilePicker = async () => ({ name: 'x.html', getFile: async () => ({ text: async () => '' }),
    createWritable: async () => ({ write: async () => { window.__writes++; }, close: async () => {} }) }); });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /Save failed/.test(document.querySelector('.hs-banner')?.textContent ?? ''));
  assert.match(await page.locator('.hs-banner').textContent(), /slide 1 .*changes when the file is reopened/);
  assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
});

// ---- A2: dropping rich content into text ----
test('content dropped into text being edited arrives as plain text', async t => {
  const file = deck('drop', [S('s01', '<h1 data-id="e1">Title</h1><div class="body" data-id="e2">Body text</div>')]);
  const page = await open(t, file);
  const requests = [];
  await page.route('http://example.invalid/**', r => { requests.push(r.request().url()); return r.abort(); });
  await page.locator('#s01 > .body').dblclick();
  const box = await page.locator('#s01 > .body').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [{ mimeType: 'text/html', data: '<b>Dropped</b> <img src="http://example.invalid/a.png" alt="remote"><a href="http://example.invalid/">link</a>' },
    { mimeType: 'text/plain', data: 'Dropped link' }], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await cdp.send('Input.dispatchDragEvent', { type, x: box.x + box.width - 4, y: box.y + box.height / 2, data });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const html = await page.locator('#s01 > .body').innerHTML();
  assert.match(html, /Dropped link/, html);
  assert.doesNotMatch(html, /<img|<a |<b>/, html);
  assert.deepEqual(requests, []);
});

// ---- C7: Enter in a paragraph or heading ----
test('Enter in a top-level paragraph or title inserts a line break, which survives undo and redo', async t => {
  const file = deck('enter', [S('s01', '<h1 data-id="e1">Title</h1><p class="lead" data-id="e2">First line</p><div class="body" data-id="e3">Body</div>')]);
  const page = await open(t, file);
  for (const sel of ['#s01 > p.lead', '#s01 > h1']) {
    await page.locator(sel).dblclick();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await page.keyboard.press('Escape');
  }
  const shape = () => page.evaluate(() => [...document.querySelector('#s01').children].filter(n => !n.hasAttribute('data-ui'))
    .map(n => n.tagName.toLowerCase() + ':' + n.innerHTML).join(' | '));
  const typed = await shape();
  assert.equal(typed, 'h1:Title<br>next | p:First line<br>next | div:Body');
  await undoKey(page); await undoKey(page);
  await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z');
  assert.equal(await shape(), typed);
});

// ---- C8: print from edit mode and read mode ----
const pages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
test('printing gives one page per slide, each slide at the top left, in edit and read mode', async t => {
  const garden = path.join(dir, 'garden.html');
  fs.writeFileSync(garden, setZone(fs.readFileSync(path.join(root, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'), 'engine', asset('engine.js')));
  for (const edit of [true, false]) {
    const page = await open(t, garden, { edit });
    const n = await page.evaluate(() => document.querySelectorAll('#deck > section.slide').length);
    await page.emulateMedia({ media: 'print' });
    const first = await page.evaluate(() => { const r = document.querySelector('#deck > section.slide').getBoundingClientRect(); return [r.left, r.top]; });
    assert.deepEqual(first, [0, 0], `first slide at the top left (${edit ? 'edit' : 'read'} mode)`);
    const pdf = await page.pdf({ width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
    assert.equal(pages(pdf), n, `${edit ? 'edit' : 'read'} mode: ${n} slides`);
  }
});

// ---- C9: slide identifiers ----
test('an id-less slide gets a free id, and undo on the next slide restores that slide', async t => {
  const file = deck('ids', [S('s01', '<h1 data-id="e1">One</h1>'), S(null, '<h1 data-id="e2">No id</h1>'), S('s02', '<h1 data-id="e3">Two</h1>')]);
  const page = await open(t, file);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#deck > section.slide')].map(s => s.id));
  assert.equal(new Set(ids).size, 3, ids.join(','));
  assert.deepEqual([ids[0], ids[2]], ['s01', 's02'], 'existing ids are kept');
  await page.evaluate(() => document.querySelector('[data-id="e3"]').scrollIntoView());
  await typeInto(page, '[data-id="e3"]', ' edited');
  await undoKey(page);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#deck > section.slide > h1')].map(h => h.textContent)), ['One', 'No id', 'Two']);
});

// ---- C10: small ones ----
test('Cancel on "Slide deleted" restores the slide even after a later edit', async t => {
  const file = deck('cancel', [S('s01', '<h1 data-id="e1">One</h1>'), S('s02', '<h1 data-id="e2">Two</h1>')]);
  const page = await open(t, file);
  await page.evaluate(() => document.querySelector('#s02').scrollIntoView());
  await page.locator('#s02 > h1').click();
  await slideMenu(page, 'Delete slide');
  await page.waitForFunction(() => !document.querySelector('#s02'));
  await page.locator('#s01 > h1').dblclick();
  await page.keyboard.press('End');
  await page.keyboard.type(' kept');
  await page.locator('.hs-banner button', { hasText: 'Cancel' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#deck > section.slide').length === 2);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#deck > section.slide > h1')].map(h => h.textContent)), ['One kept', 'Two']);
});

test('the editor has no French UI text', () => {
  const engine = asset('engine.js');
  for (const word of ["Cliquez", "d'abord", 'diapositive']) assert.ok(!engine.includes(word), word);
});

test('a chart insertion retries ECharts after a failed load', async t => {
  const file = deck('retry', [S('s01', '<h1 data-id="e1">Title</h1>')]);
  let fail = true;
  const page = await open(t, file, { offline: () => fail });
  const insert = async () => {
    await page.getByRole('toolbar', { name: 'Slide and selection' }).getByRole('button', { name: 'Chart', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Columns' }).click();
  };
  await insert();
  await page.waitForFunction(() => /requires ECharts/.test(document.querySelector('.hs-banner')?.textContent ?? ''));
  fail = false;
  await insert();
  await page.waitForFunction(() => document.querySelector('#deck figure.chart'), null, { timeout: 15000 });
});
