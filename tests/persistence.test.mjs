import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ASSETS, asset, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const dir = fs.mkdtempSync(path.join(root, 'work/persistence-'));
const plain = path.join(dir, 'plain.html');
let browser;
before(async () => {
  execFileSync(process.execPath, [path.join(root, 'plugin/skills/html-slides/tools/deck.mjs'), 'new', plain, '--footer', 'Original']);
  fs.writeFileSync(path.join(dir,'charts.html'), setZone(fs.readFileSync(path.join(root,'plugin/skills/html-slides/examples/community-garden.html'),'utf8'),'engine',asset('engine.js')));
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); fs.rmSync(dir, {recursive:true, force:true}); });
async function open(t, file = plain, options = {}) {
  const ctx = await browser.newContext({viewport:{width:1100,height:850},acceptDownloads:true,...options});
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept('Test image'));
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/,r => r.fulfill({path:path.join(ASSETS,'echarts.min.js'),contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}}));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  await page.keyboard.press('e');
  return page;
}
async function footer(page, value) {
  await page.locator('.hs-ctx button',{hasText:'Footer'}).click();
  await page.locator('.hs-panel input').first().fill(value);
  await page.locator('.hs-panel button',{hasText:'Apply'}).click();
}
test('draft restores metadata, images and slide navigation after reload', async t => {
  const p = await open(t);
  await footer(p, 'New footer');
  await p.evaluate(async () => {
    const c=document.createElement('canvas'); c.width=100;c.height=50;
    const blob=await new Promise(r=>c.toBlob(r));
    await window.deckEngine.insertImageFile(new File([blob],'image.png',{type:'image/png'}));
  });
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  await p.locator('.hs-banner button',{hasText:'Restore'}).click();
  assert.equal(await p.locator('#deck').getAttribute('data-footer'), 'New footer');
  await p.waitForFunction(()=>document.querySelector('#deck img')?.naturalWidth === 100);
  await p.keyboard.press('e');
  await p.waitForFunction(()=>document.querySelectorAll('.hs-thumb').length === 1);
  assert.equal(await p.locator('.hs-thumb').count(), 1);
});
test('save uses the selected file and keeps later edits dirty, including a second queued save', async t => {
  const p=await open(t);
  await p.evaluate(()=>{
    window.__writes=[];window.__pickers=0;
    window.showSaveFilePicker=async()=>{window.__pickers++;return {name:'chosen.html',createWritable:async()=>({
      write:async html=>{window.__writes.push(html);await new Promise(r=>window.__release=r);}, close:async()=>{}
    })};};
  });
  await p.keyboard.press('Control+s');await p.waitForFunction(()=>window.__writes.length===1);
  await footer(p,'During the save');
  await p.keyboard.press('Control+s');
  assert.equal(await p.evaluate(()=>window.__writes.length),1);
  await p.evaluate(()=>window.__release());
  await p.waitForFunction(()=>window.__writes.length===2);
  assert.equal(await p.locator('.hs-save.dirty').count()>0,true);
  assert.equal(await p.evaluate(()=>window.__writes[0].includes('During the save')),false);
  assert.ok(await p.evaluate(()=>localStorage.getItem('html-slides:'+location.pathname)));
  await p.evaluate(()=>window.__release());await p.waitForFunction(()=>!document.querySelector('.hs-save.dirty'));
  assert.equal(await p.evaluate(()=>window.__pickers),1);
  assert.equal(await p.evaluate(()=>window.__writes[1].includes('During the save')),true);
  assert.equal(await p.evaluate(()=>localStorage.getItem('html-slides:'+location.pathname)),null);
});
test('cancelled picker and failed write preserve edits and draft', async t => {
  const p=await open(t);await footer(p,'Keep this');
  await p.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('cancel','AbortError');};});
  await p.keyboard.press('Control+s');
  assert.ok(await p.evaluate(()=>localStorage.getItem('html-slides:'+location.pathname)));
  await p.evaluate(()=>{window.showSaveFilePicker=async()=>({createWritable:async()=>{throw new Error('disk full');}});});
  await p.keyboard.press('Control+s');
  await p.waitForFunction(()=>document.querySelector('.hs-banner')?.textContent.includes('Save failed'));
  assert.equal(await p.locator('.hs-save.dirty').count()>0,true);
  assert.ok(await p.evaluate(()=>localStorage.getItem('html-slides:'+location.pathname)));
});
test('chart JSON with a closing script tag survives download and reopening', async t => {
  const p=await open(t,path.join(dir,'charts.html'));
  await p.locator('#s04').scrollIntoViewIfNeeded();
  await p.locator('#s04 > figure.chart').dblclick({position:{x:200,y:200}});
  const title='A test </script><script>window.bad=1</script> text';
  await p.locator('.hs-panel input').first().fill(title);
  await p.locator('.hs-panel button',{hasText:'Apply'}).click();
  await p.evaluate(()=>{delete window.showSaveFilePicker;});
  const dl=p.waitForEvent('download');await p.keyboard.press('Control+s');
  const saved=path.join(dir,'saved.html');await (await dl).saveAs(saved);
  const q=await open(t,saved);
  assert.equal(await q.evaluate(()=>window.bad),undefined);
  assert.equal(await q.evaluate(()=>JSON.parse(document.querySelector('#s04 figure.chart > script').textContent).title),title);
  assert.deepEqual(await q.evaluate(()=>window.deckEngine.validateCharts().flatMap(x=>x.errors)),[]);
});
test('a text-only deck can insert its first chart', async t => {
  const p=await open(t);
  await p.locator('.hs-top button',{hasText:'Chart'}).click();
  await p.locator('.hs-menu button',{hasText:'Columns'}).click();
  await p.locator('.hs-panel').waitFor({state:'visible'});
  assert.equal(await p.locator('#deck figure.chart.live').count(),1);
});
test('download fallback keeps the draft because the opened file is unchanged', async t => {
  const p=await open(t);await footer(p,'Downloaded');
  await p.evaluate(()=>{delete window.showSaveFilePicker;});
  const dl=p.waitForEvent('download');await p.keyboard.press('Control+s');await dl;
  await p.waitForFunction(()=>!document.querySelector('.hs-save.dirty'));
  assert.ok(await p.evaluate(()=>localStorage.getItem('html-slides:'+location.pathname)));
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  const banner=p.locator('.hs-banner');
  assert.doesNotMatch(await banner.textContent(),/different version/);
  await banner.locator('button',{hasText:'Restore'}).click();
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),'Downloaded');
});
test('a draft made from another version of the file is flagged before restoring', async t => {
  const file=path.join(dir,'replaced.html');fs.copyFileSync(plain,file);
  const p=await open(t,file);await footer(p,'Old edit');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('data-footer="Original"','data-footer="Regenerated"'));
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  const banner=p.locator('.hs-banner');
  assert.match(await banner.textContent(),/different version of this file/);
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),'Regenerated');
  await banner.locator('button',{hasText:'Restore older draft'}).click();
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),'Old edit');
});
test('restored drafts are stripped of code and external resources', async t => {
  const p=await open(t);
  await p.evaluate(()=>{
    const main='<main id="deck" data-footer="Injected" onclick="window.pwned=1"><section class="slide" id="s01" data-layout="default">'+
      '<h1 data-id="e1">Draft</h1><img data-id="e2" alt="x" src="https://example.invalid/a.png" srcset="https://example.invalid/b.png 1x" onerror="window.pwned=1">'+
      '<p class="body" data-id="e3" style="background:url(https://example.invalid/c.png)">t</p><script>window.pwned=1</script>'+
      '<iframe src="https://example.invalid/"></iframe></section></main>';
    const assets={a1:{type:'image/png',data:'AAAA'},bad:{kind:'font',family:'x";}*{color:red',type:'font/woff2',data:'AAAA'}};
    localStorage.setItem('html-slides:'+location.pathname,JSON.stringify({t:Date.now(),format:1,base:'other',main,assets}));
  });
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  await p.locator('.hs-banner button',{hasText:'Restore'}).click();
  const r=await p.evaluate(()=>({
    pwned:window.pwned,
    attrs:[...document.querySelectorAll('#deck, #deck *')].flatMap(e=>[...e.attributes].map(a=>a.name+'='+a.value)).filter(a=>/^on|^srcset|example\.invalid/.test(a)),
    active:document.querySelectorAll('#deck iframe, #deck script:not([type])').length,
    assets:Object.keys(JSON.parse(document.getElementById('assets').textContent)),
    footer:document.getElementById('deck').dataset.footer
  }));
  assert.equal(r.pwned,undefined);assert.deepEqual(r.attrs,[]);assert.equal(r.active,0);
  assert.deepEqual(r.assets,['a1']);assert.equal(r.footer,'Injected');
});

