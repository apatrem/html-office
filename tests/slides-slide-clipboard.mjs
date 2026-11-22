// V1-01 in browsers: a whole slide through the shared clipboard (ADR-013, kind "slide").
// Two decks with different themes in two tabs, opened from two file:// paths: a slide is copied from
// the thumbnails (keyboard, button) and from Slide › Copy slide, and pasted after the current slide
// with the destination's theme, footer and numbering; text, shapes, tables, chart data, images, notes
// and frozen geometry are kept; slide, element, asset and SVG identifiers are new; the source and the
// rest of the destination are untouched; one undo step, redo, draft, save, check and reopen offline;
// text that no longer fits is reported; a deck without ECharts shows the sanitised previews; malformed,
// oversized and hostile envelopes are refused or neutralised (no request, no script); an unknown kind,
// and what the released 0.7.2 reader does with a slide. Cases marked "review" come from the
// cross-lineage review of PR #123.
// Chromium runs every case with the real clipboard. CLIPBOARD_ENGINES=chromium,firefox,webkit adds
// Firefox and WebKit, where the copy is real and the paste a dispatched event carrying the copied
// flavours: their native pasteboards across documents stay in docs/MANUAL-CHECKS.md.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { ASSETS, VERSION, upgrade, zone, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';
import { MIME, SCHEMA, ATTRIBUTE } from '../packages/shared/clipboard/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'work/slides-slide-clipboard');
fs.rmSync(DIR, { recursive: true, force: true });
for (const d of ['a', 'b', 'c', 'old']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

// Fictional content. s90 is a detached slide holding every kind of content; s91 follows its layout;
// s92 has a text box that fits the source theme only.
const CHART = { title: 'Hours by task', unit: 'hours', categories: ['Watering', 'Planting', 'Compost'], series: [{ name: 'Week 1', values: [12, 8, 3.5] }] };
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TABLE = '<table class="t" data-id="e904" style="--x:64;--y:336;--w:480;--h:144"><colgroup><col data-width="50"><col data-width="25"><col data-width="25"></colgroup><tbody>' +
  '<tr><th rowspan="2">Plot</th><th class="ta-c" colspan="2">Hours</th></tr><tr><th class="n">Spring</th><th class="n">Summer</th></tr>' +
  '<tr><td>Raised <b>beds</b></td><td class="n">120</td><td class="n"><span class="c-acc">45</span></td></tr><tr class="tot"><td>Total</td><td class="n">120</td><td class="n">45</td></tr></tbody></table>';
const S90 = '<section class="slide" id="s90" data-layout="default" data-detached="">' +
  '<p class="tracker" data-id="e900" style="--x:64;--y:44;--w:400;--h:20">Fictional · Clipboard</p>' +
  '<h1 data-id="e901" style="--x:64;--y:72;--w:1152;--h:88">A whole slide travels between two decks</h1>' +
  '<div class="body fs-l" data-id="e902" style="--x:64;--y:184;--w:480;--h:128"><p>Volunteers logged <span class="hl">412 hours</span> in <span class="c-acc">spring</span>.</p><ul><li>First point</li><li>Second <b>point</b></li></ul></div>' +
  '<div class="shape bg-mid" data-shape="chevron" data-id="e903" style="--x:600;--y:184;--w:216;--h:80">Plan</div>' +
  TABLE +
  `<figure class="chart" data-type="column" data-id="e905" style="--x:600;--y:288;--w:560;--h:336"><script type="application/json">${JSON.stringify(CHART)}</script></figure>` +
  '<img data-asset="a7" alt="A fictional garden plan" data-id="e906" style="--x:880;--y:176;--w:96;--h:96">' +
  '<p class="source" data-id="e907" style="--x:64;--y:648;--w:1152;--h:16">Source: fictional example</p>' +
  '<aside class="notes">Speaker note: mention the <b>spring</b> peak.</aside><aside class="to-ai">Reviewer note for the LLM.</aside></section>';
const S91 = '<section class="slide dark" id="s91" data-layout="panel-13" data-nofoot=""><div class="stack in-panel"><p class="kpi">42 %<small>Share of hours</small></p></div>' +
  '<p class="tracker">Fictional</p><h1>A slide that follows its layout</h1><div class="body w-8"><p>Its elements carry no coordinates.</p></div></section>';
const S92 = '<section class="slide" id="s92" data-layout="default" data-detached=""><h1 data-id="e920" style="--x:64;--y:72;--w:1152;--h:88">A tight text box</h1>' +
  '<div class="body" data-id="e921" style="--x:64;--y:200;--w:420;--h:32"><p>Twelve volunteers water the beds every week.</p></div></section>';
// A line that cannot wrap: wider than its frame in a larger type, never taller.
const S93 = '<section class="slide" id="s93" data-layout="default" data-detached=""><h1 data-id="e930" style="--x:64;--y:72;--w:1152;--h:88">A line that cannot wrap</h1>' +
  '<div class="body" data-id="e931" style="--x:64;--y:200;--w:560;--h:120"><pre>water(beds, 12); plant(rows, 8); compost(3.5)</pre></div></section>';
// The destination's own slide and image use the identifiers of the copied slide.
const OWN = '<section class="slide" id="s90" data-layout="default"><h1 data-id="e900">The destination\'s own slide s90</h1><div class="body" data-id="e901"><p>Unrelated content.</p></div>' +
  '<img data-asset="a7" alt="The destination\'s own image" class="w-4" data-id="e902"></section>';

const example = upgrade(fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'));
const deck = (html, { attrs, slides, assets, charte }) => {
  let out = html.replace(/<main id="deck" data-footer="[^"]*"/, `<main id="deck" ${attrs}`).replace('</main>', slides + '</main>');
  if (assets) out = setZone(out, 'assets', JSON.stringify(assets));
  if (charte) out = setZone(out, 'charte', zone(out, 'charte') + charte);
  return out;
};
const A = path.join(DIR, 'a/deck.html'), B = path.join(DIR, 'b/deck.html'), WIDE = path.join(DIR, 'b/wide.html'), C = path.join(DIR, 'c/no-charts.html');
fs.writeFileSync(A, deck(example, { attrs: 'data-footer="Deck A · Fictional data" data-theme="red" data-font="georgia"', slides: S90 + S91 + S92 + S93,
  assets: { a7: { type: 'image/png', data: PNG_A }, a8: { type: 'image/png', data: PNG_B } } }));
const destination = { attrs: 'data-footer="Deck B · Fictional data" data-theme="green"', slides: OWN, assets: { a7: { type: 'image/png', data: PNG_B } } };
fs.writeFileSync(B, deck(example, destination));
// The same destination with a larger body size in its charte: text that fitted no longer does.
fs.writeFileSync(WIDE, deck(example, { ...destination, charte: '\n:root{--body-size:30px}\n' }));
// A deck without charts: ECharts is loaded only when a chart arrives.
fs.writeFileSync(C, setZone(example, 'main', zone(example, 'main').replace(/<figure class="chart[\s\S]*?<\/figure>/g, '')));

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
  // What the last copy event carried, read after the engine's handler; `taken` when the engine wrote it.
  addEventListener('copy', e => { globalThis.copied = { ...Object.fromEntries([...e.clipboardData.types].map(t => [t, e.clipboardData.getData(t)])), ...(e.defaultPrevented ? {} : { native: 'yes' }) }; });
};
async function context(browser, { offline = false, grant = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (grant) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(initScript);
  await ctx.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => offline ? r.abort() : r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  return ctx;
}
async function open(ctx, file, { edit = true } = {}) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  if (edit) await page.keyboard.press('e');
  page.errors = errors;
  return page;
}
const banner = page => page.evaluate(() => document.querySelector('.hs-banner')?.textContent || '');
// The saved deck from its content on: the slides and the assets zone.
const mainHTML = page => page.evaluate(() => window.deckEngine.serialize().match(/<main[\s\S]*<\/main>/)[0]);
const assetsOf = page => page.evaluate(() => JSON.parse(document.getElementById('assets').textContent));
const order = page => page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
const current = page => page.evaluate(() => document.querySelector('main#deck > section.hs-focus')?.id);
async function menu(page, name, entry) {
  await page.bringToFront();
  await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
  await page.locator('.sh-pop [role=menuitem]').filter({ has: page.locator('.sh-mlabel').getByText(entry, { exact: true }) }).click();
}
// The thumbnails are rebuilt in an animation frame after a change of the deck.
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const thumb = (page, slide) => page.evaluate(id => [...document.querySelectorAll('main#deck > section.slide')].findIndex(s => s.id === id), slide)
  .then(i => page.locator('.hs-thumb').nth(i));
// Copies a slide: 'keyboard' clicks its thumbnail and presses the shortcut, 'button' uses the
// thumbnail's Copy slide button, 'menu' Slide › Copy slide.
let lastCopy = null, realPaste = false;
async function copy(page, slide, how = 'keyboard') {
  await page.bringToFront();
  await frames(page);
  const t = await thumb(page, slide);
  await page.evaluate(() => { globalThis.copied = null; document.querySelector('.hs-banner')?.remove(); });
  if (how === 'button') { await t.hover(); await t.getByRole('button', { name: 'Copy slide' }).click(); }
  else {
    await t.locator('.hs-mini').click();
    if (how === 'keyboard') await page.keyboard.press('ControlOrMeta+c');
    else await menu(page, 'Slide', 'Copy slide');
  }
  await page.waitForFunction(() => globalThis.copied);
  return lastCopy = await page.evaluate(() => globalThis.copied);
}
const dispatchPaste = (page, flavours) => page.evaluate(f => {
  const data = new DataTransfer();
  for (const [t, v] of Object.entries(f)) data.setData(t, v);
  (document.activeElement || document.body).dispatchEvent(clipEvent('paste', data));
}, flavours);
// Pastes after `slide` (clicked in the thumbnails): the real clipboard in Chromium, otherwise the
// copied flavours in a dispatched event.
async function paste(page, slide, flavours = 'keyboard') {
  await page.bringToFront();
  await frames(page);
  const t = await thumb(page, slide);
  await t.locator('.hs-mini').click();
  await page.evaluate(() => document.querySelector('.hs-banner')?.remove());
  if (flavours === 'keyboard' && !realPaste) flavours = lastCopy;
  if (flavours === 'keyboard') await page.keyboard.press('ControlOrMeta+v');
  else if (flavours === 'menu') await menu(page, 'Slide', 'Paste slide');
  else await dispatchPaste(page, flavours);
  await page.waitForFunction(() => document.querySelector('.hs-banner'));
  return banner(page);
}
// A slide as the tests compare it: identifiers, asset names, previews and runtime nodes removed,
// attributes in alphabetical order.
const shape = (page, id) => page.evaluate(id => {
  const s = document.getElementById(id).cloneNode(true);
  s.querySelectorAll('[data-ui], svg.render').forEach(n => n.remove());
  for (const el of [s, ...s.querySelectorAll('*')]) {
    for (const a of ['id', 'data-id', 'data-asset', 'src', 'contenteditable', 'spellcheck']) el.removeAttribute(a);
    el.classList.remove('live', 'hs-sel', 'hs-focus', 'hs-current');
    if (el.getAttribute('class') === '') el.removeAttribute('class');
    const sorted = [...el.attributes].map(a => [a.name, a.value]).sort(([x], [y]) => (x < y ? -1 : 1));
    for (const [n] of sorted) el.removeAttribute(n);
    for (const [n, v] of sorted) el.setAttribute(n, v);
  }
  return s.outerHTML;
}, id);
const elementIds = page => page.evaluate(() => [...document.querySelectorAll('main#deck [data-id]')].map(n => n.dataset.id));
// What the pasted slide shows: footer, number, chart, image and identifiers.
const facts = (page, id) => page.evaluate(async id => {
  const s = document.getElementById(id), fig = s.querySelector('figure.chart'), img = s.querySelector('img[data-asset]');
  if (img && !img.complete) await new Promise(done => { img.onload = img.onerror = done; });
  const ids = [...document.querySelectorAll('main#deck [data-id]')].map(n => n.dataset.id), slides = [...document.querySelectorAll('main#deck > section.slide')];
  const fills = n => [...new Set([...(n?.querySelectorAll('[fill]') ?? [])].map(p => p.getAttribute('fill').toLowerCase()))];
  const token = t => getComputedStyle(document.documentElement).getPropertyValue('--' + t).trim().toLowerCase();
  return { id: s.id, uniqueSlide: slides.filter(x => x.id === s.id).length === 1, own: [...s.children].filter(n => n.dataset.id).map(n => n.dataset.id),
    uniqueIds: new Set(ids).size === ids.length, footer: s.querySelector(':scope > .hs-foot')?.children[0]?.textContent, number: s.querySelector(':scope > .hs-foot')?.children[1]?.textContent,
    index: slides.indexOf(s) + 1, json: fig?.querySelector(':scope > script')?.textContent, live: !!fig?.classList.contains('live'),
    drawn: fills(fig?.querySelector('.hs-plot')), saved: fills(fig?.querySelector(':scope > svg.render')), acc: token('acc'),
    asset: img?.dataset.asset, image: img ? img.naturalWidth : null, src: img?.getAttribute('src') || '', notes: [...s.querySelectorAll(':scope > aside')].map(n => n.outerHTML).join('') };
}, id);
const check = file => spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), file, '--json'], { encoding: 'utf8' });
const save = async (page, file) => { fs.writeFileSync(file, await page.evaluate(() => window.deckEngine.serialize())); return file; };
const envelope = (slide, source = { product: 'slides', format: '1' }) => JSON.stringify({ schema: SCHEMA, kind: 'slide', source, slide });

const engines = { chromium, firefox, webkit };
for (const name of (process.env.CLIPBOARD_ENGINES ?? 'chromium').split(',')) {
  const full = name === 'chromium';
  realPaste = full;
  const browser = await engines[name].launch();
  console.log(`\n# ${name} ${browser.version()}`);
  try {
    const ctx = await context(browser, { grant: full });
    const a = await open(ctx, A), b = await open(ctx, B);

    // 1. Copy from the thumbnails: the envelope, simple HTML and an outline; the source is untouched.
    const source0 = await mainHTML(a), sourceShape = await shape(a, 's90');
    const flavours = await copy(a, 's90');
    const env = JSON.parse(flavours[MIME] || '{}');
    ok(/^Slide \d+ copied/.test(await banner(a)) && [MIME, 'text/html', 'text/plain'].every(t => flavours[t]), `a slide clicked in the thumbnails is copied with ${name === 'chromium' ? 'Ctrl' : 'Ctrl/Cmd'}+C (${Object.keys(flavours)}; "${await banner(a)}")`);
    ok(env.schema === SCHEMA && env.kind === 'slide' && env.source.product === 'slides' && env.source.format === '1' && Object.keys(env).sort().join() === 'kind,schema,slide,source',
      'the envelope is html-office-clip/1 of kind "slide", with the source format and nothing about the document');
    ok(/^<section class="slide" data-layout="default" data-detached="">/.test(env.slide.html) && !/ id="/.test(env.slide.html.replace(/<svg[\s\S]*?<\/svg>/g, '')) &&
      /<svg[^>]*class="render"/.test(env.slide.html) && env.slide.html.includes('<aside class="notes">') && !/data-ui|hs-foot|hs-focus|contenteditable| src=/.test(env.slide.html),
      'it carries the cleaned slide: content, notes and the chart preview, no slide id and nothing of the editor');
    ok(JSON.stringify(Object.keys(env.slide.assets)) === '["a7"]' && env.slide.assets.a7.data === PNG_A, `only the images of the slide travel (${Object.keys(env.slide.assets)})`);
    const semantic = flavours['text/html'].replace(new RegExp(` ${ATTRIBUTE}="[^"]*"`), '');
    ok(flavours['text/html'].includes(`<section ${ATTRIBUTE}="`) && /<h1>A whole slide travels between two decks<\/h1>/.test(semantic) && /<li>Second <b>point<\/b><\/li>/.test(semantic) &&
      /<th rowspan="2">Plot<\/th><th colspan="2">Hours<\/th>/.test(semantic) && /<p>Hours by task<\/p><table><tr><th>Category<\/th><th>Week 1<\/th>/.test(semantic) &&
      /\[Image: A fictional garden plan\]/.test(semantic) && !/class=|style=|data-|Speaker note|<svg|<script|<img/.test(semantic),
      'text/html is simple HTML for other applications: headings, lists, tables, the chart as its data; no class, style, picture or note');
    const lines = flavours['text/plain'].split('\n');
    ok(lines[0] === 'Fictional · Clipboard' && lines[1] === 'A whole slide travels between two decks' && lines.includes('- First point') && lines.includes('Raised beds\t120\t45') &&
      lines.includes('Hours by task') && lines.includes('Watering\t12') && !/Speaker note/.test(flavours['text/plain']), `text/plain is an outline (${JSON.stringify(lines.slice(0, 6))})`);
    ok(await mainHTML(a) === source0 && !(await a.evaluate(() => document.querySelector('.hs-save').classList.contains('dirty'))), 'copying leaves the source deck unchanged and clean');
    const viaButton = await copy(a, 's90', 'button'), viaMenu = await copy(a, 's90', 'menu');
    ok(viaButton[MIME] === flavours[MIME] && viaMenu[MIME] === flavours[MIME] && viaMenu['text/plain'] === flavours['text/plain'], 'the thumbnail\'s Copy slide button and Slide › Copy slide write the same slide');

    // 2. Element and text copies are unchanged.
    await a.locator('#s90 > table').scrollIntoViewIfNeeded();
    await a.locator('#s90 > table').click({ position: { x: 20, y: 8 } });
    await a.evaluate(() => { globalThis.copied = null; });
    await a.keyboard.press('ControlOrMeta+c');
    await a.waitForFunction(() => globalThis.copied);
    ok(JSON.parse((await a.evaluate(() => globalThis.copied))[MIME]).kind === 'table', 'with a table selected, the shortcut still copies the table');
    await a.locator('#s90 > h1').click();
    await a.evaluate(() => { globalThis.copied = null; });
    await a.keyboard.press('ControlOrMeta+c');
    await a.waitForTimeout(300);
    ok(!(await a.evaluate(() => globalThis.copied))?.[MIME], 'with a text box selected on the canvas, the shortcut copies no slide');
    await a.locator('#s90 > h1').dblclick();
    await a.keyboard.press('ControlOrMeta+a');
    await a.evaluate(() => { globalThis.copied = null; });
    await a.keyboard.press('ControlOrMeta+c');
    await a.waitForFunction(() => globalThis.copied);
    const typed = await a.evaluate(() => globalThis.copied);
    ok(!typed[MIME] && typed.native === 'yes' && await a.evaluate(() => getSelection().toString().trim()) === 'A whole slide travels between two decks',
      'while typing, the shortcut is the browser\'s own copy of the selected text');
    await a.keyboard.press('Escape');
    await a.keyboard.press('Escape');
    // Firefox kept the text selected after typing: the next shortcut copied it, not the slide (CI, PR #123).
    ok(await a.evaluate(() => getSelection().toString()) === '', 'leaving the text box leaves no text selected');
    ok(await mainHTML(a) === source0, 'the source is still unchanged');

    // Review: where the browser refuses the menu's copy, the shortcut the notice asks for copies the slide, not a selected table.
    await a.locator('#s90 > table').click({ position: { x: 20, y: 8 } });
    await a.evaluate(() => { document.execCommand = () => false; globalThis.copied = null; });
    await menu(a, 'Slide', 'Copy slide');
    const asked = await banner(a);
    await a.evaluate(() => { delete document.execCommand; });
    await a.keyboard.press('ControlOrMeta+c');
    await a.waitForFunction(() => globalThis.copied);
    ok(/^Press .+C to copy\.$/.test(asked) && JSON.parse((await a.evaluate(() => globalThis.copied))[MIME] || '{}').kind === 'slide', `review: after "${asked}", the shortcut copies the slide`);

    // 3. Paste into the other deck after its current slide: the destination's theme, new identifiers.
    await copy(a, 's90');
    const html0 = await mainHTML(b), order0 = await order(b), ids0 = await elementIds(b);
    const said = await paste(b, 's05');
    const order1 = await order(b), pasted = order1[order0.indexOf('s05') + 1];
    ok(/^Slide pasted as slide 6\.$/.test(said) && order1.length === order0.length + 1 && !order0.includes(pasted) && await current(b) === pasted,
      `${full ? 'keyboard' : 'event'} paste adds the slide after the current one and makes it current ("${said}"; ${order1})`);
    const got = await shape(b, pasted), f = await facts(b, pasted), src = await facts(a, 's90');
    ok(got === sourceShape, 'text, inline formatting, shape, table (merges, widths), chart type, image, notes and frozen geometry are identical' + (got === sourceShape ? '' : `\n      ${got}\n      ${sourceShape}`));
    ok(f.uniqueSlide && f.uniqueIds && f.own.length === 8 && !f.own.some(id => ids0.includes(id)) && ids0.includes('e900') && order0.includes('s90'),
      `the slide and its elements have new identifiers, though the destination already used the source's (${f.id}: ${f.own})`);
    ok(f.asset && f.asset !== 'a7' && f.image === 1 && f.src.includes(PNG_A) && (await assetsOf(b)).a7.data === PNG_B && (await assetsOf(b))[f.asset].data === PNG_A,
      `the image travels under a new asset name; the destination's own "a7" is kept (${f.asset})`);
    ok(f.footer === 'Deck B · Fictional data' && f.number === '6' && f.index === 6, `the destination's footer and page number are shown (${f.footer} · ${f.number})`);
    ok(f.json === JSON.stringify(CHART) && f.live && f.drawn.includes(f.acc) && !f.drawn.includes(src.acc) && src.drawn.includes(src.acc),
      `the chart keeps its data and is drawn with the destination's palette (${f.acc}, not ${src.acc})`);
    ok(f.notes === '<aside class="notes">Speaker note: mention the <b>spring</b> peak.</aside><aside class="to-ai">Reviewer note for the LLM.</aside>', 'speaker and reviewer notes are kept');
    const deckOnly = html => /<main[\s\S]*?<\/main>/.exec(html)[0];
    const rest = deckOnly(await mainHTML(b)).replace(new RegExp(`<section [^>]*id="${pasted}"[\\s\\S]*?</section>`), '');
    ok(rest === deckOnly(html0), 'the rest of the destination is untouched, its own slide "s90" included');
    ok(await mainHTML(a) === source0, 'the source deck is untouched');

    // 4. One undo step, redo, draft.
    await b.keyboard.press('ControlOrMeta+z');
    ok(await mainHTML(b) === html0 && (await order(b)).join() === order0.join(), 'one undo removes the pasted slide');
    await b.keyboard.press('ControlOrMeta+Shift+z');
    const redone = await facts(b, pasted);
    ok(await shape(b, pasted) === sourceShape && redone.image === 1 && redone.live && redone.footer === 'Deck B · Fictional data', 'redo brings it back, with its image and chart');
    const draft = await b.evaluate(() => JSON.parse(localStorage.getItem('html-slides:' + location.pathname) || 'null'));
    ok(draft?.main.includes('A whole slide travels between two decks') && draft.assets[f.asset]?.data === PNG_A, 'the draft holds the pasted slide and its image');
    // Review: the draft made by the paste had the chart's data but no picture of it.
    const drafted = new RegExp(`<section [^>]*id="${pasted}"[\\s\\S]*?</section>`).exec(draft?.main ?? '')?.[0] ?? '';
    ok(/<svg[^>]*class="render"/.test(drafted) && drafted.toLowerCase().includes(`fill="${f.acc}"`) && !drafted.includes('data-preview'),
      'review: the draft already holds the chart preview, in the destination\'s colours');
    {
      // ECharts never answers here: once it fails, its notice takes the place of the offer to restore.
      const lost = await ctx.newPage();
      await lost.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, () => {});
      await lost.goto(pathToFileURL(B).href, { waitUntil: 'domcontentloaded' });
      await lost.waitForFunction(() => window.deckEngine);
      await lost.locator('.hs-banner button', { hasText: 'Restore' }).click();
      const back = await facts(lost, pasted);
      ok(back.image === 1 && !back.live && back.saved.includes(f.acc) && back.json === JSON.stringify(CHART),
        `review: the draft restored without ECharts shows the image and the chart preview (${back.saved.slice(0, 4)})`);
      await lost.close();
    }

    // 5. Save, check, and reopen without ECharts: the image and the chart preview are in the file.
    const saved = await save(b, path.join(DIR, 'b/saved.html'));
    const checked = check(saved);
    ok(checked.status === 0, 'the saved deck passes the checker' + (checked.status ? ': ' + checked.stdout.slice(0, 800) : ''));
    const off = await context(browser, { offline: true });
    const reopened = await open(off, saved, { edit: false });
    const r = await facts(reopened, pasted);
    ok(r.image === 1 && !r.live && r.saved.includes(f.acc) && !r.saved.includes(src.acc) && r.json === JSON.stringify(CHART) && Object.keys(await assetsOf(reopened)).length === 2,
      `reopened offline: the image is embedded and the chart preview is in the destination's colours (${r.saved.slice(0, 4)})`);
    ok(await reopened.evaluate(id => { const s = document.querySelector(`#${id} > figure.chart > svg.render`); return !!s && s.getBoundingClientRect().width > 100; }, pasted), 'offline, the saved preview is what the reader sees');
    await off.close();

    // 6. Slide › Paste slide reads the clipboard where the browser allows it; a slide that follows its layout.
    await copy(a, 's91', 'menu');
    const layoutShape = await shape(a, 's91');
    const said91 = await paste(b, 's02', full ? 'menu' : 'keyboard');
    const p91 = (await order(b))[2];
    ok(/^Slide pasted as slide 3\.$/.test(said91) && await shape(b, p91) === layoutShape && await b.evaluate(id => { const s = document.getElementById(id);
      return s.matches('.dark[data-layout="panel-13"][data-nofoot]:not([data-detached])') && !s.querySelector('[style]') && !s.querySelector(':scope > .hs-foot'); }, p91),
      `${full ? 'Slide › Paste slide' : 'event paste'}: a layout slide keeps its layout, dark variant and hidden footer, without coordinates ("${said91}")`);
    await b.keyboard.press('ControlOrMeta+z');
    if (full) {
      await a.evaluate(() => navigator.clipboard.writeText('plain text'));
      const none = await paste(b, 's02', 'menu');
      ok(/^The clipboard holds no slide/.test(none) && (await order(b)).length === order0.length + 1, `Slide › Paste slide adds nothing but a slide ("${none}")`);
    }

    // 7. Within one deck: after the current slide, with new identifiers, reusing the stored image.
    await copy(a, 's90');
    const assetsA = Object.keys(await assetsOf(a)), orderA = await order(a);
    await paste(a, 's02');
    const twin = (await order(a))[2], t = await facts(a, twin);
    ok((await order(a)).length === orderA.length + 1 && await shape(a, twin) === sourceShape && t.uniqueIds && t.uniqueSlide && t.asset === 'a7' && Object.keys(await assetsOf(a)).join() === assetsA.join(),
      `pasting into the same deck adds a slide with new identifiers and reuses the stored image (${twin}, ${t.asset})`);
    await a.keyboard.press('ControlOrMeta+z');
    ok(await mainHTML(a) === source0, 'undone');

    // 8. Text that no longer fits the destination's theme is reported, selected and kept whole.
    const w = await open(ctx, WIDE);
    await copy(a, 's92');
    ok((await a.evaluate(() => { const el = document.querySelector('#s92 > .body'); return el.scrollHeight <= el.clientHeight + 3; })), 'fixture: the text box fits in the source theme');
    const tight = await paste(w, 's05');
    const p92 = (await order(w))[5];
    const fit = await w.evaluate(id => { const el = document.querySelector(`#${id} > .body`); return { over: el.scrollHeight > el.clientHeight + 3, text: el.textContent,
      selected: window.deckEngine.selection().join() === el.dataset.id, style: el.getAttribute('style') }; }, p92);
    ok(/1 element does not fit with this deck's theme \(selected\)/.test(tight) && fit.over && fit.selected && fit.text === 'Twelve volunteers water the beds every week.' && fit.style === '--x:64;--y:200;--w:420;--h:32',
      `overflow brought by the theme is reported, the element selected, nothing truncated or resized ("${tight}")`);
    // Review: a line that cannot wrap grows wider than its frame, not taller.
    await copy(a, 's93');
    const wide0 = await a.evaluate(() => { const el = document.querySelector('#s93 > .body'); return el.scrollWidth <= el.clientWidth + 3 && el.scrollHeight <= el.clientHeight + 3; });
    const wider = await paste(w, 's05');
    const p93 = (await order(w))[5];
    const across = await w.evaluate(id => { const el = document.querySelector(`#${id} > .body`); return { wide: el.scrollWidth > el.clientWidth + 3, tall: el.scrollHeight > el.clientHeight + 3,
      text: el.textContent, selected: window.deckEngine.selection().join() === el.dataset.id }; }, p93);
    ok(wide0 && /1 element does not fit/.test(wider) && across.wide && !across.tall && across.selected && across.text === 'water(beds, 12); plant(rows, 8); compost(3.5)',
      `review: text wider than its frame is reported too, and kept whole ("${wider.slice(0, 90)}"; ${JSON.stringify(across)})`);
    const roomy = await paste(w, 's05', { [MIME]: flavours[MIME] });
    ok(/^Slide pasted as slide 6\./.test(roomy), `the custom type alone carries a slide ("${roomy.slice(0, 80)}")`);
    await w.close();
    const onlyHTML = await paste(b, 's02', { 'text/html': flavours['text/html'], 'text/plain': flavours['text/plain'] });
    ok(/^Slide pasted as slide 3\.$/.test(onlyHTML) && await shape(b, (await order(b))[2]) === sourceShape, 'without the custom type (Safari, another browser), the slide comes from text/html');
    await b.keyboard.press('ControlOrMeta+z');

    // 9. Refused, deck and assets unchanged: malformed, oversized, newer format, unknown kind.
    const unchanged = await mainHTML(b), assets1 = JSON.stringify(await assetsOf(b));
    const storedDraft = page => page.evaluate(() => { const d = JSON.parse(localStorage.getItem('html-slides:' + location.pathname) || '{}'); return JSON.stringify([d.main, d.assets]); });
    const draft1 = await storedDraft(b);
    const sec = inner => `<section class="slide" data-layout="default">${inner}</section>`;
    const img = '<h1>T</h1><img data-asset="a1" alt="x">';
    const refused = [
      ['a slide that is not an object', JSON.stringify({ schema: SCHEMA, kind: 'slide', slide: 'x' }), /a slide needs slide data/],
      ['no slide content', envelope({ assets: {} }), /no slide content/],
      ['two slides', envelope({ html: sec('<h1>a</h1>') + sec('<h1>b</h1>') }), /expected one slide/],
      ['an element that is not a slide', envelope({ html: '<div class="slide"><h1>a</h1></div>' }), /expected one slide/],
      ['slide HTML over 4 Mi', envelope({ html: sec('<p>' + 'x'.repeat(4 * 2 ** 20) + '</p>') }), /slide is too large/],
      ['over 20,000 elements', envelope({ html: sec('<p><b></b></p>'.repeat(10001)) }), /too many elements/],
      ['content nested 40 deep', envelope({ html: sec('<div>'.repeat(40) + 'x' + '</div>'.repeat(40)) }), /nested too deeply/],
      ['assets that are not an object', envelope({ html: sec(img), assets: [] }), /assets must be an object/],
      ['an image that is not base64', envelope({ html: sec(img), assets: { a1: { type: 'image/png', data: '<svg onload=1>' } } }), /an image is malformed/],
      ['an image of another type', envelope({ html: sec(img), assets: { a1: { type: 'text/html', data: PNG_A } } }), /an image is malformed/],
      ['a font as an image', envelope({ html: sec(img), assets: { a1: { kind: 'font', family: 'X', type: 'font/woff2', data: PNG_A } } }), /an image is malformed/],
      ['an image over 8 Mi of base64', envelope({ html: sec(img), assets: { a1: { type: 'image/png', data: 'A'.repeat(8 * 2 ** 20 + 4) } } }), /an image is larger than 6 MB/],
      // Review: 20 cells of 999 × 999 passed every limit and would expand to 20 million grid slots.
      ['merged cells covering millions of cells', envelope({ html: sec('<table class="t">' + '<tr><td colspan="999" rowspan="999">x</td></tr>'.repeat(20) + '</table>') }), /a table covers more than 5,000 cells/],
      ['33 images', envelope({ html: sec('<h1>T</h1>' + Array.from({ length: 33 }, (_, i) => `<img data-asset="a${i}" alt="x">`).join('')),
        assets: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, { type: 'image/png', data: PNG_A }])) }), /more than 32 images/],
      ['a chart without data', envelope({ html: sec('<figure class="chart" data-type="column"></figure>') }), /a chart has no readable data/],
      ['an invalid chart', envelope({ html: sec('<figure class="chart" data-type="column"><script type="application/json">{"unit":"u","series":[]}</script></figure>') }), /categories/],
      ['an unknown chart field', envelope({ html: sec(`<figure class="chart" data-type="column"><script type="application/json">${JSON.stringify({ ...CHART, onclick: 'x' })}</script></figure>`) }), /onclick: unknown field/],
      ['a chart of an unknown type', envelope({ html: sec('<figure class="chart" data-type="pie"><script type="application/json">{}</script></figure>') }), /unknown type "pie"/],
      ['a newer format', envelope({ html: sec('<h1>a</h1>') }, { product: 'slides', format: '2' }), /newer html-slides format \(2\): upgrade this deck's editor/],
      ['an unknown kind', JSON.stringify({ schema: SCHEMA, kind: 'page', page: {} }), /unknown kind "page" \(a newer version of html-office may be needed\)/],
      ['JSON that does not parse', '{"schema":', /not valid JSON/]];
    for (const [what, json, why] of refused) {
      const msg = await paste(b, 's05', { [MIME]: json, 'text/html': '<table><tr><td>valid</td></tr></table>', 'text/plain': 'x' });
      ok(/^Paste failed/.test(msg) && /Deck unchanged\.$/.test(msg) && why.test(msg) && await mainHTML(b) === unchanged && JSON.stringify(await assetsOf(b)) === assets1 && await storedDraft(b) === draft1,
        `refused, deck, assets and draft unchanged: ${what} ("${msg.slice(0, 120)}")`);
    }
    // Review: the image limit counts distinct images, each checked once however often it is shown.
    const many = await paste(b, 's05', { [MIME]: envelope({ html: sec('<h1>T</h1><div class="body">' + '<img data-asset="a1" alt="x">'.repeat(300) + '</div>'), assets: { a1: { type: 'image/png', data: PNG_A } } }) });
    const shown = await b.evaluate(id => [...new Set([...document.querySelectorAll(`#${id} img`)].map(i => i.dataset.asset))].length + '/' + document.querySelectorAll(`#${id} img`).length, (await order(b))[5]);
    ok(/^Slide pasted as slide 6\./.test(many) && shown === '1/300', `review: one image shown 300 times is one image (${shown}; "${many.slice(0, 60)}")`);
    await b.keyboard.press('ControlOrMeta+z');
    ok(await mainHTML(b) === unchanged, 'undone');
    const newer = await paste(b, 's05', { [MIME]: JSON.stringify({ schema: 'html-office-clip/2', kind: 'slide' }), 'text/plain': 'x' });
    ok(/holds no slide, table or chart/.test(newer) && await mainHTML(b) === unchanged, `an envelope of a newer schema is skipped ("${newer.slice(0, 70)}")`);

    // 10. Hostile content is rebuilt from the format's vocabulary: no script, no request, no style.
    const hostile = '<section class="slide evil" id="deck" data-layout="zzz" data-detached="" onclick="globalThis.ran=1" style="background:url(' + resources + '/section)">' +
      `<script>globalThis.ran=2</script><style>@import "${resources}/import.css";</style><link rel="stylesheet" href="${resources}/link.css">` +
      `<h1 data-id="e1" id="s01" style="--x:64;--y:72;--w:1152;--h:88;color:red" onmouseover="globalThis.ran=3" contenteditable="true">Title <a href="javascript:globalThis.ran=4">link</a></h1>` +
      `<div class="body evil hs-sel" style="--x:64;--y:200;--w:400;--h:100;background:url(${resources}/bg)" data-id="e1"><p style="position:fixed">Text <span class="c-acc x" style="color:red">accent</span> ` +
      `<font color="red">font</font><span style="font-size:99px">plain</span><img src="${resources}/img.png" onerror="globalThis.ran=5" alt="x">` +
      `<iframe src="${resources}/frame"></iframe><object data="${resources}/object"></object><video poster="${resources}/poster"></video>` +
      `<svg><image href="${resources}/svg.png"/><script>globalThis.ran=6</script></svg><math><mi>x</mi></math><form action="${resources}/form"><input value="field"></form><article>kept text</article></p></div>` +
      `<div class="shape" data-shape="star" style="--x:600;--y:200;--w:100;--h:100">S</div><marquee style="--x:0;--y:400;--w:200;--h:40">moving</marquee>` +
      `<table class="t" style="--x:64;--y:400;--w:400;--h:80"><colgroup style="x"><col data-width="250" width="9"><col data-width="40"></colgroup><tr><td colspan="2" rowspan="-1" background="${resources}/td">a</td></tr></table>` +
      `<img data-asset="missing" alt="gone"><aside class="notes" onclick="globalThis.ran=7">Note<script>globalThis.ran=8</script></aside><aside>Stray</aside>loose text</section>`;
    hits = [];
    const cleanedMsg = await paste(b, 's05', { [MIME]: envelope({ html: hostile }) });
    await b.waitForTimeout(600);
    const h = (await order(b))[5];
    const cleaned = await b.evaluate(id => { const s = document.getElementById(id).cloneNode(true); s.querySelectorAll('[data-ui]').forEach(n => n.remove()); return s.outerHTML; }, h);
    ok(/^Slide pasted as slide 6\. Its layout "zzz" is unknown here: the default layout is used\. 2 images were not carried over\. \d+ items outside the slide format were simplified or left out\./.test(cleanedMsg),
      `hostile slide: pasted with notices ("${cleanedMsg}")`);
    ok(!/script|onclick|onmouseover|onerror|javascript:|href|src=|iframe|object|video|<svg|math|<form|input|<font|marquee|article|import|url\(|evil|contenteditable|color:|position|background|width="9"|rowspan/.test(cleaned) &&
      new RegExp(`^<section class="slide hs-focus" data-layout="default" data-detached="" id="${h}">`).test(cleaned), `only the format's vocabulary remains\n      ${cleaned}`);
    ok(/<h1 style="--x:64;--y:72;--w:1152;--h:88" data-id="e\d+">Title link<\/h1>/.test(cleaned) && cleaned.includes('<span class="c-acc">accent</span> fontplain</p>kept text') &&
      cleaned.includes('data-shape="rect"') && cleaned.includes('<colgroup><col><col data-width="40"></colgroup>') && cleaned.includes('<td colspan="2">a</td>') &&
      cleaned.includes('<aside class="notes">Note</aside>') && !/Stray|loose text|gone/.test(cleaned) && /<div style="--x:0;--y:400;--w:200;--h:40" data-id="e\d+">moving<\/div>/.test(cleaned),
      'text is kept, geometry is the only style, unknown values are replaced or dropped');
    ok(hits.length === 0 && await b.evaluate(() => globalThis.ran) === undefined && (await facts(b, h)).uniqueIds, `no request, no script, unique identifiers (${hits})`);
    const hostileCheck = check(await save(b, path.join(DIR, 'b/hostile.html')));
    const problems = JSON.parse(hostileCheck.stdout || '{"out":[]}').out.filter(x => x.level === 'error' && !/overflow|outside slide|Overflows/i.test(x.msg));
    ok(problems.length === 0, 'the deck saved with it has no safety or format error in the checker' + (problems.length ? ': ' + JSON.stringify(problems).slice(0, 600) : ''));
    await b.keyboard.press('ControlOrMeta+z');
    ok(await mainHTML(b) === unchanged, 'undone');
    ok(!a.errors.length && !b.errors.length, `no JavaScript error (${[...a.errors, ...b.errors]})`);

    // 11. A deck without ECharts: the sanitised previews, then the destination's colours when it loads.
    {
      const off2 = await context(browser, { offline: true });
      const c = await open(off2, C);
      const evil = env.slide.html.replace(/<svg([^>]*)class="render"/, `<svg$1onload="globalThis.ran=9" class="render"`).replace('</svg>', `<script>globalThis.ran=10</script><image href="${resources}/chart.png"/><defs><linearGradient id="dup"></linearGradient><clipPath id="dup"><rect width="1" height="1"/></clipPath></defs></svg>`);
      hits = [];
      const waiting = await paste(c, 's05', { [MIME]: envelope({ html: evil + '', assets: env.slide.assets }) });
      await paste(c, 's05', { [MIME]: flavours[MIME] });
      await c.waitForTimeout(500);
      const previews = await c.evaluate(() => [...document.querySelectorAll('main#deck figure.chart')].map(fig => {
        const s = fig.querySelector(':scope > svg.render');
        return { ids: [...(s?.querySelectorAll('[id]') ?? [])].map(n => n.id), badge: !!fig.querySelector('.hs-chart-preview'), html: s?.outerHTML ?? '', live: fig.classList.contains('live') };
      }));
      ok(/Its charts are drawn in this deck's colours when ECharts loads\./.test(waiting) && previews.length === 2 && previews.every(p => p.badge && !p.live && p.html.length > 500 && !/script|onload|<image|href/.test(p.html)) &&
        !previews[0].ids.some(id => previews[1].ids.includes(id)) && hits.length === 0 && await c.evaluate(() => globalThis.ran) === undefined &&
        previews.every(p => new Set(p.ids).size === p.ids.length) && previews[1].ids.length === 1 && /<linearGradient id="p[\w-]+"><\/linearGradient><clipPath><rect/.test(previews[1].html),
        `without ECharts, the charts show their previews rebuilt from the SVG allow-list, with ids of their own ("${waiting.slice(0, 90)}")`);
      // Review: undo and redo rebuild the figures; the previews are still labelled.
      await c.keyboard.press('ControlOrMeta+z');
      await c.keyboard.press('ControlOrMeta+Shift+z');
      await frames(c);
      const badges = await c.evaluate(() => [...document.querySelectorAll('main#deck figure.chart')].map(fig => !!fig.querySelector(':scope > .hs-chart-preview') && fig.querySelector(':scope > svg.render').hasAttribute('data-preview')));
      ok(badges.length === 2 && badges.every(Boolean), `review: after undo and redo the previews keep their label (${badges})`);
      const offline = check(await save(c, path.join(DIR, 'c/offline.html')));
      ok(offline.status === 0, 'the deck saved offline passes the checker' + (offline.status ? ': ' + offline.stdout.slice(0, 600) : ''));
      const again = await open(ctx, path.join(DIR, 'c/offline.html'), { edit: false });
      const live = await again.evaluate(() => { const token = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().toLowerCase();
        return [...document.querySelectorAll('main#deck figure.chart')].map(fig => fig.classList.contains('live') && [...fig.querySelectorAll('.hs-plot [fill]')].some(p => p.getAttribute('fill').toLowerCase() === token)); });
      ok(live.length === 2 && live.every(Boolean), 'reopened with ECharts: the charts are drawn from their data in this deck\'s colours');
      await off2.close();
      // Online, in a deck that had no chart: ECharts is fetched and replaces the previews.
      const d = await open(ctx, C);
      await paste(d, 's05', { [MIME]: flavours[MIME] });
      await d.waitForFunction(() => document.querySelector('main#deck figure.chart.live'));
      const fresh = await d.evaluate(() => { const fig = document.querySelector('main#deck figure.chart'), token = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim().toLowerCase();
        return [...fig.querySelectorAll(':scope > svg.render [fill]')].some(p => p.getAttribute('fill').toLowerCase() === token); });
      ok(fresh, 'when ECharts arrives, the saved preview is redrawn in the destination\'s colours');
      ok(!c.errors.length && !again.errors.length && !d.errors.length, `no JavaScript error (${[...c.errors, ...again.errors, ...d.errors]})`);
      await d.close();
    }

    // 12. What the released reader does with a slide (while the examples embed the release, 0.7.2).
    {
      const raw = fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8');
      const version = /<script\b[^>]*\bid="engine"[^>]*\bdata-version="([^"]*)"/.exec(raw)?.[1];
      if (version !== '0.7.2' || raw.includes('copy-slide')) console.log(`SKIP the example decks no longer embed the 0.7.2 engine (${version}); built ${VERSION}`);
      else {
        fs.writeFileSync(path.join(DIR, 'old/deck.html'), raw);
        const old = await open(ctx, path.join(DIR, 'old/deck.html'));
        const before = await mainHTML(old);
        await old.locator('#s05').click({ position: { x: 4, y: 4 } });
        await old.keyboard.press('Escape');
        await dispatchPaste(old, flavours);
        await old.waitForFunction(() => document.querySelector('.hs-banner'));
        const msg = await banner(old);
        ok(msg === 'Paste failed: clipboard envelope: unknown kind. Deck unchanged.' && await mainHTML(old) === before && !old.errors.length,
          `the released 0.7.2 editor refuses a slide with a notice and leaves its deck unchanged ("${msg}")`);
        await old.close();
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
}
counter.close();
console.log(fails ? `\n${fails} failure(s)` : '\nAll Slides slide clipboard checks passed');
process.exit(fails ? 1 : 0);
