import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {zone, preflight} from '../plugin/skills/html-slides/tools/lib.mjs';
import {LAYOUTS, SHAPES, CHART_TYPES} from '../src/engine/templates.js';
import {registry} from '../packages/shared/charts/index.mjs';
import {CONTENT_CLASSES} from '../src/format.js';
import {documentation} from '../tools/guide.mjs';
import {replaceDocumentation} from '../tools/validation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'work/guide-'));
const run=(...args)=>spawnSync(process.execPath,[path.join(root,'plugin/skills/html-slides/tools/deck.mjs'),...args],{encoding:'utf8'});
let base,browser;
before(async()=>{
  const file=path.join(dir,'base.html');
  const r=run('new',file);assert.equal(r.status,0,r.stderr);
  base=fs.readFileSync(file,'utf8');
  browser=await chromium.launch();
});
after(async()=>{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});});
async function open(t,html=base,offline=false){
  const file=path.join(dir,`open-${Date.now()}.html`);fs.writeFileSync(file,html);
  const ctx=await browser.newContext({viewport:{width:1100,height:850}});t.after(()=>ctx.close());
  if(offline)await ctx.setOffline(true);
  const p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(String(e)));t.after(()=>assert.deepEqual(errors,[]));
  await p.goto(pathToFileURL(file).href);await p.waitForFunction(()=>window.deckEngine);
  return p;
}
const guide=p=>p.evaluate(()=>document.querySelector('#html-slides-guide')?.content.querySelector('pre')?.textContent);
test('new decks carry an inert versioned guide before CSS and cover the full catalogue',async t=>{
  const p=await open(t),text=await guide(p);
  assert.ok(text,'embedded guide missing');
  for(const [key]of [...LAYOUTS,...SHAPES,...CHART_TYPES])assert.ok(text.includes('`'+key+'`'),`missing ${key}`);
  for(const key of CONTENT_CLASSES)assert.ok(text.includes('`'+key+'`'),`missing class ${key}`);
  assert.match(text,/main#deck/);assert.match(text,/data-detached/);assert.match(text,/renderAll/);
  const meta=await p.evaluate(()=>({format:document.querySelector('meta[name="html-slides-format-version"]')?.content,docs:document.querySelector('meta[name="html-slides-docs-version"]')?.content,engine:window.deckEngine.version}));
  assert.equal(meta.format,'1');assert.equal(meta.docs,meta.engine);
  assert.ok(base.indexOf('id="html-slides-guide"')<base.indexOf('<style id="charte">'));
  assert.equal(await p.evaluate(()=>document.querySelector('#html-slides-guide').content.querySelectorAll('pre *').length),0);
  preflight(base);
});
test('every embedded chart example is valid for the corresponding renderer',async t=>{
  const p=await open(t),text=await guide(p);
  assert.ok(text);
  for(const [type]of CHART_TYPES){
    const start=text.indexOf('### Data example: '+type+'\n');assert.ok(start>=0,type);
    const json=text.slice(start).match(/```json\n([\s\S]*?)\n```/);assert.ok(json,type);
    assert.deepEqual(registry[type].validate(JSON.parse(json[1])),[],type);
  }
});
test('guide survives browser save and offline reopening without appearing in slide content',async t=>{
  const p=await open(t),before=await guide(p);
  assert.ok(before);
  const saved=await p.evaluate(()=>window.deckEngine.serialize());
  const q=await open(t,saved,true);
  assert.equal(await guide(q),before);
  assert.equal(await q.locator('#deck #html-slides-guide').count(),0);
  assert.equal(await q.locator('#deck > .slide').count(),1);
  preflight(saved);
});
test('upgrade adds documentation to legacy decks, preserves theme and pack keeps existing documentation',()=>{
  const old=base.replace(/<template\b[^>]*id="html-slides-guide"[^>]*>[\s\S]*?<\/template>\s*/,'').replace(/<meta name="html-slides-[^"]*"[^>]*>\s*/g,'');
  const f=path.join(dir,'legacy.html');fs.writeFileSync(f,old);
  const r=run('upgrade',f);assert.equal(r.status,0,r.stderr);
  const next=fs.readFileSync(f,'utf8');assert.ok(next.includes('id="html-slides-guide"'));
  assert.equal(zone(next,'theme'),zone(old,'theme'));assert.equal(zone(next,'main'),zone(old,'main'));
  const custom=next.replace(/(<meta name="html-slides-repository" content=")[^"]*/, '$1https://example.test/html-slides');
  fs.writeFileSync(f,custom);
  const packed=run('pack',f);assert.equal(packed.status,0,packed.stderr);
  assert.ok(fs.readFileSync(f,'utf8').includes('https://example.test/html-slides'));
});
test('documentation rejects active markup, duplicate zones, mismatched versions and executable download URLs',()=>{
  assert.ok(base.includes('id="html-slides-guide"'));
  const bad=[
    base.replace('<pre>','<pre><img src="x" onerror="window.bad=1">'),
    base.replace('</head>','<template id="html-slides-guide"><pre>duplicate</pre></template></head>'),
    base.replace(/name="html-slides-docs-version" content="[^"]*"/,'name="html-slides-docs-version" content="999.0.0"'),
    base.replace('</head>','<meta name="html-slides-skill-download" content="javascript:alert(1)"></head>')
  ];
  for(const html of bad)assert.throws(()=>preflight(html));
});
test('help exposes the embedded guide and returns to shortcuts without modifying the deck',async t=>{
  const p=await open(t),before=await p.locator('#deck').innerHTML();
  await p.keyboard.press('?');
  await p.locator('.hs-panel button',{hasText:'File format'}).click();
  await p.locator('.hs-guide-text').waitFor({state:'visible'});
  assert.equal(await p.evaluate(()=>document.activeElement?.className),'hs-guide-text');
  assert.match(await p.locator('.hs-guide-text').textContent(),/main#deck/);
  assert.equal(await p.locator('.hs-guide-links a').count(),3);
  await p.screenshot({path:path.join(root,'work/guide-help.png')});
  await p.locator('.hs-panel button',{hasText:'Back to help'}).click();
  assert.equal(await p.locator('.hs-keys').count(),1);
  assert.equal(await p.locator('#deck').innerHTML(),before);
  await p.locator('.hs-panel button',{hasText:'File format'}).click();
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.hs-panel').count(),0);
});
function fixture(config,guideText){
  const mock=fs.mkdtempSync(path.join(dir,'source-'));
  for(const f of ['src/guide.md',...['FORMAT','CATALOGUE','CHARTS'].map(x=>`plugin/skills/html-slides/references/${x}.md`)]){
    fs.mkdirSync(path.dirname(path.join(mock,f)),{recursive:true});fs.copyFileSync(path.join(root,f),path.join(mock,f));
  }
  if(guideText)fs.writeFileSync(path.join(mock,'src/guide.md'),guideText);
  fs.writeFileSync(path.join(mock,'src/distribution.json'),JSON.stringify(config));
  return mock;
}
test('build escapes documentation markup and exposes configured compatible links without fetching them',async t=>{
  const config={repository:'https://example.test/project',documentationUrl:'https://example.test/v0.6/docs?x=1&y=2',skillDownloadUrl:'https://example.test/v0.6/plugin.zip'};
  const mock=fixture(config,'Reference </pre></template><script>window.bad=1</script>');
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  const doc=documentation(mock,version),html=replaceDocumentation(base,doc.html);
  preflight(html);
  const p=await open(t,html),requests=[];
  p.on('request',r=>requests.push(r.url()));
  assert.equal(await p.evaluate(()=>window.bad),undefined);
  assert.match(await guide(p),/<script>window.bad=1<\/script>/);
  await p.keyboard.press('?');await p.locator('.hs-panel button',{hasText:'File format'}).click();
  assert.deepEqual(await p.locator('.hs-guide-links a').evaluateAll(nodes=>nodes.map(n=>n.href)),Object.values(config));
  assert.deepEqual(requests,[]);
});
test('build refuses non-HTTPS distribution configuration',()=>{
  const mock=fixture({skillDownloadUrl:'javascript:alert(1)'});
  assert.throws(()=>documentation(mock,'0.6.0'),/HTTPS/);
});
