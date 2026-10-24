// Editor shell (U04-Slides, variant A of ADR-011 §7) in a headless browser: every menu entry and
// toolbar button does something, keyboard model, 320–1440 px, print, and a fresh shell on reopening.
// Usage : node tests/shell.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright, ASSETS, upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deck = path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const tmp = path.join(ROOT, 'work/.shell-copy.html');
const saved = path.join(ROOT, 'work/.shell-saved.html');
fs.writeFileSync(tmp, upgrade(fs.readFileSync(deck, 'utf8')));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

// Save, print and the image file picker are counted instead of opening browser dialogs.
const stubs = () => {
  window.__saves = 0; window.__prints = 0; window.__files = 0;
  window.print = () => { window.__prints++; };
  window.showSaveFilePicker = async () => { window.__saves++; return { name: 'saved.html', createWritable: async () => ({ write: async () => {}, close: async () => {} }) }; };
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === 'file') window.__files++; else click.call(this); };
};
async function open({ width = 1280, height = 860, file = tmp, stub = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  if (stub) await ctx.addInitScript(stubs);
  const page = await ctx.newPage();
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  return { ctx, page, errs };
}
const toolbar = page => page.getByRole('toolbar', { name: 'Slide and selection' });
const tool = (page, name) => toolbar(page).getByRole('button', { name, exact: true });

// Selection states in which menus and toolbar are exercised.
const STATES = {
  reading: async () => {},
  slide: async page => { await page.keyboard.press('e'); await page.locator('#s06').scrollIntoViewIfNeeded(); await page.locator('#s06 > .sticker').click(); await page.keyboard.press('Escape'); },
  chart: async page => { await page.keyboard.press('e'); await page.locator('#s04').scrollIntoViewIfNeeded(); await page.locator('#s04 > figure.chart').click({ position: { x: 200, y: 150 } }); },
  table: async page => { await page.keyboard.press('e'); await page.locator('#s08').scrollIntoViewIfNeeded(); await page.locator('#s08 > table').click({ position: { x: 30, y: 10 } }); },
  text: async page => { await page.keyboard.press('e'); await page.locator('#s05').scrollIntoViewIfNeeded(); await page.locator('#s05 > .body').click(); },
  formatted: async page => { await STATES.text(page); await page.keyboard.press('Control+b'); },
  history: async page => {
    await page.keyboard.press('e'); await page.locator('#s02').scrollIntoViewIfNeeded(); await page.locator('#s02 > .body').click();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+b'); await page.keyboard.press('Control+z');
  },
  several: async page => {
    await page.keyboard.press('e'); await page.locator('#s05').scrollIntoViewIfNeeded();
    const b = await page.locator('#s05').boundingBox(), k = b.width / 1280;
    await page.mouse.move(b.x + 6 * k, b.y + 6 * k); await page.mouse.down();
    await page.mouse.move(b.x + 640 * k, b.y + 400 * k, { steps: 5 }); await page.mouse.move(b.x + 1274 * k, b.y + 714 * k, { steps: 5 }); await page.mouse.up();
  }
};
// Everything a command can change: the saved deck, modes, panels, popovers, banners, file actions, selection.
const signature = page => page.evaluate(() => JSON.stringify({
  html: window.deckEngine.serialize(), body: document.body.className, sel: window.deckEngine.selection(),
  panels: [...document.querySelectorAll('.hs-panel h2')].map(e => e.textContent),
  pops: [...document.querySelectorAll('.sh-pop, .sh-pop [aria-label]')].map(e => e.getAttribute('aria-label')),
  banner: document.querySelector('.hs-banner')?.textContent || '', files: [window.__saves, window.__prints, window.__files]
}));
async function setup(state) {
  const o = await open();
  await STATES[state](o.page);
  await o.page.waitForTimeout(150);
  return o;
}
const menuNames = ['File', 'Edit', 'Insert', 'Format', 'Slide', 'Arrange', 'Table', 'View', 'Help'];
const listMenu = async (page, name) => {
  await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
  const items = await page.locator('.sh-pop [role^=menuitem]').evaluateAll(els => els.map(e => ({
    name: e.querySelector('.sh-mlabel').textContent, role: e.getAttribute('role'),
    disabled: e.getAttribute('aria-disabled') === 'true', checked: e.getAttribute('aria-checked') === 'true' })));
  await page.keyboard.press('Escape');
  return items;
};

// 1. Menus: every listed entry is a working command (it changes something when enabled).
{
  const seen = new Map(); // "Menu › item" → verified
  for (const state of Object.keys(STATES).filter(s => s !== 'reading')) {
    let o = await setup(state);
    const lists = {};
    for (const m of menuNames) lists[m] = await listMenu(o.page, m);
    await o.ctx.close();
    for (const m of menuNames) for (const it of lists[m]) {
      const id = `${m} › ${it.name}`;
      if (!seen.has(id)) seen.set(id, false);
      if (seen.get(id) || it.disabled || (it.role === 'menuitemradio' && it.checked)) continue;
      o = await setup(state);
      const before = await signature(o.page);
      await o.page.getByRole('menubar').getByRole('menuitem', { name: m, exact: true }).click();
      await o.page.locator(`.sh-pop [role=${it.role}]`).filter({ has: o.page.locator('.sh-mlabel').getByText(it.name, { exact: true }) }).click();
      await o.page.waitForTimeout(250);
      const after = await signature(o.page);
      seen.set(id, before !== after);
      if (before === after) console.log(`      ${id} did nothing in state "${state}"`);
      if (o.errs.length) ok(false, `${id}: no JavaScript error (${o.errs.join(' | ')})`);
      await o.ctx.close();
    }
  }
  const inert = [...seen].filter(([, v]) => !v).map(([k]) => k);
  ok(seen.size >= 60 && inert.length === 0, `every menu entry works in some state (${seen.size} entries)` + (inert.length ? ': inert ' + inert.join(', ') : ''));
}

// 2. Toolbar, file bar and settings bar: every enabled visible button works too.
{
  const seen = new Map();
  const visibleButtons = page => page.locator('.hs-shell button, .hs-float button').evaluateAll(bs => bs
    .filter(b => b.offsetParent && !b.disabled && !b.closest('[role=menubar]') && !b.classList.contains('sh-ovf'))
    .map(b => b.getAttribute('aria-label') || b.textContent.trim()));
  for (const state of Object.keys(STATES)) {
    let o = await setup(state);
    const names = await visibleButtons(o.page);
    await o.ctx.close();
    for (const name of names) {
      if (seen.get(name)) continue;
      o = await setup(state);
      const before = await signature(o.page);
      await o.page.locator('.hs-shell button, .hs-float button').filter({ visible: true })
        .and(o.page.getByRole('button', { name, exact: true })).first().click();
      await o.page.waitForTimeout(250);
      const after = await signature(o.page);
      seen.set(name, before !== after);
      if (before === after) console.log(`      button "${name}" did nothing in state "${state}"`);
      await o.ctx.close();
    }
  }
  const inert = [...seen].filter(([, v]) => !v).map(([k]) => k);
  ok(seen.size > 30 && inert.length === 0, `every chrome button works (${seen.size} buttons)` + (inert.length ? ': inert ' + inert.join(', ') : ''));
}

// 3. Keyboard: menu bar, menus, toolbar roving focus, focus return, shortcuts kept for the slides.
{
  const { ctx, page, errs } = await setup('text');
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a.querySelector?.('.sh-mlabel')?.textContent || a.getAttribute('aria-label') || a.textContent.trim(); });
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).focus();
  await page.keyboard.press('ArrowRight');
  ok(await focused() === 'Edit', 'menu bar: Right moves to the next menu');
  await page.keyboard.press('ArrowDown');
  ok(await focused() === 'Undo' || await focused() === 'Duplicate', `menu bar: Down opens the menu on its first enabled entry (${await focused()})`);
  await page.keyboard.press('ArrowRight');
  ok(await page.locator('.sh-pop [aria-label=Insert]').count() === 1, 'inside a menu, Right switches to the next menu');
  await page.keyboard.press('Escape');
  ok(await page.locator('.sh-pop').count() === 0 && await focused() === 'Insert', 'Escape closes the menu and returns focus to its trigger');
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Arrange' }).press('Enter');
  await page.keyboard.press('c');
  ok(await focused() === 'Centre horizontally', 'menus support type-ahead');
  await page.keyboard.press('Escape');
  const stops = await toolbar(page).locator('button').evaluateAll(bs => bs.filter(b => b.tabIndex === 0 && b.offsetParent).length);
  ok(stops === 1, `the toolbar is one tab stop (${stops})`);
  await tool(page, 'Text box').focus();
  const x0 = await page.evaluate(() => document.querySelector('#s05 > .body').getAttribute('style'));
  await page.keyboard.press('End');
  ok(await focused() === 'Delete element', `End reaches the last toolbar command (${await focused()})`);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  ok(await focused() === 'Shape' && await page.evaluate(() => document.querySelector('#s05 > .body').getAttribute('style')) === x0,
    'arrow keys move within the toolbar and do not nudge the selected element');
  await tool(page, 'Larger text').focus();
  await page.keyboard.press('Enter');
  ok(/fs-/.test(await page.locator('#s05 > .body').getAttribute('class')) && await page.evaluate(() => !document.querySelector('#s05 > .body').isContentEditable),
    'Enter on a toolbar button runs it instead of starting to type');
  await tool(page, 'Text colour').press('Enter');
  ok(await page.evaluate(() => document.activeElement.getAttribute('role')) === 'radio', 'a picker opened from the keyboard takes focus');
  await page.keyboard.press('Escape');
  ok(await focused() === 'Text colour', 'Escape returns focus to the picker button');
  // pointer use of a menu leaves focus on the canvas: Delete removes the inserted shape
  await tool(page, 'Shape').click();
  await page.getByRole('menuitem', { name: 'Ellipse' }).click();
  const n = await page.locator('#s05 > .shape').count();
  await page.keyboard.press('Delete');
  ok(n === 1 && await page.locator('#s05 > .shape').count() === 0, 'after a pointer menu choice, Delete acts on the inserted element');
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Edit mode' }).press('Enter');
  ok(await page.evaluate(() => !document.body.classList.contains('hs-editing') && document.activeElement.textContent.trim() === 'Edit'),
    'leaving edit mode from the keyboard moves focus to the Edit button of the settings bar');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => document.body.classList.contains('hs-editing') && document.activeElement.textContent.trim() === 'Done'),
    'and Edit brings it back to Done');
  const labels = await page.locator('.hs-shell button, .hs-float button, .hs-side button').evaluateAll(bs =>
    bs.filter(b => !(b.getAttribute('aria-label') || b.textContent.trim())).length);
  ok(labels === 0, 'every chrome button has an accessible name');
  ok(errs.length === 0, 'no JavaScript error' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}

