import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {ASSETS,upgrade,withOffline} from '../plugin/skills/html-slides/tools/lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'work/sri-'));
const url='https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js';
const raw=fs.readFileSync(path.join(root,'node_modules/echarts/dist/echarts.min.js'));
const expected='sha384-'+createHash('sha384').update(raw).digest('base64');
let browser,base;
before(async()=>{
  base=upgrade(fs.readFileSync(path.join(root,'plugin/skills/html-slides/examples/community-garden.html'),'utf8'));
  browser=await chromium.launch();
});
after(async()=>{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});});
async function open(t,mode){
  const file=path.join(dir,mode+'.html');fs.writeFileSync(file,mode==='offline'?withOffline(base,true):base);
  const ctx=await browser.newContext();t.after(()=>ctx.close());
  if(mode==='offline')await ctx.setOffline(true);
  const p=await ctx.newPage(),requests=[],errors=[];
  p.on('request',r=>{if(r.url().startsWith('https:'))requests.push(r.url());});
  p.on('pageerror',e=>errors.push(String(e)));t.after(()=>assert.deepEqual(errors,[]));
  // Playwright adds CORS when the header is missing: an explicit wrong origin tests the refusal.
  await p.route(url,route=>mode==='blocked'?route.abort():route.fulfill({
    body:mode==='altered'?Buffer.concat([raw,Buffer.from('\nwindow.__tamperedECharts=true;')]):raw,
    contentType:'application/javascript',headers:{'access-control-allow-origin':mode==='no-cors'?'https://wrong-origin.test':'*'}
  }));
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>window.deckEngine);
  const ready=await p.evaluate(()=>window.deckEngine.ready);
  return {p,requests,ready};
}
async function fallback(p){
  assert.equal(await p.locator('figure.chart.live').count(),0);
  assert.ok(await p.locator('#deck figure.chart > svg.render').count()>0);
  assert.equal(await p.locator('#deck figure.chart > svg.render').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).display!=='none' && n.getBoundingClientRect().width>0)),true);
}
test('matching CDN bytes load with pinned integrity and anonymous CORS',async t=>{
  const {p,ready}=await open(t,'good');assert.equal(ready,true);
  const attrs=await p.locator(`script[src="${url}"]`).evaluate(n=>({integrity:n.integrity,cors:n.crossOrigin}));
  assert.deepEqual(attrs,{integrity:expected,cors:'anonymous'});
  assert.ok(await p.locator('figure.chart.live').count()>0);
});
test('altered CDN script is never executed and cached SVGs remain visible',async t=>{
  const {p,ready}=await open(t,'altered');assert.equal(ready,false);
  assert.equal(await p.evaluate(()=>window.__tamperedECharts),undefined);
  assert.equal(await p.evaluate(()=>window.echarts),undefined);
  await fallback(p);
});
test('wrong CORS authorization refuses the remote script and keeps SVG fallback',async t=>{
  const {p,ready}=await open(t,'no-cors');assert.equal(ready,false);await fallback(p);
});
test('unavailable network keeps SVG fallback',async t=>{
  const {p,ready}=await open(t,'blocked');assert.equal(ready,false);await fallback(p);
});
test('embedded ECharts works offline without any CDN request',async t=>{
  const {p,ready,requests}=await open(t,'offline');assert.equal(ready,true);
  assert.deepEqual(requests,[]);assert.ok(await p.locator('figure.chart.live').count()>0);
});
test('build verification rejects changed dependency bytes and a different version',async()=>{
  const {verifyECharts}=await import('../tools/echarts-integrity.mjs');
  assert.doesNotThrow(()=>verifyECharts(raw,'6.1.0'));
  assert.throws(()=>verifyECharts(Buffer.concat([raw,Buffer.from('\n')]),'6.1.0'),/integrity/);
  assert.throws(()=>verifyECharts(raw,'99.0.0'),/version/);
  assert.deepEqual(fs.readFileSync(path.join(ASSETS,'echarts.min.js')),raw);
});
