import {validateWorkbook, validateValue, parseAddress, fingerprint, validateCell} from '../model/workbook.mjs';
export const ENGINE = 'ironcalc/0.9.0+html-office-typed.1';
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
      let prefix='__office_';
      while(book.sheets.some(s=>s.name.toLowerCase().startsWith(prefix)))prefix='_'+prefix;
      book.sheets.forEach((_,i)=>{if(i)this.engine.newSheet();this.engine.renameSheet(i,`${prefix}${i}`);});
      book.sheets.forEach((s,i)=>this.engine.renameSheet(i,s.name));
      for(const name of book.names){const sheet=book.sheets.find(s=>s.id===name.sheetId);this.engine.newDefinedName(name.name,undefined,`'${sheet.name.replaceAll("'","''")}'!${name.ref}`);}
      book.sheets.forEach((sheet,i)=>{for(const [ref,cell]of Object.entries(sheet.cells)){const {row,column}=parseAddress(ref);this.engine.setUserInput(i,row,column,engineInput(cell));}});
      // resumeEvaluation enables future evaluation but does not evaluate by itself.
      this.engine.resumeEvaluation();
    }catch(error){this.dispose();throw error;}
  }
  edit(sheetId,ref,cell){
    validateCell(cell);
    const index=this.book.sheets.findIndex(s=>s.id===sheetId),{row,column}=parseAddress(ref);
    if(index<0)throw new Error('Unknown sheet ID');
    this.engine.pauseEvaluation();
    try{this.engine.setUserInput(index,row,column,engineInput(cell));this.book.sheets[index].cells[ref]=structuredClone(cell);}
    finally{this.engine.resumeEvaluation();}
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
