// The html-slides side of the scripted move (ADR-016 §3). The move is a real drag in the deck's own
// editor, in Chromium: the editor detaches the slide and writes the positional `style` geometry
// exactly as it does for a person, and the file is what Save would write. Nothing of the engine is
// reimplemented here. Later, the rendered position of each moved element is compared with where
// the move left it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILL = path.join(ROOT, 'plugin/skills/html-slides');
export const SLIDE = { width: 1280, height: 720 };
export const TOLERANCE = { x: 1.5 / SLIDE.width, y: 1.5 / SLIDE.height };

const skillTools = async () => ({
  ...(await import(pathToFileURL(path.join(SKILL, 'tools/lib.mjs')).href)),
  ...(await import(pathToFileURL(path.join(SKILL, 'tools/echarts.mjs')).href))
});

// Runs in the page. Finds the element a target designates: a direct content child of the slide,
// which is the unit a person can grab in the editor.
function locate({ slide, kind, contains }) {
  const norm = text => String(text ?? '').normalize('NFKC').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const section = document.querySelectorAll('main#deck > section.slide')[slide - 1];
  if (!section) return { reason: `the deck has no slide ${slide}` };
  const items = [...section.children].filter(el => el.tagName !== 'ASIDE' && !el.hasAttribute('data-ui'));
  const text = el => { const copy = el.cloneNode(true); copy.querySelectorAll('script, svg, style').forEach(n => n.remove()); return norm(copy.textContent); };
  let item = null;
  if (kind === 'chart') item = items.find(el => el.matches('figure.chart') || el.querySelector('figure.chart'));
  else if (kind === 'table') item = items.find(el => el.matches('table') || el.querySelector('table'));
  else if (kind === 'text') {
    const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    item = items.filter(el => text(el).includes(norm(contains))).sort((a, b) => area(a) - area(b))[0];
  } else return { reason: `unknown target kind ${kind}` };
  if (!item) return { reason: 'no matching element on the slide' };
  return { id: item.dataset.id, slideId: section.id, tag: item.tagName.toLowerCase(), cls: item.className, text: text(item),
    slideTexts: items.map(text).filter(Boolean) };
}

// Runs in the page. The element's rendered box in slide pixels, as the engine measures it.
function measure(id) {
  const el = document.querySelector(`main#deck > section.slide > [data-id="${id}"]`);
  if (!el) return null;
  const slide = el.closest('section.slide');
  const sr = slide.getBoundingClientRect(), k = sr.width / 1280, r = el.getBoundingClientRect();
  return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k, detached: slide.hasAttribute('data-detached'), style: el.getAttribute('style') || '', slideId: slide.id };
}

// Runs in the page. A point of the element, in viewport pixels, where a click reaches it.
function grabPoint(id) {
  const el = document.querySelector(`main#deck > section.slide > [data-id="${id}"]`);
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const spots = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8], [0.5, 0.1], [0.5, 0.9]];
  for (const [fx, fy] of spots) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return { x, y };
  }
  return null;
}

const fraction = box => ({ x: box.x / SLIDE.width, y: box.y / SLIDE.height, w: box.w / SLIDE.width, h: box.h / SLIDE.height });

