import { assertScenarioInputs } from "../model/validation.mjs";
import { organizeWorkbook } from '../model/organization.mjs';
import { shiftWorkbook, structureBeforeRefs } from "../model/structure.mjs";
import {validateWorkbook, validateValue, parseAddress, fingerprint, validateCell, validateValidations} from '../model/workbook.mjs';
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
    const index=this.book.sheets.findIndex(s=>s.id===command.sheetId);
    const method=(command.action==='insert'?'insert':'delete')+(command.axis==='row'?'Rows':'Columns');
    this.engine.pauseEvaluation();
    try{this.engine[method](index,command.index,command.count);}finally{this.engine.resumeEvaluation();}
    const formulas=[];
    next.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula){
      const {row,column}=parseAddress(ref),formula=this.engine.getCellContent(i,row,column);
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
  result(sheetIndex,ref){
    const {row,column}=parseAddress(ref),[type,value]=this.engine.getCellValue(sheetIndex,row,column);
    const result=type==='blank'?{type}:{type,value};validateValue(result);return result;
  }
  async calculateDelta(){
    this.engine.evaluate();
    const results=[];
    this.book.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula){cell.result=this.result(i,ref);results.push({sheetId:sheet.id,ref,result:cell.result});}});
    this.book.snapshot={engine:ENGINE,fingerprint:await fingerprint(this.book),calculatedAt:new Date().toISOString()};
    return {results,snapshot:this.book.snapshot};
  }
  async calculate(){await this.calculateDelta();return structuredClone(this.book);}
  dispose(){this.engine?.free();this.engine=null;}
}
