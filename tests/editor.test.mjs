// End-to-end editor test (Playwright, headless browser), at a scale < 1.
// Usage : node tests/editor.test.mjs [deck.html]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright, ASSETS, upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'));
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const tmp = path.join(ROOT, 'work/.test-copy.html');
const saved = path.join(ROOT, 'work/.test-saved.html');
const copyDeck = f => fs.writeFileSync(tmp, upgrade(fs.readFileSync(f,'utf8')));
copyDeck(file);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => opts.offline ? r.abort()
    : r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'), contentType: 'application/javascript', headers:{'access-control-allow-origin':'*'} }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(pathToFileURL(tmp).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  return { ctx, page, errs };
}
const attr = (page, sel, a) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n), [sel, a]);
const pos = async (page, sel) => {
  const st = await attr(page, sel, 'style') || '';
  return Object.fromEntries([...st.matchAll(/--(\w):(-?[\d.]+)/g)].map(m => [m[1], Number(m[2])]));
};
async function dragBy(page, sel, dx, dy, { alt = false, at = [30, 15] } = {}) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + at[0], b.y + at[1]);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(b.x + at[0] + dx / 2, b.y + at[1] + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + at[0] + dx, b.y + at[1] + dy, { steps: 4 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

// 0. Detaching a slide must not change its rendering (typography, line breaks, positions)
for (const deck of [file, path.join(ROOT, 'plugin/skills/html-slides/examples/catalogue.html')]) {
  copyDeck(deck);
  const o = await open();
  const diffs = await o.page.evaluate(() => {
    const out = [];
    const props = ['fontSize', 'fontWeight', 'fontStyle', 'color', 'letterSpacing', 'textTransform', 'lineHeight', 'backgroundColor'];
    document.querySelectorAll('main#deck > section.slide').forEach(slide => {
      const items = [...slide.children].filter(el => el.dataset.id);
      const all = items.flatMap(el => [el, ...el.querySelectorAll('*:not(svg *):not([data-ui] *)')]).filter(n => !n.closest('[data-ui], svg'));
      const k = slide.getBoundingClientRect().width / 1280, sr = slide.getBoundingClientRect();
      const snap = () => all.map(n => { const cs = getComputedStyle(n), r = n.getBoundingClientRect();
        return { st: props.map(p => cs[p]).join('|'), x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, h: r.height / k }; });
      const a = snap();
      const pos = items.map(el => { const r = el.getBoundingClientRect(); return [el, (r.left - sr.left) / k, (r.top - sr.top) / k, Math.ceil(r.width / k - 0.01) + 1, Math.ceil(r.height / k - 0.01)]; });
      slide.setAttribute('data-detached', '');
      pos.forEach(([el, x, y, w, h]) => el.setAttribute('style', `--x:${Math.round(x)};--y:${Math.round(y)};--w:${w};--h:${h}`));
      const b = snap();
      a.forEach((v, i) => {
        const n = all[i], w = b[i], tag = `${slide.id} ${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}`;
        if (v.st !== w.st) out.push(`${tag}: style ${v.st} → ${w.st}`);
        else if (Math.abs(v.h - w.h) > 1.5) out.push(`${tag}: height ${v.h.toFixed(0)} → ${w.h.toFixed(0)} (line break)`);
        else if (Math.abs(v.x - w.x) > 1.5 || Math.abs(v.y - w.y) > 1.5) out.push(`${tag}: position (${v.x.toFixed(0)},${v.y.toFixed(0)}) → (${w.x.toFixed(0)},${w.y.toFixed(0)})`);
      });
    });
    return out;
  });
  ok(diffs.length === 0, `detaching does not change the rendering (${path.basename(deck)})` + (diffs.length ? ':\n      ' + diffs.slice(0, 12).join('\n      ') : ''));
  await o.ctx.close();
}
copyDeck(file);

let { ctx, page, errs } = await open();
await page.keyboard.press('e');
const s = Number(await page.evaluate(() => getComputedStyle(document.getElementById('deck')).getPropertyValue('--s')));
ok(s < 1, `reduced scale for the test (${s})`);
ok(await page.evaluate(() => document.body.classList.contains('hs-editing')), 'edit mode enabled by E');

// 1. Free move (Alt): 100 screen px = 100 / scale in slide coordinates
await page.locator('#s04').scrollIntoViewIfNeeded();
await dragBy(page, '#s04 > h1', 100, 0, { alt: true });
ok(await page.evaluate(() => document.querySelector('#s04').hasAttribute('data-detached')), 'slide detached on first move');
let p = await pos(page, '#s04 > h1');
ok(near(p.x, 64 + 100 / s, 2), `exact move despite the scale (x = ${p.x}, expected ${(64 + 100 / s).toFixed(0)})`);

// 2. Snapped move: the position lands on the 8 px grid or on a guide
await dragBy(page, '#s04 > h1', -37, 13);
p = await pos(page, '#s04 > h1');
ok(Number.isInteger(p.x) && Number.isInteger(p.y), `snapped move (x = ${p.x}, y = ${p.y})`);

// 3. A simple click does not detach the slide
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > .body').click();
ok(await page.evaluate(() => !document.querySelector('#s05').hasAttribute('data-detached')), 'simple click: the slide keeps its layout');
ok(await page.evaluate(() => document.querySelectorAll('.moveable-control-box .moveable-control').length >= 8), 'Moveable handles shown');

// 4. Undo / redo
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
ok(await page.evaluate(() => !document.querySelector('#s04').hasAttribute('data-detached')), 'undo ×2: the slide gets its layout back');
await page.keyboard.press('Control+Shift+z');
ok(await page.evaluate(() => document.querySelector('#s04').hasAttribute('data-detached')), 'redo: the move comes back');

// 5. Resizing with the east handle
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > h1').click();
const w0 = (await pos(page, '#s04 > h1')).w;
await page.locator('.moveable-control.moveable-e').first().waitFor({state:'visible'});
const hb = await page.locator('.moveable-control.moveable-e').first().boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x - 60, hb.y + hb.height / 2, { steps: 6 });
await page.mouse.up();
const w1 = (await pos(page, '#s04 > h1')).w;
ok(w1 < w0 - 50, `resize (width ${w0} → ${w1})`);

// 6. Rectangle selection, then group move
await page.keyboard.press('Escape');
await page.locator('#s08').scrollIntoViewIfNeeded();
const sb = await page.locator('#s08').boundingBox();
await page.mouse.move(sb.x + 8 * s, sb.y + 200 * s);
await page.mouse.down();
await page.mouse.move(sb.x + 600 * s, sb.y + 400 * s, { steps: 6 });
await page.mouse.move(sb.x + 1272 * s, sb.y + 560 * s, { steps: 6 });
await page.mouse.up();
const selected = await page.evaluate(() => window.deckEngine.selection());
ok(selected.length >= 2, 'rectangle selects the table and its commentary');
const before = await page.evaluate(() => {
  const slide = document.querySelector('#s08'), sr = slide.getBoundingClientRect(), scale = sr.width / 1280;
  return ['table', '.callout'].map(sel => ({y: (slide.querySelector(sel).getBoundingClientRect().top - sr.top) / scale}));
});
await dragBy(page, '#s08 > table', 0, 40, { alt: true, at: [40, 40] });
const after = [await pos(page, '#s08 > table'), await pos(page, '#s08 > .callout')];
ok(after[0].y > before[0].y + 30 && after[1].y > before[1].y + 30, `group move (table y ${after[0].y}, callout y ${after[1].y})`);

// 7. Element formatting: size, fill, bold, clear
await page.keyboard.press('Escape');
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > .body').click();
const tb = sel => page.locator(`.hs-toolbar button[title^="${sel}"]`).first();
await tb('Increase text size').click();
await tb('Tinted fill').click();
await tb('Bold').click();
let cls = await attr(page, '#s05 > .body', 'class');
ok(/fs-/.test(cls) && /bg-tint/.test(cls) && /t-bold/.test(cls), `size, fill and bold applied (${cls})`);
await tb('Clear formatting').click();
cls = await attr(page, '#s05 > .body', 'class');
ok(!/fs-|bg-|t-bold/.test(cls), `formatting cleared (${cls})`);

// 8. Colour on part of the text
await page.locator('#s05 > .body').dblclick();
await page.evaluate(() => {
  const p = document.querySelector('#s05 > .body p:nth-of-type(2)');
  const t = p.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 8);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await tb('Alert').click();
await page.keyboard.press('Escape');
const html = await page.evaluate(() => document.querySelector('#s05 > .body').innerHTML);
ok(/<span class="c-alert">A shared<\/span>/.test(html), 'theme colour applied to a word');
ok(await page.evaluate(() => !document.querySelector('#s05 > .body').hasAttribute('contenteditable')), 'text mode exited');

// 9. In-place text
await page.locator('#s05 > .body').dblclick();
await page.keyboard.press('Control+End');
await page.keyboard.type(' Added test.');
await page.keyboard.press('Escape');
ok((await page.locator('#s05 > .body').textContent()).includes('Added test.'), 'text edited in place');

// 10. Waterfall data panel
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > figure.chart').click({ position: { x: 300, y: 200 } });
await page.locator('.hs-toolbar button', { hasText: 'Data' }).click();
ok(await page.locator('.hs-panel').isVisible(), 'data panel open');
await page.locator('.hs-panel table tr').nth(2).locator('input').nth(1).fill('40');
await page.locator('.hs-panel button', { hasText: 'Apply' }).click();
const items = await page.evaluate(() => JSON.parse(document.querySelector('#s04 figure.chart > script').textContent).items);
ok(items[1].value === 40, 'chart data updated (34 → 40)');

// 10b. Slides: new, duplicate, delete, move, layout, footer, undo
const nSlides = () => page.evaluate(() => document.querySelectorAll('main#deck > section.slide').length);
const n0 = await nSlides();
await page.locator('#s02').scrollIntoViewIfNeeded();
await page.locator('#s02 > .body').click();
await page.keyboard.press('Escape');
ok((await page.locator('.hs-toolbar .hs-cur').textContent()) === 'Slide 2', 'current slide shown in the bar (Slide 2)');
await page.locator('.hs-side .hs-add').click();
await page.locator('.hs-menu button', { hasText: 'Section divider' }).click();
let order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id + ':' + (s.dataset.layout || '')));
ok(await nSlides() === n0 + 1 && order[2].endsWith(':section'), `new section divider slide inserted after slide 2 (${order[2]})`);
const newId = order[2].split(':')[0];
ok(await page.evaluate(id => document.querySelector('#' + id + ' > .hs-foot span:last-child')?.textContent === '3', newId), 'page numbers recalculated');
await page.keyboard.press('Control+z');
ok(await nSlides() === n0, 'undo: the new slide disappears');
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > .stack').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Escape');
await page.locator('.hs-ctx button[title="Duplicate the current slide"]').click();
await page.waitForTimeout(200);
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
const dup = order[order.indexOf('s04') + 1];
ok(await nSlides() === n0 + 1 && await page.evaluate(id => document.querySelector('#' + id + ' figure.chart')?.classList.contains('live'), dup), `slide duplicated with its chart (${dup})`);
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].map(e => e.dataset.id));
ok(new Set(ids).size === ids.length, 'identifiers unique after duplication');
// thumbnails: one per slide, drag and drop to reorder
await page.waitForTimeout(100);
const nThumbs = await page.locator('.hs-side .hs-thumb').count();
ok(nThumbs === n0 + 1, `thumbnails on the left (${nThumbs})`);
const thumbOf = id => page.locator('.hs-side .hs-thumb').nth(order.indexOf(id));
await thumbOf(dup).dragTo(thumbOf('s04'), { targetPosition: { x: 80, y: 10 } });
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
ok(order.indexOf(dup) === order.indexOf('s04') - 1, 'slide moved by dragging its thumbnail');
await page.keyboard.press('Control+z');
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
ok(order.indexOf(dup) === order.indexOf('s04') + 1, 'undo: original order');
await page.locator('.hs-side .hs-thumb').nth(2).click();
ok((await page.locator('.hs-ctx .hs-cur').textContent()) === 'Slide 3', 'thumbnail click: slide 3 current');
await page.locator('.hs-side .hs-thumb').nth(order.indexOf(dup)).click();
await page.locator('.hs-ctx button[title="Delete the current slide"]').click();
ok(await nSlides() === n0, 'slide deleted');
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > h1').click();
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Layout', exact: true }).click();
await page.locator('.hs-menu button', { hasText: 'Panel 1/3' }).click();
ok(await attr(page, '#s05', 'data-layout') === 'panel-13', 'layout changed (panel 1/3)');
await page.keyboard.press('Control+z');
ok(await attr(page, '#s05', 'data-layout') === 'default', 'undo: original layout');
await page.locator('.hs-ctx button', { hasText: 'Footer' }).click();
await page.locator('.hs-panel input').first().fill('My footer');
await page.locator('.hs-panel input[type=checkbox]').check();
await page.locator('.hs-panel button', { hasText: 'Apply' }).click();
ok(await page.evaluate(() => document.getElementById('deck').dataset.footer) === 'My footer'
  && await page.evaluate(() => !document.querySelector('#s05 > .hs-foot') && document.querySelector('#s04 > .hs-foot span').textContent === 'My footer'),
  'footer changed, hidden on the current slide');

