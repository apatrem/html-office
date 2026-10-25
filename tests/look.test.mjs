// Deck theme and font (TH02) in a headless browser: the document-settings panel applies a built-in
// charte and a body font as main#deck attributes, undo and redo restore them, charts and thumbnails
// follow, the saved file carries the attributes but no shell state, drafts and print keep them.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ASSETS, asset, setZone, zone } from '../plugin/skills/html-slides/tools/lib.mjs';
import { CHARTES } from '../packages/shared/themes/chartes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(root, 'work/look-'));
const deck = path.join(dir, 'garden.html');
const original = setZone(fs.readFileSync(path.join(root, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'), 'engine', asset('engine.js'));
let browser;
before(async () => { fs.writeFileSync(deck, original); browser = await chromium.launch(); });
after(async () => { await browser?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function open(t, file = deck, { edit = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  t.after(() => assert.deepEqual(errors, [], 'no JavaScript error'));
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  if (edit) await page.keyboard.press('e');
  return page;
}
const panel = page => page.getByRole('region', { name: 'Document settings' });
const choose = async (page, group, name) => panel(page).getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true }).click();
// What the deck looks like: attributes, tokens where slides and thumbnails read them, fonts, chart colours.
const looks = page => page.evaluate(() => {
  const css = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
  const deck = document.getElementById('deck'), chart = document.querySelector('#s04 > figure.chart .hs-plot svg');
  const thumb = document.querySelector('.hs-mini > .slide');
  return { theme: deck.dataset.theme ?? null, font: deck.dataset.font ?? null, root: document.documentElement.dataset.theme ?? null,
    acc: css(document.querySelector('#s04'), '--acc'), thumb: thumb ? css(thumb, '--acc') : null,
    body: css(document.querySelector('#s05 > .body'), 'font-family'), title: css(document.querySelector('#s05 > h1'), 'font-family'),
    chart: chart ? chart.innerHTML : '', charte: document.getElementById('charte').textContent };
});
const has = (svg, hex) => svg.toLowerCase().includes(hex.toLowerCase());

test('the settings bar opens document settings; a theme and a font apply, undo and redo restore them', async t => {
  const p = await open(t);
  const before = await looks(p);
  assert.equal(before.theme, null);
  assert.equal(before.acc, CHARTES.blue.acc);
  await p.locator('.hs-float').getByRole('button', { name: 'Theme & font' }).click();
  await assert.doesNotReject(panel(p).waitFor());
  assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Document settings', 'the panel takes focus on its heading');
  assert.equal(await panel(p).getByRole('radio', { name: /Document charte/ }).getAttribute('aria-checked'), 'true');

  await choose(p, 'Theme', 'Red');
  let now = await looks(p);
  assert.equal(now.theme, 'red');
  assert.equal(now.root, 'red', 'the theme is mirrored on the root element');
  assert.equal(now.acc, CHARTES.red.acc, 'slides take the red charte');
  assert.equal(now.thumb, CHARTES.red.acc, 'thumbnails follow');
  assert.ok(has(now.chart, CHARTES.red.acc) && !has(now.chart, CHARTES.blue.acc), 'charts are redrawn in the theme colours');
  assert.equal(now.charte, before.charte, 'style#charte is never rewritten');

  await choose(p, 'Document font', 'Georgia');
  now = await looks(p);
  assert.equal(now.font, 'georgia');
  assert.match(now.body, /^Georgia/, 'the body takes the font');
  assert.equal(now.title, before.title, 'titles keep the charte font');
  assert.match(now.chart, /Georgia/, 'chart text takes the body font');

  await p.keyboard.press('Control+z');
  now = await looks(p);
  assert.equal(now.font, null, 'undo removes the font');
  assert.equal(now.theme, 'red');
  assert.equal(now.body, before.body);
  assert.equal(await panel(p).getByRole('radio', { name: /Charte font/ }).getAttribute('aria-checked'), 'true', 'the open panel follows undo');
  await p.keyboard.press('Control+z');
  now = await looks(p);
  assert.equal(now.theme, null, 'undo restores the document charte');
  assert.equal(now.root, null);
  assert.equal(now.acc, CHARTES.blue.acc);
  assert.ok(has(now.chart, CHARTES.blue.acc) && !has(now.chart, CHARTES.red.acc), 'charts go back to the document colours');
  await p.keyboard.press('Control+Shift+z');
  assert.equal((await looks(p)).theme, 'red', 'redo applies the theme again');
  assert.equal(await panel(p).getByRole('radio', { name: /Red/ }).getAttribute('aria-checked'), 'true');

  await choose(p, 'Theme', 'Document charte');
  assert.equal((await looks(p)).theme, null, '"Document charte" removes the attribute');
  assert.doesNotMatch(await p.evaluate(() => window.deckEngine.serialize()), /<main[^>]*data-theme/);
  await p.keyboard.press('Escape');
  assert.equal(await panel(p).count(), 0, 'Escape closes the panel');
  assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), 'Theme & font', 'focus returns to its button');
});

test('File › Document settings… opens the panel; leaving edit mode closes it and hides the button', async t => {
  const p = await open(t);
  await p.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await p.locator('.sh-pop [role=menuitem]').filter({ hasText: 'Document settings…' }).click();
  await panel(p).waitFor();
  await panel(p).getByRole('button', { name: 'Footer…' }).click();
  assert.equal(await p.locator('.hs-panel h2').textContent(), 'Footer', 'the panel opens the footer settings');
  await p.locator('.hs-panel input').first().fill('Garden footer');
  await p.locator('.hs-panel button', { hasText: 'Apply' }).click();
  assert.match(await panel(p).locator('.hs-footer-line').textContent(), /Garden footer/);
  await p.keyboard.press('e');
  assert.equal(await panel(p).count(), 0);
  assert.equal(await p.locator('.hs-float').getByRole('button', { name: 'Theme & font' }).isVisible(), false);
});

test('a saved deck carries data-theme and data-font on main#deck but no shell state; reopening applies them', async t => {
  const p = await open(t);
  await p.locator('.hs-float').getByRole('button', { name: 'Theme & font' }).click();
  await choose(p, 'Theme', 'Green');
  await choose(p, 'Document font', 'Verdana');
  const file = path.join(dir, 'saved.html');
  await p.evaluate(() => { delete window.showSaveFilePicker; });
  const download = p.waitForEvent('download');
  await p.keyboard.press('Control+s');
  await (await download).saveAs(file);
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<main id="deck" data-footer="[^"]*" data-theme="green" data-font="verdana">/);
  assert.match(html, /<html lang="en">/, 'the root mirror is not saved');
  assert.equal(zone(html, 'charte'), zone(original, 'charte'), 'style#charte is unchanged');
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script id="engine"'));
  assert.doesNotMatch(body, /sh-drawer|hs-drawer|sh-panel|aria-pressed|sh-drawer-open/, 'no panel markup or state');
  const cache = html.match(/<figure\b[^>]*data-type="waterfall"[\s\S]*?<svg\b[^>]*class="render"[\s\S]*?<\/svg>/)[0];
  assert.ok(has(cache, CHARTES.green.acc), 'the saved chart preview has the theme colours');

  const q = await open(t, file, { edit: false });
  const now = await looks(q);
  assert.deepEqual([now.theme, now.font, now.root, now.acc], ['green', 'verdana', 'green', CHARTES.green.acc]);
  assert.match(now.body, /^Verdana/);
  assert.equal(await q.locator('.sh-drawer:not([hidden])').count(), 0, 'reopening shows no panel');
  // print: the chrome is hidden, the slides keep the theme
  await q.emulateMedia({ media: 'print' });
  const print = await q.evaluate(() => ({ acc: getComputedStyle(document.querySelector('#s04')).getPropertyValue('--acc').trim(),
    chrome: [...document.querySelectorAll('.sh-root, .sh-drawer')].filter(el => getComputedStyle(el).display !== 'none').length }));
  assert.deepEqual(print, { acc: CHARTES.green.acc, chrome: 0 });
});

test('a draft keeps the theme and font', async t => {
  const p = await open(t);
  await p.locator('.hs-float').getByRole('button', { name: 'Theme & font' }).click();
  await choose(p, 'Theme', 'Black');
  await choose(p, 'Document font', 'Times New Roman');
  await p.reload();
  await p.waitForFunction(() => window.deckEngine);
  assert.equal((await looks(p)).theme, null, 'the file itself is unchanged');
  await p.locator('.hs-banner button', { hasText: 'Restore' }).click();
  const now = await looks(p);
  assert.deepEqual([now.theme, now.font, now.root, now.acc], ['black', 'times', 'black', CHARTES.black.acc]);
  await p.evaluate(() => localStorage.clear());
});
