import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {buildWorkbook} from '../tools/build.mjs';
const out=resolve('dist/data-test');await mkdir(out,{recursive:true});
const source=JSON.parse(await readFile(new URL('../fixtures/two-sheets.json',import.meta.url)));
const html=await buildWorkbook(source),file=resolve(out,'loading.html');await writeFile(file,html);
const browser=await chromium.launch();
try{
 for(const mode of ['blocked','bad-js','bad-wasm','cancel']){
  const context=await browser.newContext();const page=await context.newPage();let broken=true,requests=0,release;
  const held=new Promise(r=>release=r);
  await context.route('https://raw.githubusercontent.com/**',async route=>{
   requests++;
   if(broken&&mode==='blocked')return route.abort();
   if(broken&&mode==='cancel')await held;
   const wasm=route.request().url().endsWith('.wasm');let body=await readFile(new URL(`../engine/vendor/ironcalc.${wasm?'wasm':'mjs'}`,import.meta.url));
   if(broken&&((mode==='bad-js'&&!wasm)||(mode==='bad-wasm'&&wasm)))body=Buffer.concat([body,Buffer.from('\nglobalThis.unverifiedExecuted=true;')]);
   try{await route.fulfill({body,headers:{'access-control-allow-origin':'*','content-type':wasm?'application/wasm':'text/javascript'}});}catch{/* Aborted download may already be closed. */}
  });
  await page.goto(pathToFileURL(file).href);await page.getByLabel('Cell value').fill('140');await page.getByRole('button',{name:'Apply edit'}).click();
  if(mode==='cancel'){
   await page.getByRole('button',{name:'Cancel calculation'}).click();release();
   await page.getByText('Calculation cancelled. Your attempted edit is retained; retry Apply edit.',{exact:true}).waitFor();
  }else await page.locator('#status').filter({hasText:mode==='blocked'?'retry Apply edit':'integrity check failed'}).waitFor();
  assert.equal(await page.getByLabel('Cell value').inputValue(),'140');
  assert.equal(await page.evaluate(()=>JSON.parse(document.querySelector('#workbook').textContent).sheets[0].cells.B2.input.value),100);
  assert.equal(await page.evaluate(()=>globalThis.unverifiedExecuted),undefined);
  broken=false;
  await page.getByRole('button',{name:'Apply edit'}).click();await page.getByText('Calculated locally. Unsaved changes.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Summary',exact:true}).click();assert.match(await page.locator('[data-cell="B2"]').textContent(),/3,500/);
  const before=requests;await context.setOffline(true);
  await page.getByRole('button',{name:'Inputs',exact:true}).click();await page.getByLabel('Cell value').fill('180');await page.getByRole('button',{name:'Apply edit'}).click();await page.getByText('Calculated locally. Unsaved changes.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Summary',exact:true}).click();assert.match(await page.locator('[data-cell="B2"]').textContent(),/4,500/);assert.equal(requests,before);
  await context.close();console.log(`PASS ${mode}: preserve attempt, safe retry, then recalculate disconnected`);
 }
}finally{await browser.close();}
