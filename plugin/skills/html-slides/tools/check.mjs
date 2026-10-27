#!/usr/bin/env node
// html-slides checker: renders the deck and lists the errors to fix.
//   node check.mjs <deck.html> [--shots folder] [--since before.html] [--allow e3,e7] [--json]
// Exit code 1 when at least one blocking error remains.
import fs from 'node:fs';
import path from 'node:path';
import { openDeck, args } from './lib.mjs';
import { snapshot, compareSnapshots } from './validation.mjs';
import {CONTENT_CLASSES as CLASSES, THEMES, DECK_FONTS, attributeProblem} from './format.mjs';

const A = args(process.argv.slice(2));
const file = A._[0];
if (!file) { console.error('usage : check.mjs <deck.html> [--shots folder] [--since before.html] [--allow e3,e7] [--json]'); process.exit(2); }

const LAYOUTS = ['default', 'top-left', 'mid-left', 'section', 'quote', 'panel-14', 'panel-13', 'panel-12', 'panel-23', 'three-lines', 'cover', 'end'];

const RUNTIME = ['live', 'hs-sel', 'hs-current', 'hs-editing', 'hs-focus'];
const SHAPES = ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'hexagon', 'parallelogram', 'pentagon', 'chevron', 'arrow-r', 'arrow-l', 'arrow-u', 'arrow-d'];
let opened;
try { opened = await openDeck(file); }
catch (e) {
  if (A.json) console.log(JSON.stringify(e.report || {out:[{level:'error',slide:'-',id:null,msg:e.message}],n:0},null,2));
  else console.error('ERROR:' + e.message);
  process.exit(1);
}
const { browser, page, errors: jsErrors } = opened;
const report = await page.evaluate(({ LAYOUTS, CLASSES, RUNTIME, SHAPES, THEMES, DECK_FONTS }) => {
  const out = [], attributes = [];
  const add = (level, slide, id, msg) => out.push({ level, slide, id, msg });
  // deck appearance: a built-in charte and a body font from the shared lists, or absent
  const deck = document.querySelector('main#deck');
  for (const [name, list] of [['theme', THEMES], ['font', DECK_FONTS]])
    if (deck.hasAttribute('data-' + name) && !list.includes(deck.dataset[name]))
      add('error', '-', null, `Unknown deck ${name} "${deck.dataset[name]}" (data-${name}: ${list.join(', ')}, or remove it for the charte's own)`);
  const slides = [...document.querySelectorAll('main#deck > section.slide')];
  const ids = new Set();
  slides.forEach((s, i) => {
    const sid = s.id || `#${i + 1}`;
    const layout = s.dataset.layout || 'default';
    if (!LAYOUTS.includes(layout)) add('error', sid, null, `Unknown layout "${layout}"`);
    const sr = s.getBoundingClientRect();
    const kids = [...s.children].filter(el => !el.hasAttribute('data-ui') && el.tagName !== 'ASIDE');
    const h1 = s.querySelector(':scope > h1');
    if (!h1 && !['quote'].includes(layout)) add('error', sid, null, 'Missing title (h1)');
    if (h1) {
      const lh = parseFloat(getComputedStyle(h1).lineHeight) || 40;
      const lines = Math.round(h1.getBoundingClientRect().height / lh);
      const max = ['cover', 'end'].includes(layout) ? 3 : 2;
      if (lines > max) add('error', sid, h1.dataset.id, `Title spans ${lines} lines (maximum ${max}): shorten it`);
    }
    if (layout.startsWith('panel-') && !s.hasAttribute('data-detached') && !s.querySelector(':scope > .in-panel'))
      add('warning', sid, null, 'Panel layout missing an in-panel element');
    const hasChart = !!s.querySelector(':scope > figure.chart, :scope > .stack figure.chart');
    const src = s.querySelector(':scope > .source');
    if (hasChart && (!src || !src.textContent.trim())) add('error', sid, null, 'Chart missing source: add <p class="source">');
    kids.forEach(el => {
      const id = el.dataset.id;
      if (id) { if (ids.has(id)) add('error', sid, id, 'Duplicate data-id'); ids.add(id); }
      for (const c of el.classList) if (!CLASSES.includes(c) && !RUNTIME.includes(c)) add('error', sid, id, `Class outside catalogue "${c}"`);
      if (el.matches('.shape') && !SHAPES.includes(el.dataset.shape)) add('error', sid, id, `Unknown shape "${el.dataset.shape || ''}" (data-shape: ${SHAPES.join(', ')})`);
      const st = el.getAttribute('style');
      if (st) {
        const bad = st.split(';').map(x => x.trim()).filter(Boolean).filter(x => !/^--[xywh]\s*:\s*-?\d+(\.\d+)?$/.test(x));
        if (bad.length) add('error', sid, id, `Forbidden style: ${bad.join('; ')} (only --x --y --w --h)`);
      }
      const r = el.getBoundingClientRect();
      const x = r.left - sr.left, y = r.top - sr.top;
      if (r.width && (x < -1 || y < -1 || x + r.width > 1281 || y + r.height > 721)) add('error', sid, id, 'Element outside slide');
      else if (!el.matches('.source, .cartouche, .tracker') && y + r.height > 668 && !['cover', 'end', 'section', 'quote'].includes(layout))
        add('error', sid, id, `Overflows into footer (bottom ${Math.round(y + r.height)} px, limit 668)`);
      if (el.scrollHeight > el.clientHeight + 3 && getComputedStyle(el).overflow !== 'visible' || (s.hasAttribute('data-detached') && el.scrollHeight > el.clientHeight + 3 && !el.matches('figure')))
        add('error', sid, id, 'Text overflows its frame: shorten text or enlarge the frame');
    });
    kids.forEach(el => el.querySelectorAll('*').forEach(d => {
      if (d.closest('figure.chart > svg, figure.chart > [data-ui]') || d.matches('script')) return;
      if (d.hasAttribute('style')) add('error', sid, el.dataset.id, `Forbidden inline text style (<${d.tagName.toLowerCase()} style="…">): use theme classes`);
      if (d.tagName === 'FONT') add('error', sid, el.dataset.id, 'Forbidden <font> tag: use <span class="c-…">');
      if (d.tagName === 'SPAN') for (const c of d.classList) if (!/^(c-(ink|acc|mid|alert|t2|bg)|hl|neg|t2)$/.test(c)) add('error', sid, el.dataset.id, `Text class outside theme "${c}"`);
    }));
    // safety: content must never be able to run code when the file is opened
    [s, ...s.querySelectorAll('*')].forEach(d => {
      if (d.closest('[data-ui]')) return;
      // checked in Node with the shared rules of the inert preflight (format.mjs)
      for (const a of d.attributes) attributes.push({ slide: sid, id: d.dataset.id || null, name: a.name, value: a.value,
        html: d.namespaceURI === 'http://www.w3.org/1999/xhtml' });
      if (d.matches('iframe, object, embed, frame')) add('error', sid, d.dataset.id || null, `Forbidden tag <${d.tagName.toLowerCase()}>`);
      if (d.matches('script') && !(d.getAttribute('type') === 'application/json' && d.parentElement.matches('figure.chart')))
        add('error', sid, d.closest('[data-id]')?.dataset.id || null, 'Scripts in content must contain chart JSON only');
    });
    s.querySelectorAll('img').forEach(img => {
      if (!img.getAttribute('alt')) add('error', sid, img.dataset.id || null, 'Image missing alt text');
      if (img.dataset.asset && !img.getAttribute('src')) add('error', sid, img.dataset.id || null, `Asset "${img.dataset.asset}" missing from assets`);
    });
  });
  window.deckEngine.validateCharts().forEach(c => c.errors.forEach(m => add('error', c.slide, c.id, `chart ${c.type}: ${m}`)));
  return { out, attributes, n: slides.length };
}, { LAYOUTS, CLASSES, RUNTIME, SHAPES, THEMES, DECK_FONTS });
for (const a of report.attributes) {
  const problem = attributeProblem(a.name, a.value, a.html);
  if (problem) report.out.push({ level: 'error', slide: a.slide, id: a.id, msg: problem });
}
delete report.attributes;

