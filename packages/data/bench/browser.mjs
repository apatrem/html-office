// Measures the actual standalone file:// editor; no local server or fake calculator.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {pnl,large} from '../fixtures/generate.mjs';
import {buildWorkbook,measureHTML} from '../tools/build.mjs';
const out=resolve('dist/data-bench');await mkdir(out,{recursive:true});
const recipes=JSON.parse(await readFile(new URL('../fixtures/large-workloads.json',import.meta.url)));
const cases=[{id:'pnl',make:pnl},...recipes.datasets.map(r=>({id:`${r.rows}x${r.columns}-${r.preaggregate?'reused':'scans'}`,make:()=>large(r)}))];
const filter=process.argv.includes('--pnl-only')?c=>c.id==='pnl':()=>true;
const browser=await chromium.launch({args:['--enable-precise-memory-info']});
const report={environment:{date:new Date().toISOString(),node:process.version,browser:browser.version(),platform:os.platform(),architecture:os.arch(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,memoryBytes:os.totalmem()},method:'Standalone offline file://; same pinned IronCalc as standard. Warm edit-to-paint includes result snapshot and DOM refresh. Five input changes after one engine load. Long tasks only during warm edits. WASM memory is maximum sampled allocated linear memory, not process RSS or exact peak. Cold file opening and initial engine/model load reported separately. Network delivery assessed separately.',cases:[]};
try{
 for(const item of cases.filter(filter)){
  console.log(`Building and checking ${item.id}`);let book=item.make();
  const html=await buildWorkbook(book,{offline:true}),file=resolve(out,`${item.id}.html`);await writeFile(file,html);
  const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const cold=performance.now();
  await page.goto(pathToFileURL(file).href,{timeout:180000});await page.getByText('Saved results are current.',{exact:true}).waitFor();
  const coldOpenMS=performance.now()-cold;
  const isPL=item.id==='pnl',sheet=isPL?'Inputs':'Raw',ref=isPL?'B2':book.metadata.benchmark.editedRawCell;
  await page.getByRole('button',{name:sheet,exact:true}).click();await page.locator(`[data-cell="${ref}"]`).click();
  const initial=isPL?.02:book.metadata.benchmark.editedInitialValue;
  await page.evaluate(()=>{
   window.measurements=[];window.longTasks=[];window.measuring=false;
   new PerformanceObserver(list=>{if(window.measuring)window.longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask',buffered:false});
   document.querySelector('#apply').addEventListener('click',()=>window.editStarted=performance.now(),true);
   window.addEventListener('html-data:calculated',event=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.measurements.push({...event.detail,editToPaintMS:performance.now()-window.editStarted});})));
  });
  await page.getByLabel('Cell value').fill(String(initial));await page.getByRole('button',{name:'Apply edit'}).click();await page.waitForFunction(()=>window.measurements.length===1);
  const first=await page.evaluate(()=>window.measurements[0]);await page.evaluate(()=>{window.measurements=[];window.longTasks=[];window.measuring=true;});
  for(let i=1;i<=5;i++){
   await page.getByLabel('Cell value').fill(String(initial+i*(isPL?.001:1)));await page.getByRole('button',{name:'Apply edit'}).click();await page.waitForFunction(n=>window.measurements.length===n,i);
  }
  const measured=await page.evaluate(()=>{window.measuring=false;return{runs:window.measurements,longTasks:window.longTasks,mainJSHeapBytes:performance.memory?.usedJSHeapSize??null};});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save a copy'}).click();const download=await downloadPromise;const saved=resolve(out,`${item.id}-saved.html`);await download.saveAs(saved);
  const savedHTML=await readFile(saved,'utf8'),canonical=JSON.parse(/<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(savedHTML)[1]);
  if(isPL){
   const growth=initial+.005;let expected=1530*25;for(let n=1;n<=12;n++)expected+=155*(1+growth)**n*25;
   assert.ok(Math.abs(canonical.sheets[0].cells.B2.result.value-expected)<1e-7);
  }else{
   const expected=book.metadata.benchmark.expectedTotal+5;
   for(const cell of Object.values(canonical.sheets[1].cells))assert.equal(cell.result.value,expected);
  }
  assert.deepEqual(errors,[]);
  const warmMaxMS=Math.max(...measured.runs.map(r=>r.editToPaintMS)),mainThreadMaxMS=Math.max(0,...measured.longTasks);
  report.cases.push({id:item.id,workload:book.metadata.benchmark,size:measureHTML(html),coldOpenMS,initialLoadEditToPaintMS:first.editToPaintMS,maximumSampledWasmMemoryBytes:Math.max(first.wasmMemoryBytes,...measured.runs.map(r=>r.wasmMemoryBytes)),...measured,warmMaxMS,mainThreadMaxMS,correctness:'All 1000 large-fixture result cells or the P&L revenue total verified after saving',targets:{pnlWarmUnder250MS:!isPL||warmMaxMS<250,warmCalculationMainTaskUnder100MS:mainThreadMaxMS<100}});
  await writeFile(resolve(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:item.id,coldOpenMS,warmMaxMS,mainThreadMaxMS}));await context.close();book=null;globalThis.gc?.();
 }
}finally{await browser.close();}
const outputArg=process.argv.indexOf('--output');if(outputArg>=0)await writeFile(resolve(process.argv[outputArg+1]),JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--check'))for(const c of report.cases)for(const [target,passed]of Object.entries(c.targets))assert.ok(passed,`${c.id}: ${target} failed`);
