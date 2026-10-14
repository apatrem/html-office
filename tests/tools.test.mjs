import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setZone, zone, upgrade, asset, preflight} from '../plugin/skills/html-slides/tools/lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'work/tools-'));
const tool=name=>path.join(root,'plugin/skills/html-slides/tools',name+'.mjs');
const run=(name,...args)=>spawnSync(process.execPath,[tool(name),...args],{encoding:'utf8'});
let base;
before(()=>{
 const content=path.join(dir,'content.html');
 fs.writeFileSync(content,'<section class="slide" id="s01" data-layout="default"><h1 data-id="e1">Short title</h1><div class="body" data-id="e2">Text.</div></section>');
 const file=path.join(dir,'plain.html');
 assert.equal(run('deck','new',file,'--content',content).status,0);
 base=fs.readFileSync(file,'utf8');
});
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('pack without charts exports PDF and preserves theme and engine',()=>{
 const file=path.join(dir,'no-chart.html'),pdf=path.join(dir,'no-chart.pdf');
 const html=setZone(base,'theme',zone(base,'theme')+'\n/* custom theme */');fs.writeFileSync(file,html);
 const r=run('deck','pack',file,'--pdf',pdf);
 assert.equal(r.status,0,r.stderr);assert.ok(fs.statSync(pdf).size>1000);
 assert.equal(zone(fs.readFileSync(file,'utf8'),'theme').trim(),zone(html,'theme').trim());
 assert.equal(zone(fs.readFileSync(file,'utf8'),'engine').trim(),zone(html,'engine').trim());
});
test('checker rejects self-removing scripts and code outside slides before render',()=>{
 for(const [i,html] of [base.replace('</section>','<script>document.currentScript.remove()</script></section>'),base.replace('</main>','</main><img src="x" onerror="this.remove()">'),setZone(base,'engine',asset('engine.js')+'\nwindow.injected=true;')].entries()){
  const f=path.join(dir,`unsafe-${i}.html`);fs.writeFileSync(f,html);
  const r=run('check',f,'--json');assert.equal(r.status,1,r.stdout+r.stderr);
 }
});
test('since detects deletion and layout geometry changes with unchanged explicit positions',()=>{
 const a=path.join(dir,'geometry-before.html'),b=path.join(dir,'geometry-after.html');
 fs.writeFileSync(a,base);
 fs.writeFileSync(b,base.replace('<div class="body" data-id="e2">Text.</div>',''));
 assert.equal(run('check',b,'--since',a).status,1);
 fs.writeFileSync(b,base.replace('class="body" data-id="e2"','class="body fs-xl" data-id="e2"'));
 const r=run('check',b,'--since',a,'--json');
 assert.equal(r.status,1);assert.match(r.stdout,/Geometry/);
 assert.equal(run('check',b,'--since',a,'--allow','e2').status,0);
});
test('since blocks position removal and order changes; explicit slide authorization allows them',()=>{
 const a=path.join(dir,'before.html'),b=path.join(dir,'after.html');
 fs.writeFileSync(a,base.replace('data-layout="default"','data-layout="default" data-detached').replace('data-id="e1"','data-id="e1" style="--x:64;--y:44;--w:1000;--h:40"').replace('data-id="e2"','data-id="e2" style="--x:64;--y:180;--w:1000;--h:40"'));
 fs.writeFileSync(b,base);
 assert.equal(run('check',b,'--since',a).status,1);
 assert.equal(run('check',b,'--since',a,'--allow','s01').status,0);
 fs.writeFileSync(a,base);
 fs.writeFileSync(b,base.replace('<h1 data-id="e1">Short title</h1><div class="body" data-id="e2">Text.</div>','<div class="body" data-id="e2">Text.</div><h1 data-id="e1">Short title</h1>'));
 assert.equal(run('check',b,'--since',a).status,1);
});
test('upgrade is explicit and preserves theme unless requested',()=>{
 const html=setZone(base,'theme','/* customer theme */');
 assert.equal(zone(upgrade(html),'theme'),'/* customer theme */');
 const f=path.join(dir,'upgrade.html');fs.writeFileSync(f,html);
 const r=run('deck','upgrade',f);
 assert.equal(r.status,0,r.stderr);
 assert.equal(zone(fs.readFileSync(f,'utf8'),'theme'),'/* customer theme */');
 assert.equal(fs.readFileSync(f+'.bak','utf8'),html);
});
test('failed pack leaves the original HTML and PDF intact',()=>{
 const f=path.join(dir,'bad-chart.html'),pdf=path.join(dir,'previous.pdf');
 const html=base.replace('</section>','<figure class="chart" data-type="column"><script type="application/json">null</script></figure><p class="source">Test</p></section>');
 fs.writeFileSync(f,html);fs.writeFileSync(pdf,'previous pdf');
 assert.equal(run('deck','pack',f,'--pdf',pdf).status,1);
 assert.equal(fs.readFileSync(f,'utf8'),html);assert.equal(fs.readFileSync(pdf,'utf8'),'previous pdf');
});
test('inert check rejects attributes and styles that load external resources',()=>{
 const slide='<section class="slide" id="s01" data-layout="default">';
 const cases={
  srcset:'<img alt="x" srcset="https://example.invalid/a.png 1x">',
  background:'<table class="t"><tr><td background="https://example.invalid/b.png">x</td></tr></table>',
  ping:'<p class="body"><a href="#" ping="https://example.invalid/p">x</a></p>',
  poster:'<video poster="https://example.invalid/v.png"></video>',
  styleUrl:'<p class="body" style="background:url(https://example.invalid/c.png)">x</p>',
  imageSet:'<p class="body" style="background:image-set(\'https://example.invalid/d.png\' 1x)">x</p>',
  svgUrl:'<p class="body"><svg><rect fill="url(https://example.invalid/e.svg#g)"/></svg></p>',
  svgHref:'<p class="body"><svg><image href="https://example.invalid/f.png"/></svg></p>'
 };
 for(const [name,frag] of Object.entries(cases)) assert.throws(()=>preflight(base.replace(slide,slide+frag)),/External resources|Forbidden attribute/,name);
 assert.throws(()=>preflight(setZone(base,'charte',zone(base,'charte')+'\n@import url(https://example.invalid/g.css);')),/@import/);
 assert.throws(()=>preflight(setZone(base,'theme',zone(base,'theme')+'\n.x{background:url(https://example.invalid/h.png)}')),/External resources/);
 preflight(base.replace(slide,slide+'<p class="body"><svg><rect clip-path="url(#c0)"/></svg><a href="https://example.org/">link</a></p>'));
});
test('checker trusts only published engines and the current build',()=>{
 const released=JSON.parse(fs.readFileSync(path.join(root,'src/released-engines.json'),'utf8'));
 const trusted=JSON.parse(asset('trusted-scripts.json'));
 const current=createHash('sha256').update(asset('engine.js').trim()).digest('hex');
 assert.deepEqual(new Set(trusted.engine),new Set([...Object.values(released),current]));
 assert.equal(trusted.echarts.length,1);
});