test('restored CSS escapes cannot issue external requests and valid geometry remains intact',async t=>{
 const p=await open(t,plain,{deviceScaleFactor:2}),requests=[];
 await p.route('https://example.invalid/**',r=>{requests.push(r.request().url());return r.abort();});
 await p.evaluate(()=>{
  const css=String.raw`--x:64;--y:200;--w:400;--h:80;background:u\72l("https://example.invalid/draft.png")`;
  const main=`<main id="deck"><section class="slide" id="s01" data-layout="default" data-detached><h1 data-id="e1" style="--x:64;--y:80;--w:1000;--h:80">Draft</h1><p class="body" data-id="e2" style='${css}'>Text</p><p class="body" data-id="e3" style="--x:64;--y:300;--w:400;--h:80">Safe</p></section></main>`;
  localStorage.setItem('html-slides:'+location.pathname,JSON.stringify({format:1,t:Date.now(),base:'other',main,assets:{}}));
 });
 await p.reload();await p.waitForFunction(()=>window.deckEngine);
 await p.locator('.hs-banner button',{hasText:'Restore'}).click();
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.deepEqual(requests,[]);
 assert.equal(await p.locator('#deck [data-id=e2]').getAttribute('style'),null);
 assert.equal(await p.locator('#deck [data-id=e3]').getAttribute('style'),'--x:64;--y:300;--w:400;--h:80');
});
for(const mode of ['in-place','during-write','save-as']){
 test(`draft identity follows successful saves (${mode}) without warning about older edits`,async t=>{
  const file=path.join(dir,`identity-${mode}.html`),target=mode==='save-as'?path.join(dir,'separate-copy.html'):file;
  fs.copyFileSync(plain,file);const p=await open(t,file);
  await p.exposeFunction('__writeFile',html=>fs.writeFileSync(target,html));
  await p.evaluate(({name,pause})=>{
   window.__written=false;window.__closed=false;
   window.showSaveFilePicker=async()=>({name,createWritable:async()=>({
    write:async html=>{await window.__writeFile(html);window.__written=true;if(pause)await new Promise(r=>window.__finishWrite=r);},
    close:async()=>{window.__closed=true;}
   })});
  },{name:path.basename(target),pause:mode==='during-write'});
  await footer(p,'Saved edit A');await p.keyboard.press('Control+s');
  await p.waitForFunction(()=>window.__written);
  if(mode==='during-write'){
   await footer(p,'Unsaved edit B');await p.evaluate(()=>window.__finishWrite());
   await p.waitForFunction(()=>document.querySelector('.hs-banner')?.textContent.includes('Saved to'));
   assert.ok(await p.locator('.hs-save.dirty').count());
  }else{
   await p.waitForFunction(()=>!document.querySelector('.hs-save.dirty'));
   await footer(p,'Unsaved edit B');
  }
  assert.ok(fs.readFileSync(target,'utf8').includes('Saved edit A'));
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),mode==='save-as'?'Original':'Saved edit A');
  assert.doesNotMatch(await p.locator('.hs-banner').textContent(),/different version|older draft/);
  await p.locator('.hs-banner button',{hasText:'Restore'}).click();
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),'Unsaved edit B');
 });
}

