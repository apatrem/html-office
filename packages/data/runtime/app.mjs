import {parseWorkbook,stringifyWorkbook,setCell,fingerprint} from '../model/workbook.mjs';
import {EngineSession} from '../engine/adapter.mjs';
import {loadEngine} from './loader.mjs';
import {preview} from './view.mjs';
const $=id=>document.getElementById(id);
let book=parseWorkbook($('workbook').textContent),sheetId=book.sheets[0].id,selected='B2',session=null,loading=null,sequence=0;
const history=[];
const config=JSON.parse($('engine-config').textContent);
const status=text=>{$('status').textContent=text;};
function choose(ref){
  selected=ref;$('cell-address').value=ref;
  const cell=book.sheets.find(s=>s.id===sheetId).cells[ref]??{},value=cell.input??{type:'blank'};
  $('cell-type').value=cell.formula?'formula':value.type;
  $('cell-value').value=cell.formula??(value.type==='blank'?'':String(value.value));
}
function render(){
  $('sheet-tabs').replaceChildren();
  for(const sheet of book.sheets){const b=document.createElement('button');b.textContent=sheet.name;b.setAttribute('aria-pressed',String(sheet.id===sheetId));b.onclick=()=>{sheetId=sheet.id;render();choose(selected);};$('sheet-tabs').append(b);}
  const sheet=book.sheets.find(s=>s.id===sheetId),data=preview(sheet),table=document.createElement('table');
  table.setAttribute('aria-label',sheet.name);const body=document.createElement('tbody');
  for(const row of data.rows){const tr=document.createElement('tr');for(const {ref,cell,text}of row){const td=document.createElement('td'),b=document.createElement('button');b.dataset.cell=ref;b.textContent=text||'\u00a0';b.title=`${ref}${cell.formula?` · ${cell.formula}`:''}`;b.className=cell.role??'normal';b.onclick=()=>choose(ref);td.append(b);tr.append(td);}body.append(tr);}
  table.append(body);$('grid').replaceChildren(table);$('preview-note').textContent=data.truncated?'Preview shows the first 30 rows and 12 columns. All data remains embedded.':'';
  $('undo').disabled=!history.length||!!loading;$('apply').disabled=!!loading;$('cancel').disabled=!loading;
}
function enteredCell(){
  const type=$('cell-type').value,text=$('cell-value').value;
  const old=book.sheets.find(s=>s.id===sheetId).cells[$('cell-address').value]??{};
  const cell={...old};delete cell.input;delete cell.formula;delete cell.result;
  if(type==='formula')cell.formula=text;
  else if(type==='blank')cell.input={type};
  else if(type==='number'||type==='date'){if(!text.trim())throw new Error('Enter a number.');cell.input={type,value:Number(text)};}
  else if(type==='boolean'){if(!['TRUE','FALSE'].includes(text.toUpperCase()))throw new Error('Enter TRUE or FALSE.');cell.input={type,value:text.toUpperCase()==='TRUE'};}
  else cell.input={type,value:text};
  return cell;
}
async function apply(){
  if(loading)return;
  const epoch=++sequence,controller=new AbortController();
  try{
    const ref=$('cell-address').value,cell=enteredCell(),target=sheetId,previous=book;
    setCell(book,target,ref,cell); // Validate before downloading or mutating the engine.
    loading=controller;render();status(config.embedded?'Loading embedded calculation engine…':'Loading verified calculation engine… Your edit is retained.');
    if(!session){const module=await loadEngine(config,{signal:controller.signal});if(epoch!==sequence)return;session=new EngineSession(module);session.load(book);}
    if(epoch!==sequence)return;
    session.edit(target,ref,cell);const result=await session.calculate();
    if(epoch!==sequence)return;
    history.push(previous);book=result;status('Calculated locally. Unsaved changes.');
  }catch(error){if(epoch===sequence){session?.dispose();session=null;status(`${error.message} Your attempted edit remains in the form; retry Apply edit.`);}}
  finally{if(epoch===sequence){loading=null;render();}}
}
$('apply').onclick=apply;
$('cancel').onclick=()=>{++sequence;loading?.abort();loading=null;session?.dispose();session=null;render();status('Calculation cancelled. Your attempted edit is retained; retry Apply edit.');};
$('undo').onclick=()=>{if(loading||!history.length)return;book=history.pop();session?.load(book);render();choose(selected);status('Undo restored the previous workbook.');};
$('decimals').onclick=()=>{
  if(loading)return;const sheet=book.sheets.find(s=>s.id===sheetId),old=sheet.cells[selected]??{};
  history.push(book);book=setCell(book,sheetId,selected,{...old,format:{...old.format,kind:old.format?.kind??'number',digits:Math.min(15,(old.format?.digits??0)+1)}});
  // A formatting edit does not change calculation state; reload on the next input edit.
  session?.dispose();session=null;render();status('Formatting changed. Unsaved changes.');
};
$('save').onclick=()=>{
  if(loading){status('Finish or cancel the pending calculation before saving.');return;}
  const copy=document.documentElement.cloneNode(true);copy.querySelector('#workbook').textContent=stringifyWorkbook(book);
  // Saved form state should reflect its actual default when the copy is reopened.
  copy.querySelector('#status').textContent='Checking saved results…';
  const url=URL.createObjectURL(new Blob(['<!doctype html>\n'+copy.outerHTML],{type:'text/html;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${book.id}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Copy download requested. Open the downloaded HTML to verify it.');
};
render();choose(selected);
status(book.snapshot?.fingerprint===await fingerprint(book)?'Saved results are current.':'Saved results are stale or missing. Apply an edit to recalculate.');
