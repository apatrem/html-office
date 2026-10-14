// Fonctions communes aux outils de l'atelier (deck.mjs, check.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { inspectHTML, replaceParsedZone, replaceDocumentation } from './validation.mjs';
import {ECHARTS_URL} from './echarts.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.resolve(HERE, '../assets');
export const asset = name => fs.readFileSync(path.join(ASSETS, name), 'utf8');
export const VERSION = asset('VERSION').trim();

// ---------- zones du fichier ----------
const RX = {
  main: /(<main\b[^>]*\bid="deck"[^>]*>)([\s\S]*?)(<\/main>)/,
  engine: /(<script\b[^>]*\bid="engine"[^>]*>)([\s\S]*?)(<\/script>)/,
  theme: /(<style\b[^>]*\bid="theme"[^>]*>)([\s\S]*?)(<\/style>)/,
  charte: /(<style\b[^>]*\bid="charte"[^>]*>)([\s\S]*?)(<\/style>)/,
  assets: /(<script\b[^>]*\bid="assets"[^>]*>)([\s\S]*?)(<\/script>)/,
  echarts: /<script\b[^>]*\bid="echarts"[^>]*>[\s\S]*?<\/script>\s*/
};
export function zone(html, name) { const m = html.match(RX[name]); return m ? m[2] : null; }
export function setZone(html, name, content) {
  return replaceParsedZone(html, name === 'main' ? 'deck' : name, content);
}
export function setEngineVersion(html) {
  return html.replace(/(<script\b[^>]*\bid="engine"[^>]*\bdata-version=")[^"]*(")/, `$1${VERSION}$2`)
    .replace(/(<meta name="generator" content="html-slides )[^"]*(")/, `$1${VERSION}$2`);
}

export function upgrade(html, { charte, theme = false } = {}) {
  let out = setZone(html, 'engine', '\n' + asset('engine.js') + '\n');
  if (theme) out = setZone(out, 'theme', '\n' + asset('theme.css') + '\n');
  if (charte) out = setZone(out, 'charte', '\n' + fs.readFileSync(charte, 'utf8') + '\n');
  return replaceDocumentation(setEngineVersion(out), asset('documentation.html'));
}

export function withOffline(html, on) {
  if (on === undefined) return html;
  html = html.replace(RX.echarts, '');
  if (!on) return html;
  const ec = asset('echarts.min.js').replace(/<\/script/gi, '<\\/script');
  return html.replace(/(<script\b[^>]*\bid="engine")/, m => `<script id="echarts">\n${ec}\n</script>\n${m}`);
}

// ---------- modules : local, puis installation globale de npm ----------
export async function importAny(name) {
  try { return await import(name); } catch (e) { /* essai suivant */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const req = createRequire(path.join(root, 'noop.js'));
    return await import(pathToFileURL(req.resolve(name)).href);
  } catch (e) { return null; }
}

// ---------- Playwright ----------
export async function loadPlaywright() {
  let req = createRequire(import.meta.url);
  try { req.resolve('playwright'); }
  catch {
    const root = execSync('npm root -g', {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    req = createRequire(path.join(root,'noop.js'));
  }
  try {
    const version=req('playwright/package.json').version;
    if (version!=='1.62.1') throw new Error(`Found Playwright ${version}; version 1.62.1 required`);
    const pw=await import(pathToFileURL(req.resolve('playwright')).href);
    return pw.chromium ? pw : pw.default;
  } catch (e) { throw new Error(e.message+'\nInstall Playwright: npm install -g playwright@1.62.1 && npx playwright install chromium'); }
}
export function preflight(html) {
  const report = inspectHTML(html, JSON.parse(asset('trusted-scripts.json')));
  if (report.out.length) { const e = new Error(report.out.map(x => x.msg).join('\n')); e.report = {out:report.out,n:report.n}; throw e; }
  return report;
}

// Ouvre un deck en mode statique (échelle 1, sans barre d'outils), ECharts servi en local.
export async function openDeck(file, { offlineTest = false } = {}) {
  preflight(fs.readFileSync(file, 'utf8'));
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { window.__DECK_STATIC = true; });
  const url = pathToFileURL(path.resolve(file)).href;
  await page.route('**/*', route => {
    const req=route.request();
    if (req.url()===ECHARTS_URL) return offlineTest ? route.abort() : route.fulfill({path:path.join(ASSETS,'echarts.min.js'),contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});
    return req.url()===url && req.isNavigationRequest() ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.deckEngine, null, { timeout: 15000 });
    await page.evaluate(() => window.deckEngine.ready);
    await page.waitForTimeout(150);
    return { browser, page, errors };
  } catch (e) { await browser.close(); throw e; }
}

export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}
