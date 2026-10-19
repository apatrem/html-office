import {validateWorkbook, validateValue, parseAddress, fingerprint, setCell} from '../model/workbook.mjs';
export const ENGINE = 'ironcalc/0.9.0+html-office-typed.1';
export function engineInput(cell) {
  if(cell.formula)return cell.formula;
  const v=cell.input??{type:'blank'};validateValue(v);
  if(v.type==='blank')return '';
  if(v.type==='text')return `'${v.value}`;
  if(v.type==='boolean')return v.value?'TRUE':'FALSE';
  return String(v.value);
}
export class EngineSession {
  constructor(module){this.module=module;this.engine=null;}
  load(book){
    validateWorkbook(book);this.dispose();this.book=structuredClone(book);
    this.engine=new this.module.Model(book.title,'en','UTC','en');
    try{
      this.engine.pauseEvaluation();
      // Avoid accidental name collisions with the default or intermediate sheet names.
      book.sheets.forEach((_,i)=>{if(i)this.engine.newSheet();this.engine.renameSheet(i,`__office_${i}`);});
      book.sheets.forEach((s,i)=>this.engine.renameSheet(i,s.name));
      for(const name of book.names){const sheet=book.sheets.find(s=>s.id===name.sheetId);this.engine.newDefinedName(name.name,undefined,`'${sheet.name.replaceAll("'","''")}'!${name.ref}`);}
      book.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells)){const {row,column}=parseAddress(ref);this.engine.setUserInput(i,row,column,engineInput(cell));}});
      // resumeEvaluation enables future evaluation but does not evaluate by itself.
      this.engine.resumeEvaluation();
    }catch(error){this.dispose();throw error;}
  }
  edit(sheetId,ref,cell){
    const next=setCell(this.book,sheetId,ref,cell),index=next.sheets.findIndex(s=>s.id===sheetId),{row,column}=parseAddress(ref);
    this.engine.pauseEvaluation();
    try{this.engine.setUserInput(index,row,column,engineInput(cell));this.book=next;}
    finally{this.engine.resumeEvaluation();}
  }
  result(sheetIndex,ref){
    const {row,column}=parseAddress(ref),[type,value]=this.engine.getCellValue(sheetIndex,row,column);
    const result=type==='blank'?{type}:{type,value};validateValue(result);return result;
  }
  async calculate(){
    this.engine.evaluate();
    const next=structuredClone(this.book);
    next.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells))if(cell.formula)cell.result=this.result(i,ref);});
    next.snapshot={engine:ENGINE,fingerprint:await fingerprint(next),calculatedAt:new Date().toISOString()};
    this.book=next;return structuredClone(next);
  }
  dispose(){this.engine?.free();this.engine=null;}
}