test('download fallback keeps the deck dirty when the browser cannot store a draft', async t => {
  const p=await open(t);
  await p.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};delete window.showSaveFilePicker;});
  await footer(p,'Not stored');
  const dl=p.waitForEvent('download');await p.keyboard.press('Control+s');await dl;
  await p.waitForFunction(()=>document.querySelector('.hs-banner')?.textContent.includes('Copy downloaded'));
  assert.ok(await p.locator('.hs-save.dirty').count());
  assert.match(await p.locator('.hs-banner').textContent(),/could not store a draft/);
});
test('a successful save is reported as saved when the deck has no assets zone', async t => {
  const file=path.join(dir,'no-assets.html');
  fs.writeFileSync(file,fs.readFileSync(plain,'utf8').replace(/<script id="assets"[^>]*>[\s\S]*?<\/script>\n?/,''));
  const p=await open(t,file);
  await p.evaluate(()=>{window.showSaveFilePicker=async()=>({name:'no-assets.html',createWritable:async()=>({write:async()=>{},close:async()=>{}})});});
  await footer(p,'Saved without assets');await p.keyboard.press('Control+s');
  await p.waitForFunction(()=>/Saved to|Save failed/.test(document.querySelector('.hs-banner')?.textContent||''));
  assert.match(await p.locator('.hs-banner').textContent(),/Saved to/);
  assert.equal(await p.locator('.hs-save.dirty').count(),0);
});
test('restored drafts keep accessible SVG titles', async t => {
  const p=await open(t);
  await p.evaluate(()=>{
    const main='<main id="deck"><section class="slide" id="s01" data-layout="default"><h1 data-id="e1">Draft</h1>'+
      '<div class="shape" data-id="e2" data-shape="rect"><svg viewBox="0 0 10 10"><title>Accessible name</title><rect width="10" height="10"></rect></svg></div></section></main>';
    localStorage.setItem('html-slides:'+location.pathname,JSON.stringify({t:Date.now(),format:1,base:'other',main,assets:{}}));
  });
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  await p.locator('.hs-banner button',{hasText:'Restore'}).click();
  assert.equal(await p.evaluate(()=>document.querySelector('#deck svg title')?.textContent),'Accessible name');
});
test('a draft from an engine that did not record versions is not called foreign', async t => {
  const p=await open(t);
  await p.evaluate(()=>{
    const main='<main id="deck" data-footer="Earlier engine"><section class="slide" id="s01" data-layout="default"><h1 data-id="e1">Draft</h1></section></main>';
    localStorage.setItem('html-slides:'+location.pathname,JSON.stringify({t:Date.now(),format:1,main,assets:{}}));
  });
  await p.reload();await p.waitForFunction(()=>window.deckEngine);
  const banner=p.locator('.hs-banner');
  assert.doesNotMatch(await banner.textContent(),/different version|older draft/);
  assert.match(await banner.textContent(),/earlier version of the editor/);
  await banner.locator('button',{hasText:'Restore'}).click();
  assert.equal(await p.locator('#deck').getAttribute('data-footer'),'Earlier engine');
});