// 10c. Inserting elements
const before5 = await page.evaluate(() => document.querySelectorAll('#s05 > [data-id]').length);
await page.locator('.hs-top button', { hasText: 'Block' }).click();
await page.locator('.hs-menu button', { hasText: 'Tinted box' }).click();
await page.keyboard.type('New box');
await page.keyboard.press('Escape');
const box = await page.evaluate(() => { const b = [...document.querySelectorAll('#s05 > .box')].pop(); return b && { t: b.textContent, d: document.querySelector('#s05').hasAttribute('data-detached'), st: b.getAttribute('style') }; });
ok(box && box.t === 'New box' && box.d && /--x/.test(box.st), `box inserted, positioned and typed (${box && box.st})`);
await page.locator('.hs-top button', { hasText: 'Chart' }).click();
await page.locator('.hs-menu button', { hasText: 'Waterfall' }).click();
ok(await page.locator('.hs-panel').isVisible(), 'chart inserted: data panel open');
await page.locator('.hs-panel button', { hasText: 'Cancel' }).click();
ok(await page.evaluate(() => !!document.querySelector('#s05 > figure.chart[data-type=waterfall].live')), 'waterfall inserted and drawn');
page.once('dialog', d => d.accept('Test logo'));
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 100; c.getContext('2d').fillRect(0, 0, 200, 100);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.deckEngine.insertImageFile(new File([blob], 'logo.png', { type: 'image/png' }));
});
const img = await page.evaluate(() => { const i = document.querySelector('#s05 > img[data-asset]'); return i && { alt: i.alt, w: i.naturalWidth, a: JSON.parse(document.getElementById('assets').textContent)[i.dataset.asset]?.type }; });
ok(img && img.alt === 'Test logo' && img.w === 200 && /image\/(webp|jpeg)/.test(img.a), `image inserted and embedded (${img && img.a})`);
ok(await page.evaluate(() => document.querySelectorAll('#s05 > [data-id]').length) === before5 + 3, 'box, chart and image added (the slide already had a source)');