// 4. Widths: no page-level horizontal scroll, menus collapse into ☰ below 720 px, thumbnails become a strip.
for (const width of [320, 375, 414, 719, 720, 768, 1024, 1280, 1440]) {
  const { ctx, page, errs } = await open({ width, height: 800 });
  const measure = () => page.evaluate(() => {
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const f = document.querySelector('.hs-float').getBoundingClientRect(), side = document.querySelector('.hs-side').getBoundingClientRect();
    const slide = document.querySelector('#s01').getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, menubar: vis(document.querySelector('[role=menubar]')),
      burger: vis(document.querySelector('.hs-shell .sh-only-narrow')), float: f.left >= 0 && f.right <= innerWidth && f.bottom <= innerHeight,
      strip: side.width > side.height, slide: slide.left >= 0 && slide.right <= innerWidth + 0.5,
      bar: Math.round(document.querySelector('.hs-shell').getBoundingClientRect().height),
      tb: document.querySelector('.hs-tb').scrollWidth <= document.querySelector('.hs-tb').clientWidth + 1 };
  });
  const r = await measure();
  await page.keyboard.press('e');
  await page.locator('#s05 > .body').click();
  const e = await measure();
  const narrow = width < 720;
  ok(r.scroll <= 0 && e.scroll <= 0 && r.float && e.float && e.slide && e.tb && e.menubar === !narrow && e.burger === narrow && e.strip === narrow && e.bar === 84,
    `${width} px: no page scroll, settings bar on screen, ${narrow ? '☰ menu and thumbnail strip' : 'menu bar and thumbnail column'} (${JSON.stringify(e)})`);
  if (narrow) {
    await page.locator('.hs-shell .sh-only-narrow button').click();
    const heads = await page.locator('.sh-pop .sh-mhead').allTextContents();
    ok(heads.filter(t => menuNames.includes(t)).join() === menuNames.join(), `${width} px: ☰ lists every menu (${heads.join(', ')})`);
    await page.keyboard.press('Escape');
  }
  ok(errs.length === 0, `${width} px: no JavaScript error` + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}

