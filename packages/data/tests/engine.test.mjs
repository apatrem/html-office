import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init, {Model} from '../engine/vendor/ironcalc.mjs';
import {EngineSession} from '../engine/adapter.mjs';
await init({module_or_path:await readFile(new URL('../engine/vendor/ironcalc.wasm',import.meta.url))});
const book=JSON.parse(await readFile(new URL('../fixtures/two-sheets.json',import.meta.url)));
test('raw values retain full precision and distinguish text, errors, Boolean and blank',()=>{
  const engine=new Model('types','en','UTC','en');
  try{
    engine.pauseEvaluation();
    const cases=[['=1/3',['number',1/3]],['=0.1+0.2',['number',0.1+0.2]],['=TRUE()',['boolean',true]],["'0012",['text','0012']],["'",['text','']],['=1/0',['error','#DIV/0!']],['=DATE(2026,1,1)',['number',46023]],['=NA()',['error','#N/A']]];
    cases.forEach(([input],i)=>engine.setUserInput(0,i+1,1,input));engine.resumeEvaluation();engine.evaluate();
    cases.forEach(([,expected],i)=>assert.deepEqual(engine.getCellValue(0,i+1,1),expected));
    assert.deepEqual(engine.getCellValue(0,100,1),['blank',undefined]);
    assert.notEqual(engine.getFormattedCellValue(0,1,1),String(1/3));
  }finally{engine.free();}
});
test('canonical model survives evaluation and cross-sheet edit, without binary authority',async()=>{
  const session=new EngineSession({Model});
  try{
    session.load(book);const first=await session.calculate();
    assert.deepEqual(first.sheets[0],book.sheets[0]);
    assert.equal(first.sheets[1].cells.B2.result.value,2500);
    session.edit('inputs','B2',{...book.sheets[0].cells.B2,input:{type:'number',value:140}});
    const edited=await session.calculate();
    assert.equal(edited.sheets[1].cells.B2.result.value,3500);
    assert.equal(edited.sheets[1].cells.B3.result.value,25);
    assert.notEqual(first.snapshot.fingerprint,edited.snapshot.fingerprint);
    assert.deepEqual(book.sheets[0].cells.B2.input.value,100);
    session.load(first);assert.equal((await session.calculate()).sheets[1].cells.B2.result.value,2500);
  }finally{session.dispose();}
});