// 10d. Image removed by undo: absent from the saved file, back after redo
const assetOf = () => page.evaluate(() => document.querySelector('#s05 > img[data-asset]')?.dataset.asset);
const aid = await assetOf();
const hasAsset = id => page.evaluate(id => id in JSON.parse(window.deckEngine.serialize().match(/<script id="assets" type="application\/json">([\s\S]*?)<\/script>/)[1]), id);
ok(await hasAsset(aid), 'image present in the saved file');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
ok(!(await assetOf()) && !(await hasAsset(aid)), 'image undone: removed from the saved file');
await page.keyboard.press('Control+Shift+z');
ok((await assetOf()) === aid && await page.evaluate(() => document.querySelector('#s05 > img').naturalWidth === 200), 'redo: the image comes back (kept in memory)');

// 10e. Shapes
await page.keyboard.press('Escape');
const pad0 = await page.evaluate(() => document.getElementById('deck').style.paddingTop);
await page.locator('.hs-top button', { hasText: 'Shape' }).click();
await page.locator('.hs-menu button', { hasText: 'Chevron' }).click();
const shape = await page.evaluate(() => { const e = [...document.querySelectorAll('#s05 > .shape')].pop(); return e && { k: e.dataset.shape, st: e.getAttribute('style'), clip: getComputedStyle(e).clipPath, sel: window.deckEngine.selection().includes(e.dataset.id) }; });
ok(shape && shape.k === 'chevron' && /--w:216/.test(shape.st) && shape.clip.startsWith('polygon') && shape.sel, `chevron inserted and selected (${shape && shape.st})`);
ok(await page.evaluate(() => document.getElementById('deck').style.paddingTop) === pad0, 'the context bar does not shift the slides');
await page.locator('.hs-ctx button[title="Mid blue fill"]').click();
await page.locator('#s05 > .shape').last().dblclick();
await page.keyboard.type('Phase 1');
await page.keyboard.press('Escape');
const sh2 = await page.evaluate(() => { const e = [...document.querySelectorAll('#s05 > .shape')].pop(); return { c: e.className, t: e.textContent }; });
ok(/bg-mid/.test(sh2.c) && sh2.t === 'Phase 1', `shape filled and labelled (${sh2.c} "${sh2.t}")`);