// Positions preserved relative to a previous version.
if (A.since) {
  const allow = new Set(String(A.allow || '').split(',').filter(Boolean));
  report.out.push(...compareSnapshots(snapshot(fs.readFileSync(A.since,'utf8')),snapshot(fs.readFileSync(file,'utf8')),allow));
  const geometry = async p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('main#deck > section.slide')].flatMap(s => {
    const sr=s.getBoundingClientRect();
    return [...s.children].filter(n=>n.dataset.id).map(n=>{
      const r=n.getBoundingClientRect();return [n.dataset.id,{slide:s.id,rect:[r.left-sr.left,r.top-sr.top,r.width,r.height]}];
    });
  })));
  let old;
  try {
    old=await openDeck(A.since);
    const before=await geometry(old.page), after=await geometry(page);
    for (const [id,a] of Object.entries(before)) {
      const b=after[id];
      if (b && !allow.has(id) && !allow.has(a.slide) && a.rect.some((v,i)=>Math.abs(v-b.rect[i])>1.5))
        report.out.push({level:'error',slide:a.slide,id,msg:`Geometry changed without permission; if intended: --allow ${id}`});
    }
  } catch(e) {
    report.out.push({level:'error',slide:'-',id:null,msg:'Invalid --since reference: '+e.message});
  } finally { await old?.browser.close(); }
}
jsErrors.forEach(e => report.out.push({ level: 'error', slide: '-', id: null, msg: 'JavaScript error: ' + e }));

if (A.shots) {
  const dir = A.shots === true ? file.replace(/\.html$/, '') + '.shots' : A.shots;
  fs.mkdirSync(dir, { recursive: true });
  const els = await page.$$('main#deck > section.slide');
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: path.join(dir, `slide-${String(i + 1).padStart(2, '0')}.png`) });
  console.log(`Screenshots: ${dir} (${els.length} slides)`);
}
await browser.close();

const errs = report.out.filter(x => x.level === 'error');
if (A.json) console.log(JSON.stringify(report, null, 2));
else {
  for (const x of report.out) console.log(`${x.level.toUpperCase().padEnd(13)} ${x.slide}${x.id ? ' ' + x.id : ''} : ${x.msg}`);
  console.log(`\n${report.n} slides · ${errs.length} error(s) · ${report.out.length - errs.length} other notice(s)`);
}
process.exit(errs.length ? 1 : 0);