export async function moveDeck(source, destination, move) {
  const { loadPlaywright, ASSETS, ECHARTS_URL, preflight } = await skillTools();
  preflight(fs.readFileSync(source, 'utf8'));
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    const url = pathToFileURL(path.resolve(source)).href;
    await page.route('**/*', route => {
      const request = route.request();
      if (request.url() === ECHARTS_URL) return route.fulfill({ path: path.join(ASSETS, 'echarts.min.js'), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
      return request.url() === url && request.isNavigationRequest() ? route.continue() : route.abort();
    });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url);
    await page.waitForFunction(() => window.deckEngine, null, { timeout: 15000 });
    await page.evaluate(() => window.deckEngine.ready);
    await page.keyboard.press('e');
    await page.waitForFunction(() => document.body.classList.contains('hs-editing'), null, { timeout: 5000 });
    const scale = Number(await page.evaluate(() => getComputedStyle(document.getElementById('deck')).getPropertyValue('--s'))) || 1;

    const targets = [];
    const taken = new Set();
    for (const target of move.targets) {
      const found = await page.evaluate(locate, target);
      const result = { ...target, resolved: false, shapes: [] };
      if (found.reason || !found.id || taken.has(found.id)) { targets.push({ ...result, reason: found.reason ?? 'no element with an identifier, or already moved' }); continue; }
      taken.add(found.id);
      const dx = (target.dx ?? move.dx) * SLIDE.width, dy = (target.dy ?? move.dy) * SLIDE.height;
      const before = await page.evaluate(measure, found.id);
      const point = await page.evaluate(grabPoint, found.id);
      if (!point) throw new Error(`slide ${target.slide}: ${target.label} is covered by another element and cannot be grabbed`);
      // Alt: a free move, without snapping to the grid or to the guides.
      await page.mouse.move(point.x, point.y);
      await page.keyboard.down('Alt');
      await page.mouse.down();
      await page.mouse.move(point.x + dx * scale / 2, point.y + dy * scale / 2, { steps: 4 });
      await page.mouse.move(point.x + dx * scale, point.y + dy * scale, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.keyboard.press('Escape');
      const after = await page.evaluate(measure, found.id);
      if (!after?.detached || !/--x:/.test(after.style)) throw new Error(`slide ${target.slide}: the editor did not detach the slide when ${target.label} was dragged`);
      if (Math.abs(after.x - before.x - dx) > 2 || Math.abs(after.y - before.y - dy) > 2)
        throw new Error(`slide ${target.slide}: ${target.label} moved by ${(after.x - before.x).toFixed(1)}, ${(after.y - before.y).toFixed(1)} px instead of ${dx.toFixed(1)}, ${dy.toFixed(1)}`);
      result.shapes.push({ id: found.id, slideId: found.slideId, tag: found.tag, cls: found.cls, text: found.text, chart: target.kind === 'chart', table: target.kind === 'table',
        slideTexts: found.slideTexts, before: fraction(before), after: fraction(after) });
      targets.push({ ...result, resolved: true });
    }
    if (errors.length) throw new Error(`page errors while moving: ${errors.join('; ')}`);
    const html = await page.evaluate(() => window.deckEngine.serialize());
    preflight(html);
    fs.writeFileSync(destination, html);
    const slides = await page.evaluate(() => document.querySelectorAll('main#deck > section.slide').length);
    return { width: SLIDE.width, height: SLIDE.height, slides, targets };
  } finally { await browser.close(); }
}

// Runs in the page. Finds a moved element again: by its identifier; else an element of the same
// kind with the same text; else, for a chart or a table, the only one on the most similar slide.
function findAgain(moved) {
  const norm = text => String(text ?? '').normalize('NFKC').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const text = el => { const copy = el.cloneNode(true); copy.querySelectorAll('script, svg, style').forEach(n => n.remove()); return norm(copy.textContent); };
  const box = el => {
    const slide = el.closest('section.slide'), sr = slide.getBoundingClientRect(), k = sr.width / 1280, r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k / 1280, y: (r.top - sr.top) / k / 720, slideId: slide.id, detached: slide.hasAttribute('data-detached') };
  };
  const slides = [...document.querySelectorAll('main#deck > section.slide')];
  const itemsOf = slide => [...slide.children].filter(el => el.tagName !== 'ASIDE' && !el.hasAttribute('data-ui'));
  const kind = el => (el.matches('figure.chart') || el.querySelector('figure.chart') ? 'chart' : el.matches('table') || el.querySelector('table') ? 'table' : el.tagName.toLowerCase());
  const wanted = moved.chart ? 'chart' : moved.table ? 'table' : moved.tag;
  const same = document.querySelector(`main#deck > section.slide > [data-id="${moved.id}"]`);
  if (same && kind(same) === wanted) return { how: 'same identifier', ...box(same) };
  const all = slides.flatMap(itemsOf).filter(el => kind(el) === wanted);
  if (moved.text) {
    const twins = all.filter(el => text(el) === moved.text).map(el => ({ how: 'same kind and same text', ...box(el) }))
      .sort((a, b) => Math.hypot(a.x - moved.after.x, a.y - moved.after.y) - Math.hypot(b.x - moved.after.x, b.y - moved.after.y));
    if (twins.length) return twins[0];
  }
  if (moved.chart || moved.table) {
    const original = new Set(moved.slideTexts ?? []);
    const scored = slides.map(slide => {
      const texts = new Set(itemsOf(slide).map(text).filter(Boolean));
      const shared = [...texts].filter(t => original.has(t)).length;
      const union = texts.size + original.size - shared;
      return { own: itemsOf(slide).filter(el => kind(el) === wanted), score: union ? shared / union : 0 };
    }).filter(entry => entry.own.length === 1 && entry.score >= 0.5).sort((a, b) => b.score - a.score);
    if (scored.length) return { how: 'the only one of its kind on the most similar slide', ...box(scored[0].own[0]) };
  }
  return null;
}

export async function checkMoves(file, moveResult) {
  const { openDeck } = await skillTools();
  const { browser, page } = await openDeck(file);
  try {
    const targets = [];
    for (const target of moveResult.targets) {
      if (!target.resolved) { targets.push({ slide: target.slide, label: target.label, applied: false, kept: null }); continue; }
      const shapes = [];
      for (const moved of target.shapes) {
        const found = await page.evaluate(findAgain, moved);
        if (!found) { shapes.push({ id: moved.id, found: false, kept: false }); continue; }
        const dx = found.x - moved.after.x, dy = found.y - moved.after.y;
        shapes.push({ id: moved.id, found: true, how: found.how, slideId: found.slideId, detached: found.detached, dx, dy, kept: Math.abs(dx) <= TOLERANCE.x && Math.abs(dy) <= TOLERANCE.y });
      }
      targets.push({ slide: target.slide, label: target.label, applied: true, kept: shapes.every(shape => shape.kept), shapes });
    }
    const applied = targets.filter(target => target.applied);
    return { applied: applied.length, notApplied: targets.length - applied.length, kept: applied.length ? applied.every(target => target.kept) : null, targets };
  } finally { await browser.close(); }
}