// 5. Print hides all chrome, in reading and edit modes, even with a menu open.
{
  const { ctx, page } = await setup('text');
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Arrange' }).click();
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() => [...document.querySelectorAll('.sh-root, .sh-pop, .hs-side, .hs-banner, .moveable-control-box')]
    .filter(el => getComputedStyle(el).display !== 'none').map(el => el.className));
  const slides = await page.evaluate(() => [...document.querySelectorAll('#deck > .slide')].every(s => getComputedStyle(s).display !== 'none'));
  ok(shown.length === 0 && slides, 'print shows the slides and hides the chrome' + (shown.length ? ': ' + shown.join(', ') : ''));
  await ctx.close();
}

// 6. Saved file: no shell state; reopening gives a fresh shell in reading mode.
{
  const { ctx, page } = await open({ stub: false });
  await page.keyboard.press('e');
  await page.locator('#s05 > .body').click();
  await page.keyboard.press('Control+b');
  await tool(page, 'Text colour').click();
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Slide' }).click();
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await (await dl).saveAs(saved);
  await ctx.close();
  const html = fs.readFileSync(saved, 'utf8');
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script id="engine"'));
  ok(/t-bold/.test(html) && !/class="[^"]*\bsh-|role="(menubar|toolbar|menu)"|hs-shell|hs-float|hs-side|hs-editing|aria-expanded/.test(body),
    'the saved deck holds the edit and no shell markup or state');
  const o = await open({ file: saved });
  const fresh = await o.page.evaluate(() => ({
    shells: document.querySelectorAll('.hs-shell').length, floats: document.querySelectorAll('.hs-float').length, pops: document.querySelectorAll('.sh-pop').length,
    editing: document.body.classList.contains('hs-editing'),
    reading: [...document.querySelectorAll('.hs-float button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label') || b.textContent.trim())
  }));
  ok(fresh.shells === 1 && fresh.floats === 1 && fresh.pops === 0 && !fresh.editing && fresh.reading.join() === 'Edit,Present,Print or save as PDF',
    `reopening gives one fresh shell in reading mode (${JSON.stringify(fresh)})`);
  await o.ctx.close();
}

await browser.close();
fs.rmSync(tmp); fs.rmSync(saved, { force: true });
console.log(fails ? `\n${fails} failure(s)` : '\nAll tests pass.');
process.exit(fails ? 1 : 0);