// 10f. Table: rows and columns
await page.keyboard.press('Escape');
await page.locator('.hs-top button', { hasText: 'Table' }).click();
await page.keyboard.press('Escape');
const tsel = '#s05 > table.t:last-of-type';
const dims = () => page.evaluate(s => { const t = [...document.querySelectorAll('#s05 > table.t')].pop(); return [t.rows.length, t.rows[0].cells.length, t.rows[2].cells[0].textContent]; }, tsel);
const d0 = await dims();
ok(await page.evaluate(() => document.querySelector('.hs-ctx').classList.contains('has-table')), 'table selected: table tools shown');
await page.locator('#s05 > table.t').last().dblclick({ position: { x: 20, y: 40 } });
await page.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table.t')].pop(); const c = t.rows[1].cells[0]; const r = document.createRange(); r.selectNodeContents(c); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await page.locator('.hs-ctx button[title^="Insert a row"]').click();
await page.keyboard.type('New row');
const typed = (await dims())[2];
await page.locator('.hs-ctx button[title="Delete the current column"]').click();
await page.keyboard.press('Escape');
const d1 = await dims();
ok(d1[0] === d0[0] + 1 && d1[1] === d0[1] - 1 && typed === 'New row', `row added below the current row and typed, column deleted (${d0.slice(0, 2)} → ${d1.slice(0, 2)}, "${typed}")`);
await page.keyboard.press('Control+z');
const d2 = await dims();
ok(d2[0] === d0[0] && d2[1] === d0[1], 'undo: original table');
await page.keyboard.press('Control+Shift+z');

