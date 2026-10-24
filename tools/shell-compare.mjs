// U04-Slides acceptance: captures the example deck in the variant A mock-up's states and writes a
// side-by-side page (mock-up, Slides before U04, Slides now) with layout measurements.
// Usage: node tools/shell-compare.mjs [--engine <engine.js> --as before]
//   By default captures the current build as "current"; --engine captures another engine build
//   (the "before" images were taken with the engine of main at 18d68ba).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright, ASSETS, upgrade, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const as = arg('--as') || 'current', engine = arg('--engine');
const out = path.join(ROOT, 'docs/shell-variant-a-slides');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
let html = upgrade(fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'));
if (engine) html = setZone(html, 'engine', '\n' + fs.readFileSync(engine, 'utf8') + '\n');
const file = path.join(ROOT, `work/.shell-compare-${as}.html`);
fs.writeFileSync(file, html);

// The mock-up shows slide 2 of its deck with the chart selected; the example's chart is on slide 4.
const STATES = [
  { id: '1440', width: 1440, height: 900, edit: true, chart: true, target: 'a-slides-1440.jpg', label: 'editing, chart selected' },
  { id: '375', width: 375, height: 812, edit: true, chart: true, target: 'a-slides-375.jpg', label: 'editing, chart selected' },
  { id: 'slide-1440', width: 1440, height: 900, edit: true, label: 'editing, nothing selected' },
  { id: 'reading-1440', width: 1440, height: 900, label: 'reading' },
  { id: 'reading-375', width: 375, height: 812, label: 'reading' }
];
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const measured = {};
for (const s of STATES) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  if (s.edit) await page.keyboard.press('e');
  await page.evaluate(() => document.querySelector('#s04').scrollIntoView({ block: 'center' }));
  if (s.chart) await page.locator('#s04 > figure.chart').click();
  else if (s.edit) { await page.locator('#s04 > .tracker').click(); await page.keyboard.press('Escape'); }
  await page.mouse.move(0, s.height / 2);
  await page.waitForTimeout(400);
  measured[s.id] = await page.evaluate(() => {
    const slide = document.querySelector('#s04').getBoundingClientRect();
    const chrome = [...document.querySelectorAll('.hs-shell, .hs-top, .hs-ctx')].filter(e => getComputedStyle(e).display !== 'none');
    return { slideWidth: Math.round(slide.width), chromeHeight: Math.max(0, ...chrome.map(e => Math.round(e.getBoundingClientRect().bottom))),
      pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  await page.screenshot({ path: path.join(out, `${as}-${s.id}.jpg`), type: 'jpeg', quality: 82 });
  await page.close();
}
await browser.close();
fs.rmSync(file);
const mfile = path.join(out, 'measurements.json');
const all = fs.existsSync(mfile) ? JSON.parse(fs.readFileSync(mfile, 'utf8')) : {};
all[as] = measured;
fs.writeFileSync(mfile, JSON.stringify(all, null, 2) + '\n');

const cell = (set, id, key) => all[set]?.[id] ? String(all[set][id][key]) : '—';
const fig = (src, alt, cap) => `<figure><img src="${src}" alt="${alt}"><figcaption>${cap}</figcaption></figure>`;
const rows = STATES.map(s => `<tr><th scope="row">${s.width} × ${s.height}, ${s.label}</th><td>${cell('before', s.id, 'chromeHeight')} px</td><td>${cell('current', s.id, 'chromeHeight')} px</td><td>${cell('before', s.id, 'slideWidth')} px</td><td>${cell('current', s.id, 'slideWidth')} px</td><td>${cell('before', s.id, 'pageScroll')} / ${cell('current', s.id, 'pageScroll')}</td></tr>`).join('');
const sections = STATES.map(s => `<section><h2>${s.width} × ${s.height} · ${s.label}</h2><div class="pair">${
  s.target ? fig(`../mockups/shell/screenshots/${s.target}`, `Variant A mock-up at ${s.width} × ${s.height}`, 'Variant A mock-up (U02)') : ''}${
  fig(`before-${s.id}.jpg`, `html-slides before U04-Slides at ${s.width} × ${s.height}`, 'html-slides before U04-Slides')}${
  fig(`current-${s.id}.jpg`, `html-slides after U04-Slides at ${s.width} × ${s.height}`, 'html-slides after U04-Slides')}</div></section>`).join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Slides variant A parity</title>
<style>body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1d2a35;background:#f6f7f9}main{max-width:1800px;margin:0 auto;padding:24px 16px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:start}figure{margin:0}img{width:100%;height:auto;border:1px solid #dde1e6;border-radius:6px;background:#fff;display:block}table{border-collapse:collapse;background:#fff;border:1px solid #dde1e6}th,td{padding:7px 12px;border-bottom:1px solid #dde1e6;text-align:left}</style></head><body><main>
<h1>Slides shell: variant A mock-up and html-slides</h1>
<p>Example deck <code>community-garden.html</code>, slide 4. The mock-up shows its own fictional deck and a document-settings panel (theme and font, task TH02), which this task does not add. Regenerate with <code>node tools/shell-compare.mjs</code>.</p>
<table><thead><tr><th scope="col">State</th><th scope="col">Chrome height, before</th><th scope="col">Chrome height, now</th><th scope="col">Slide width, before</th><th scope="col">Slide width, now</th><th scope="col">Page scroll, before / now</th></tr></thead><tbody>${rows}</tbody></table>
${sections}
</main></body></html>
`);
console.log(`${as}: ${STATES.length} states captured in ${path.relative(ROOT, out)}`);
