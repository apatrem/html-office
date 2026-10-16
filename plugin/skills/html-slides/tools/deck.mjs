#!/usr/bin/env node
// html-slides authoring tools.
//   new      <deck.html> --title "…" [--footer "…"] [--charte f.css] [--content content.html]
//   extract  <deck.html> [--out folder] → content.html (without base64/SVG) and asset files
//   inject   <deck.html> <content.html> → replace content, preserve unchanged SVG caches
//   pack     <deck.html> [--pdf f.pdf] [--offline] [--charte f.css] [--out f.html]
//            → preserve engine/theme, recalculate SVGs, optionally export PDF
//   upgrade  <deck.html> [--theme] [--charte f.css] [--out f.html] → explicit migration with backup
//   pdf      <deck.html> [f.pdf]
//   add-image <deck.html> <image> [--id a1] [--width 1600] [--raw] → add an embedded image
import fs from 'node:fs';
import path from 'node:path';
import { asset, zone, setZone, upgrade, withOffline, openDeck, args, importAny, VERSION, preflight } from './lib.mjs';

const A = args(process.argv.slice(2));
const [cmd, file, second] = A._;
const die = m => { console.error('Error: ' + m); process.exit(1); };
const read = f => fs.readFileSync(f, 'utf8');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const cmds = {
  new() {
    if (!file) die('Missing deck path');
    if (fs.existsSync(file) && !A.force) die(`${file} already exists (add --force to overwrite)`);
    const title = A.title || path.basename(file, '.html');
    const content = A.content ? read(A.content) : '<section class="slide" id="s01" data-layout="cover">\n  <p class="kicker">Short title</p>\n  <h1>Document message title</h1>\n</section>';
    let html = asset('template.html');
    const rep = { TITLE: esc(title), FOOTER: esc(A.footer || ''), CHARTE: A.charte ? read(A.charte) : asset('default.css'),
      THEME: asset('theme.css'), ENGINE: asset('engine.js'), CONTENT: content.trim() };
    html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in rep ? rep[k] : m));
    preflight(html);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, html);
    console.log(`Created: ${file} (engine ${VERSION})`);
  },

  extract() {
    if (!file) die('Missing deck path');
    const html = read(file);
    preflight(html);
    const out = A.out || file.replace(/\.html$/, '') + '.extract';
    fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
    let main = zone(html, 'main');
    if (main === null) die('Zone <main id="deck"> not found');
    main = main.replace(/\s*<svg\b[^>]*\bclass="render"[\s\S]*?<\/svg>/g, '');
    const assets = JSON.parse(zone(html, 'assets') || '{}');
    const written = [];
    for (const [id, a] of Object.entries(assets)) {
      if (!a.data) continue;
      const ext = (a.type || 'image/png').split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const f = path.join(out, 'assets', `${id}.${ext}`);
      fs.writeFileSync(f, Buffer.from(a.data, 'base64'));
      written.push(f);
    }
    const head = `<!-- Content zone of ${path.basename(file)} (engine ${zone(html, 'engine') ? 'present' : 'absent'}).\n` +
      `     Cached chart SVGs and base64 images removed; images in ${path.join(out, 'assets')}.\n` +
      `     After editing: node deck.mjs inject ${file} ${path.join(out, 'content.html')} -->\n`;
    fs.writeFileSync(path.join(out, 'content.html'), head + main.trim() + '\n');
    console.log(`Content: ${path.join(out, 'content.html')}`);
    written.forEach(f => console.log(`Image : ${f}`));
  },

  inject() {
    if (!file || !second) die('usage : inject <deck.html> <content.html>');
    const html = read(file);
    let content = read(second).replace(/^<!--[\s\S]*?-->\s*/, '');
    // Keep a chart's cached SVG when its identifier and data are unchanged.
    const old = zone(html, 'main') || '';
    const caches = {};
    for (const m of old.matchAll(/<figure\b[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)<\/figure>/g)) {
      const json = (m[2].match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
      const svg = (m[2].match(/<svg\b[^>]*\bclass="render"[\s\S]*?<\/svg>/) || [])[0];
      if (json && svg) caches[m[1]] = { json: json.trim(), svg };
    }
    let kept = 0;
    content = content.replace(/(<figure\b[^>]*data-id="([^"]+)"[^>]*>)([\s\S]*?)(<\/figure>)/g, (all, open, id, inner, close) => {
      const json = (inner.match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
      const c = caches[id];
      if (c && json && json.trim() === c.json && !/<svg\b[^>]*\bclass="render"/.test(inner)) { kept++; return open + inner.replace(/\s*$/, '') + '\n    ' + c.svg + '\n  ' + close; }
      return all;
    });
    const next=setZone(html, 'main', '\n' + content.trim() + '\n');preflight(next);
    fs.writeFileSync(file, next);
    console.log(`Content injected into ${file} (${kept} SVG caches preserved). Run pack to recalculate the others.`);
  },

  async pack() {
    if (!file) die('Missing deck path');
    const out = A.out || file;
    let html = read(file);
    if (A.charte) html = setZone(html, 'charte', '\n' + read(A.charte) + '\n');
    html = withOffline(html, A.offline ? true : undefined);
    preflight(html);
    fs.mkdirSync(path.dirname(path.resolve(out)), {recursive:true});
    const staging = fs.mkdtempSync(path.join(path.dirname(path.resolve(out)), '.pack-'));
    let opened;
    let pdfStage;
    try {
      const temp = path.join(staging,'deck.html');fs.writeFileSync(temp,html);
      opened = await openDeck(temp);
      const {page,errors} = opened;
      const ok = await page.evaluate(() => window.deckEngine.ready);
      if (await page.locator('figure.chart').count() && !ok) throw new Error('ECharts unavailable: SVG caches were not recalculated');
      const invalid = await page.evaluate(() => window.deckEngine.validateCharts().flatMap(c => c.errors));
      if (errors.length || invalid.length) throw new Error([...errors,...invalid].join('\n'));
      const serialized = await page.evaluate(() => window.deckEngine.serialize());
      preflight(serialized);
      fs.writeFileSync(temp,serialized);
      if (A.pdf) {
        fs.mkdirSync(path.dirname(path.resolve(A.pdf)),{recursive:true});
        pdfStage=fs.mkdtempSync(path.join(path.dirname(path.resolve(A.pdf)),'.pdf-'));
        await pdf(page,path.join(pdfStage,'deck.pdf'));
      }
      fs.renameSync(temp,out);
      if (pdfStage) fs.renameSync(path.join(pdfStage,'deck.pdf'),A.pdf);
    } finally {
      await opened?.browser.close();
      fs.rmSync(staging,{recursive:true,force:true});
      if (pdfStage) fs.rmSync(pdfStage,{recursive:true,force:true});
    }
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`Packed: ${out} (${kb} KB${A.offline ? ', ECharts embedded' : ''})${A.pdf ? ' ; PDF : ' + A.pdf : ''}`);
  },

  upgrade() {
    if (!file) die('Missing deck path');
    const html=read(file);preflight(html);
    const next=upgrade(html,{charte:A.charte,theme:!!A.theme});preflight(next);
    const out=A.out || file;
    fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
    if (path.resolve(out) === path.resolve(file)) {
      const backup=fs.existsSync(file+'.bak') ? file+'.bak-'+Date.now() : file+'.bak';
      fs.writeFileSync(backup,html,{flag:'wx'});
      console.log('Backup: '+backup);
    }
    const dir=fs.mkdtempSync(path.join(path.dirname(path.resolve(out)),'.upgrade-'));
    try { const tmp=path.join(dir,'deck.html');fs.writeFileSync(tmp,next);fs.renameSync(tmp,out); }
    finally { fs.rmSync(dir,{recursive:true,force:true}); }
    console.log(`Engine updated: ${out} (${VERSION}${A.theme ? ', theme updated' : ', theme preserved'})`);
  },

  async pdf() {
    if (!file) die('Missing deck path');
    const target = second || file.replace(/\.html$/, '.pdf');
    const { browser, page } = await openDeck(file);
    await pdf(page, target);
    await browser.close();
    console.log(`PDF : ${target}`);
  },

  async 'add-image'() {
    if (!file || !second) die('usage : add-image <deck.html> <image> [--id a1]');
    const html = read(file);
    const assets = JSON.parse(zone(html, 'assets') || '{}');
    const ext = path.extname(second).slice(1).toLowerCase();
    const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' }[ext];
    if (!type) die('Unsupported image format: ' + ext);
    let id = A.id;
    if (!id) { let n = 1; while (assets['a' + n]) n++; id = 'a' + n; }
    let buf = fs.readFileSync(second), t = type;
    // Recompress when sharp is available: at most 1,600 px wide, WebP quality 82.
    if (type !== 'image/svg+xml' && !A.raw) {
      try {
        const mod = await importAny('sharp');
        if (!mod) throw new Error('sharp absent');
        const sharp = mod.default || mod;
        buf = await sharp(buf).resize({ width: Number(A.width) || 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        t = 'image/webp';
      } catch (e) { /* sharp missing: keep the image as is */ }
    }
    assets[id] = { type: t, data: buf.toString('base64') };
    const next=setZone(html, 'assets', JSON.stringify(assets).replace(/</g,'\\u003c'));preflight(next);
    fs.writeFileSync(file, next);
    console.log(`Image added: ${id} — use as: <img data-asset="${id}" alt="description">`);
  }
};

async function pdf(page, target) {
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: target, width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
}

if (!cmds[cmd]) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
try { await cmds[cmd](); }
catch(e) { console.error('Error: '+e.message); process.exitCode=1; }