// 11. Clean serialisation
const out = await page.evaluate(() => window.deckEngine.serialize());
const mainZone = out.match(/<main[\s\S]*?<\/main>/)[0];
// The guide may mention the interface: check saved elements, not the words of its documentation.
const runtimeNodes = await page.evaluate(html => {
  const d = new DOMParser().parseFromString(html,'text/html');
  return d.querySelectorAll('[data-ui],.hs-toolbar,.selecto-selection,[class*="moveable"],[class*="selecto"]').length;
}, out);
ok(runtimeNodes === 0, 'no Moveable, Selecto or interface in the saved file');
ok(!/contenteditable|class="[^"]*\blive\b/.test(mainZone) && !/<main[^>]*style=/.test(mainZone), 'no editing state saved');
ok((mainZone.match(/<svg[^>]*class="render"/g) || []).length >= 4 && /<script id="engine"/.test(out), 'cached SVGs and engine present');
ok((out.match(/<style\b/g) || []).length === 2, 'only the original style sheets (charte, theme) are saved');

// 12. Saving (download fallback), reopening, checker
await page.evaluate(() => { delete window.showSaveFilePicker; });
const dl = page.waitForEvent('download');
await page.keyboard.press('Control+s');
await (await dl).saveAs(saved);
const sv = fs.readFileSync(saved, 'utf8');
ok(sv.includes('Added test.') && sv.includes('"value":40') && sv.includes('c-alert'), `saved file complete (${(sv.length / 1024).toFixed(0)} KB)`);
ok(errs.length === 0, 'no JavaScript error' + (errs.length ? ': ' + errs.join(' | ') : ''));
await ctx.close();
let checkOut = '', checkPassed = true;
try { checkOut = execFileSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), saved], { encoding: 'utf8' }); }
catch (e) { checkPassed=false;checkOut=(e.stdout || '')+(e.stderr || ''); }
ok(checkPassed, 'the edited file passes the checker' + (!checkPassed ? ': '+checkOut : ''));

fs.copyFileSync(saved, tmp);
({ ctx, page, errs } = await open());
ok(await page.evaluate(() => document.querySelector('#s05 > .body').textContent.includes('Added test.')), 'saved file reopened');
await page.keyboard.press('p');
await page.waitForTimeout(200);
const vis = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].filter(s => getComputedStyle(s).display !== 'none').length);
ok(vis === 1, 'presentation: a single slide visible');
await page.keyboard.press('Escape');
await ctx.close();

// 13. Offline: cached SVG shown
({ ctx, page, errs } = await open({ offline: true }));
await page.waitForTimeout(300);
const off = await page.evaluate(() => [...document.querySelectorAll('figure.chart')].map(f => !f.classList.contains('live') && (f.querySelector(':scope > svg.render')?.getBoundingClientRect().height || 0) > 80));
ok(off.every(Boolean), `offline: ${off.length} charts shown from their cached SVG`);
await ctx.close();

await browser.close();
fs.rmSync(tmp); fs.rmSync(saved);
console.log(fails ? `\n${fails} failure(s)` : '\nAll tests pass.');
process.exit(fails ? 1 : 0);
