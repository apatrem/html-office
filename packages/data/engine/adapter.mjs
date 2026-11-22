import { assertScenarioInputs } from "../model/validation.mjs";
import { organizeWorkbook } from '../model/organization.mjs';
import { shiftWorkbook, structureBeforeRefs, repairRanges } from "../model/structure.mjs";
import { computePivot, pivotFingerprint, validatePivots, PIVOT_ERROR } from "../model/pivot.mjs";
import {validateWorkbook, validateValue, parseAddress, address, fingerprint, validateCell, validateValidations} from '../model/workbook.mjs';
import { occupied, forgetSpills } from '../model/spills.mjs';
import { ENGINE } from './identity.mjs';
export { ENGINE } from './identity.mjs';
export function engineInput(cell) {
  if(cell.formula)return cell.formula;
  const v=cell.input??{type:'blank'};validateValue(v);
  if(v.type==='blank')return '';
  if(v.type==='text')return `'${v.value}`;
  if(v.type==='boolean')return v.value?'TRUE':'FALSE';
  return Object.is(v.value,-0)?'-0':String(v.value);
}
// Formulas that cannot return an array: single-cell references, constants,
// operators and these functions, with no range, name, spill reference or
// array constant. They never spill, so they never need measuring. `names`
// holds the workbook's defined names in lower case: a name such as A0 or
// TAX2 that looks like a cell may hold a range.
const SCALAR_FUNCTIONS=new Set('ABS AND AVERAGE CONCAT CONCATENATE COUNT COUNTA DATE DAY EDATE EOMONTH EXP IF IFERROR IFNA IFS INT ISBLANK ISERROR ISNUMBER ISTEXT LEFT LEN LN LOG LOWER MAX MID MIN MOD MONTH N NOT OR POWER PROPER RIGHT ROUND ROUNDDOWN ROUNDUP SQRT SUM TEXT TRIM UPPER VALUE YEAR'.split(' '));
export function scalarFormula(formula,names=new Set()){
  const text=formula.slice(1).replace(/"(?:[^"]|"")*"/g,'""').replace(/'(?:[^']|'')*'!/g,'S!');
  if(/[:#{\[]/.test(text))return false;
  for(const m of text.matchAll(/(\$?[A-Za-z_][\w.$]*)(\s*[(!])?/g)){
    const [,word,next]=m;
    if(next?.includes('!'))continue;
    if(next?.includes('(')){if(!SCALAR_FUNCTIONS.has(word.toUpperCase()))return false;continue;}
    if(/^(TRUE|FALSE)$/i.test(word))continue;
    const cell=/^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(word);
    if(!cell||names.has(word.replaceAll('$','').toLowerCase()))return false;
    const column=[...cell[1].toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row=Number(cell[2]);
    if(row<1||row>1048576||column>16384)return false;
  }
  return true;
}
export class EngineSession {
  constructor(module){this.module=module;this.engine=null;}
  load(book){
    validateWorkbook(book);this.dispose();this.book=structuredClone(book);
    this.engine=new this.module.Model(book.title,'en','UTC','en');
    try{
      this.engine.pauseEvaluation();
      // Avoid accidental name collisions with the default or intermediate sheet names.
      let prefix='__office_', prefixIndex=0;
      while(book.sheets.some(s=>s.name.toLowerCase().startsWith(prefix)))prefix=`__office${++prefixIndex}_`;
      book.sheets.forEach((_,i)=>{if(i)this.engine.newSheet();this.engine.renameSheet(i,`${prefix}${i}`);});
      book.sheets.forEach((s,i)=>this.engine.renameSheet(i,s.name));
      // IronCalc accepts only range-shaped defined names. Broken canonical names
      // point to one derived typed-error cell; it is never part of saved data.
      let brokenSheet;
      if(book.names.some(name=>name.ref==='#REF!')){
        brokenSheet=`${prefix}errors`;
        this.engine.newSheet();this.engine.renameSheet(book.sheets.length,brokenSheet);
        this.engine.setUserInput(book.sheets.length,1,1,'#REF!');
      }
      for(const name of book.names){const sheet=book.sheets.find(s=>s.id===name.sheetId);const ref=name.ref==='#REF!'?`'${brokenSheet}'!$A$1`:`'${sheet.name.replaceAll("'","''")}'!${name.ref}`;this.engine.newDefinedName(name.name,undefined,ref);}
      book.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells)){const {row,column}=parseAddress(ref);this.engine.setUserInput(i,row,column,engineInput(cell));}});
      // resumeEvaluation enables future evaluation but does not evaluate by itself.
      this.engine.resumeEvaluation();
    }catch(error){this.dispose();throw error;}
  }
  edit(sheetId,ref,cell){this.editMany([{sheetId,ref,cell}]);}
  editMany(edits){
    if(!Array.isArray(edits))throw new Error('Expected cell edits');
    const prepared=edits.map(({sheetId,ref,cell})=>{
      const index=this.book.sheets.findIndex(s=>s.id===sheetId),{row,column}=parseAddress(ref);
      if(index<0)throw new Error('Unknown sheet ID');
      if(cell!==null)validateCell(cell,this.book);
      return {index,row,column,ref,cell:structuredClone(cell)};
    });
    assertScenarioInputs(this.book, edits);
    this.engine.pauseEvaluation();
    try{for(const {index,row,column,ref,cell} of prepared){
      this.engine.setUserInput(index,row,column,cell===null?'':engineInput(cell));
      if(cell===null)delete this.book.sheets[index].cells[ref];
      else this.book.sheets[index].cells[ref]=cell;
    }}finally{this.engine.resumeEvaluation();}
  }
  configureValidations(header){
    if(!header || typeof header !== 'object' || Array.isArray(header) || Object.keys(header).some(k => !['validations','scenario'].includes(k))) throw new Error('Invalid validation header');
    const next={...this.book};
    if(header.validations === undefined) delete next.validations;
    else next.validations=structuredClone(header.validations);
    if(header.scenario == null) delete next.scenario;
    else next.scenario=structuredClone(header.scenario);
    validateValidations(next);
    this.book=next;
  }
  async structure(command){
    const beforeRefs=structureBeforeRefs(this.book,command),next=shiftWorkbook(this.book,command);
    const index=this.book.sheets.findIndex(s=>s.id===command.sheetId),edited=this.book.sheets[index].name;
    const method=(command.action==='insert'?'insert':'delete')+(command.axis==='row'?'Rows':'Columns');
    this.engine.pauseEvaluation();
    try{this.engine[method](index,command.index,command.count);}finally{this.engine.resumeEvaluation();}
    const formulas=[];
    next.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula){
      const {row,column}=parseAddress(ref);
      // The engine breaks a range whose end was deleted; Data shrinks it instead.
      const formula=repairRanges(cell.formula,this.engine.getCellContent(i,row,column),{ownSheet:sheet.name,edited,command});
      validateCell({...cell,formula});sheet.cells[ref]={...cell,formula};formulas.push({sheetId:sheet.id,ref,formula});
    }});
    // Rebind canonical names: the engine does not reliably relocate them itself.
    this.load(next);
    return {...await this.calculateDelta(),formulas,beforeRefs};
  }
  async organize(command){
    const next=organizeWorkbook(this.book,command),beforeRefs=[],formulas=[];
    if(command.type==='rename')this.engine.renameSheet(this.book.sheets.findIndex(s=>s.id===command.sheetId),command.name);
    next.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula){
      beforeRefs.push({sheetId:sheet.id,ref});
      const {row,column}=parseAddress(ref),formula=command.type==='rename'?this.engine.getCellContent(i,row,column):cell.formula;
      validateCell({...cell,formula});sheet.cells[ref]={...cell,formula};formulas.push({sheetId:sheet.id,ref,formula});
    }});
    this.load(next);
    return {...await this.calculateDelta(),beforeRefs,formulas};
  }
  // Pivot definitions only matter here for structural validation and shifts;
  // the editor sends the canonical list before those operations.
  configurePivots(pivots){
    const next={...this.book};
    if(pivots?.length)next.pivots=structuredClone(pivots);else delete next.pivots;
    validatePivots(next);this.book=next;
  }
  // Pivot refresh (ADR-014): recalculates first, so source formula results are
  // current, then aggregates the typed values this session holds. The caller
  // writes the returned cells through editMany like any other edit.
  async pivot(definition){
    validatePivots({...this.book,pivots:[definition]});
    await this.calculateDelta();
    // Definition and size errors are marked: they leave the session usable.
    let computed;
    try{computed=computePivot(this.book,definition);}catch(error){throw new Error(PIVOT_ERROR+error.message);}
    return {...computed,fingerprint:await pivotFingerprint(this.book,definition)};
  }
  result(sheetIndex,ref){
    const {row,column}=parseAddress(ref),[type,value]=this.engine.getCellValue(sheetIndex,row,column);
    // IronCalc's English text for its "not implemented" error ends with "!";
    // the model keeps its code, #N/IMPL. Any other unknown code still fails.
    const result=type==='blank'?{type}:{type,value:type==='error'&&value==='#N/IMPL!'?'#N/IMPL':value};validateValue(result);return result;
  }
  async calculateDelta(){
    this.engine.evaluate();
    const results=[];
    this.book.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula){cell.result=this.result(i,ref);delete cell.spill;results.push({sheetId:sheet.id,ref,result:cell.result});}});
    // Spilled arrays are saved on their anchor as {ref, results} (F-01).
    const spills=this.spills();
    for(const entry of results){const spill=spills.get(`${entry.sheetId}!${entry.ref}`);if(spill){entry.spill=spill;this.book.sheets.find(s=>s.id===entry.sheetId).cells[entry.ref].spill=spill;}}
    this.book.sheets.forEach(sheet=>forgetSpills(sheet.cells));
    this.book.snapshot={engine:ENGINE,fingerprint:await fingerprint(this.book),calculatedAt:new Date().toISOString()};
    return {results,snapshot:this.book.snapshot};
  }
  // IronCalc's binding does not expose spill ranges, so they are read from
  // the values: a spill cell is a cell without its own input or formula
  // whose value is not blank (spilled values never are). From each formula,
  // the run of spill cells below it gives its height and the run to its
  // right its width. These runs are exact unless two of them overlap, which
  // happens when another spill passes along the anchor's row or column; the
  // engine then measures those anchors with ROWS(A1#) and COLUMNS(A1#).
  spills(){
    const found=new Map(),ambiguous=[],names=new Set(this.book.names.map(n=>n.name.toLowerCase()));
    this.book.sheets.forEach((sheet,i)=>{
      const free=(row,column)=>row<=1048576&&column<=16384&&!occupied(sheet.cells[address(row,column)])&&this.engine.getCellValue(i,row,column)[0]!=='blank';
      const rects=[],owner=new Map();
      for(const [ref,cell] of Object.entries(sheet.cells))if(cell.formula&&!scalarFormula(cell.formula,names)){
        const {row,column}=parseAddress(ref);let height=1,width=1;
        while(free(row+height,column))height++;
        while(free(row,column+width))width++;
        if(height*width>1)rects.push({ref,row,column,height,width});
      }
      // Two runs that are wrong always cross on a run cell, so only the runs
      // (not whole rectangles, which may be huge and mostly empty) are kept.
      const mark=(rect,row,column)=>{const key=row*16385+column,other=owner.get(key);if(other&&other!==rect)other.ambiguous=rect.ambiguous=true;else owner.set(key,rect);};
      for(const rect of rects){for(let y=0;y<rect.height;y++)mark(rect,rect.row+y,rect.column);for(let x=1;x<rect.width;x++)mark(rect,rect.row,rect.column+x);}
      for(const rect of rects)if(rect.ambiguous)ambiguous.push({sheet,index:i,...rect});else found.set(`${sheet.id}!${rect.ref}`,this.spillOf(i,rect));
    });
    if(ambiguous.length)this.measure(ambiguous).forEach((rect)=>{if(rect.height*rect.width>1)found.set(`${rect.sheet.id}!${rect.ref}`,this.spillOf(rect.index,rect));});
    return found;
  }
  spillOf(index,{row,column,height,width}){
    const results=[];
    for(let y=0;y<height;y++){const line=[];for(let x=0;x<width;x++)line.push(this.result(index,address(row+y,column+x)));results.push(line);}
    return {ref:`${address(row,column)}:${address(row+height-1,column+width-1)}`,results};
  }
  // Measures anchors in a separate engine holding the workbook and one extra
  // sheet of ROWS/COLUMNS probes, so this session's sheets and results stay
  // untouched. Sizes that match the values are kept; spilled cells left
  // unclaimed then extend the anchors whose runs reach them.
  measure(rects){
    const probe=new EngineSession(this.module),sizes=[];
    try{
      probe.load(this.book);
      const engine=probe.engine,at=this.book.sheets.length+(this.book.names.some(n=>n.ref==='#REF!')?1:0);
      let name='__office_spills';
      while(this.book.sheets.some(s=>s.name.toLowerCase()===name))name+='_';
      engine.pauseEvaluation();
      try{
        engine.newSheet();engine.renameSheet(at,name);
        rects.forEach((rect,k)=>{const target=`'${rect.sheet.name.replaceAll("'","''")}'!${rect.ref}#`;engine.setUserInput(at,k+1,1,`=IFERROR(ROWS(${target}),0)`);engine.setUserInput(at,k+1,2,`=IFERROR(COLUMNS(${target}),0)`);});
      }finally{engine.resumeEvaluation();}
      engine.evaluate();
      rects.forEach((_,k)=>{const read=c=>{const [type,value]=engine.getCellValue(at,k+1,c);return type==='number'?value:0;};sizes.push([read(1),read(2)]);});
    }finally{probe.dispose();}
    const claimed=new Set(),fits=(rect,height,width)=>{
      if(height<1||width<1)return false;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const key=`${rect.sheet.id}!${(rect.row+y)*16385+rect.column+x}`;
        if(claimed.has(key)||((y||x)&&!rect.spillCell(rect.row+y,rect.column+x)))return false;
      }
      return true;
    };
    const measured=rects.map((rect,k)=>({...rect,runHeight:rect.height,runWidth:rect.width,spillCell:(row,column)=>!occupied(rect.sheet.cells[address(row,column)])&&this.engine.getCellValue(rect.index,row,column)[0]!=='blank',size:sizes[k]}));
    measured.sort((a,b)=>a.index-b.index||a.row-b.row||a.column-b.column);
    const key=(rect,y,x)=>`${rect.sheet.id}!${(rect.row+y)*16385+rect.column+x}`,claim=(rect)=>{for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++)claimed.add(key(rect,y,x));};
    // Measured sizes that match the values are kept (the extra sheet changes
    // SHEETS(), so one may not); the others start as their anchor alone.
    for(const rect of measured){
      const [height,width]=rect.size,ok=fits(rect,height,width);
      rect.height=ok?height:1;rect.width=ok?width:1;claim(rect);
    }
    // A spilled cell of a run that nobody claimed goes to the anchor whose
    // run reaches it, growing in reading order by whole free rows, then
    // columns. Exact measurements leave nothing to grow, so they stay.
    const free=(rect,y,x)=>!claimed.has(key(rect,y,x))&&rect.spillCell(rect.row+y,rect.column+x);
    for(const rect of measured){
      while(rect.height<rect.runHeight&&Array.from({length:rect.width},(_,x)=>x).every(x=>free(rect,rect.height,x))){for(let x=0;x<rect.width;x++)claimed.add(key(rect,rect.height,x));rect.height++;}
      while(rect.width<rect.runWidth&&Array.from({length:rect.height},(_,y)=>y).every(y=>free(rect,y,rect.width))){for(let y=0;y<rect.height;y++)claimed.add(key(rect,y,rect.width));rect.width++;}
    }
    return measured;
  }
  async calculate(){await this.calculateDelta();return structuredClone(this.book);}
  dispose(){this.engine?.free();this.engine=null;}
}
