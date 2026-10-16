import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ASSETS, upgrade, zone, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'work'), {recursive:true});
const dir = fs.mkdtempSync(path.join(root, 'work/thumbnails-'));
let browser;
before(async () => {
  for (const name of ['catalogue', 'community-garden']) {
    fs.writeFileSync(path.join(dir, name+'.html'), upgrade(fs.readFileSync(path.join(root, 'plugin/skills/html-slides/examples', name+'.html'), 'utf8')));
  }
  const example=fs.readFileSync(path.join(dir,'community-garden.html'),'utf8');
  fs.writeFileSync(path.join(dir,'loading.html'),setZone(example,'main',zone(example,'main').replace(/<svg\b[^>]*class="render"[\s\S]*?<\/svg>/g,'')));
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); fs.rmSync(dir, {recursive:true,force:true}); });
async function open(t, name, chartsGate) {
  const ctx = await browser.newContext({viewport:{width:1100,height:850}});
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  t.after(() => assert.deepEqual(errors, []));
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, async r => {
    if (chartsGate) await chartsGate;
    await r.fulfill({path:path.join(ASSETS,'echarts.min.js'),contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto(pathToFileURL(path.join(dir,name+'.html')).href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.deckEngine);
  if (!chartsGate) await page.evaluate(() => window.deckEngine.ready);
  await page.keyboard.press('e');
  await page.waitForFunction(() => document.querySelectorAll('.hs-mini > .slide').length === document.querySelectorAll('#deck > .slide').length);
  return page;
}
async function discrepancies(page) {
  return page.evaluate(() => {
    const out = [];
    const real = [...document.querySelectorAll('#deck > .slide')];
    const minis = [...document.querySelectorAll('.hs-mini > .slide')];
    const content = s => [...s.children].filter(n => !n.hasAttribute('data-ui') && n.tagName!=='ASIDE');
    const rect = (s,n) => {
      const sr=s.getBoundingClientRect(),r=n.getBoundingClientRect(),k=sr.width/1280;
      return [(r.left-sr.left)/k,(r.top-sr.top)/k,r.width/k,r.height/k];
    };
    real.forEach((s,i) => {
      const a=content(s),b=content(minis[i]);
      a.forEach((n,j) => {
        const r=rect(s,n),q=rect(minis[i],b[j]);
        if (r.some((v,k)=>Math.abs(v-q[k])>1.5)) out.push(`${s.id} ${n.tagName}: ${r.map(Math.round)} → ${q.map(Math.round)}`);
      });
    });
    return out;
  });
}
test('thumbnails preserve template and free composition geometry across the catalogue', async t => {
  const p=await open(t,'catalogue');
  await p.locator('.hs-thumb').last().scrollIntoViewIfNeeded();
  await p.locator('.hs-side').screenshot({path:path.join(root,'work/thumbnails-catalogue.png')});
  const diffs=await discrepancies(p);
  assert.deepEqual(diffs,[]);
});
test('moving a template item preserves its siblings and updates the thumbnail through undo and redo', async t => {
  const p=await open(t,'community-garden');
  await p.locator('#s04').scrollIntoViewIfNeeded();
  const peers=() => p.evaluate(() => {
    const s=document.querySelector('#s04'),sr=s.getBoundingClientRect(),k=sr.width/1280;
    return [...s.children].filter(n=>n.dataset.id && n.tagName!=='H1').map(n=> {
      const r=n.getBoundingClientRect();return [n.dataset.id,(r.left-sr.left)/k,(r.top-sr.top)/k];
    });
  });
  const before=await peers();
  await p.locator('#s04 > h1').click();
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(()=>document.querySelector('#s04').hasAttribute('data-detached'));
  const after=await peers();
  before.forEach((r,i)=>assert.ok(r.slice(1).every((v,j)=>Math.abs(v-after[i][j+1])<=1.5),`sibling ${r[0]} moved`));
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await p.locator('.hs-side').screenshot({path:path.join(root,'work/thumbnails-moved.png')});
  assert.deepEqual(await discrepancies(p),[]);
  await p.keyboard.press('Control+z');
  await p.waitForFunction(()=>!document.querySelector('#s04').hasAttribute('data-detached'));
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.deepEqual(await discrepancies(p),[]);
  await p.locator('.hs-thumb').nth(3).click();
  assert.equal(await p.locator('#s04.hs-focus').count(),1);
  assert.deepEqual(await p.evaluate(()=>window.deckEngine.selection()),[]);
  await p.keyboard.press('Control+Shift+z');
  await p.waitForFunction(()=>document.querySelector('#s04').hasAttribute('data-detached'));
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.deepEqual(await discrepancies(p),[]);
});
test('thumbnail identifiers are separate from content and copies stay out of saved files', async t => {
  const p=await open(t,'community-garden');
  const duplicates=await p.evaluate(()=> {
    const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
    return ids.filter((id,i)=>ids.indexOf(id)!==i);
  });
  assert.deepEqual(duplicates,[]);
  const dataIds=await p.evaluate(()=>[...document.querySelectorAll('[data-id]')].map(n=>n.dataset.id));
  assert.equal(new Set(dataIds).size,dataIds.length);
  assert.equal(await p.evaluate(()=>new DOMParser().parseFromString(window.deckEngine.serialize(),'text/html').querySelectorAll('.hs-mini').length),0);
});
test('thumbnails refresh when charts finish loading after entering edit mode', async t => {
  let release;
  const gate=new Promise(r=>release=r);
  t.after(()=>release());
  const p=await open(t,'loading',gate);
  assert.ok(await p.locator('.hs-mini .hs-chart-msg').count()>0);
  release();
  await p.evaluate(()=>window.deckEngine.ready);
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await p.locator('#deck .hs-chart-msg').count(),0);
  assert.equal(await p.locator('.hs-mini .hs-chart-msg').count(),0);
  assert.equal(await p.locator('.hs-mini figure.chart.live .hs-plot svg').count(),await p.locator('#deck figure.chart.live .hs-plot svg').count());
});
