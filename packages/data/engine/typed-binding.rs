//! HTML Office's narrow binding to IronCalc 0.9.0 with formula-compatibility.patch.
//! MIT, with constructor/tokenizer patterns adapted from upstream MIT/Apache bindings.
use wasm_bindgen::{prelude::*, JsValue};
use ironcalc_base::{cell::CellValue, types::CellType, UserModel};
fn js_error(error: String) -> JsError { JsError::new(&error) }
#[wasm_bindgen]
pub struct Model { model: UserModel<'static> }
#[wasm_bindgen]
impl Model {
    #[wasm_bindgen(constructor)]
    pub fn new(_name: &str, locale: &str, timezone: &str, language: &str) -> Result<Model, JsError> {
        // Keep engine locale/timezone/name static; the readable workbook owns its title.
        if locale != "en" || timezone != "UTC" || language != "en" { return Err(JsError::new("Only en/UTC/en is supported by this prototype")); }
        Ok(Model { model: UserModel::new_empty("HTML Office", "en", "UTC", "en").map_err(js_error)? })
    }
    #[wasm_bindgen(js_name = pauseEvaluation)]
    pub fn pause(&mut self) { self.model.pause_evaluation(); }
    #[wasm_bindgen(js_name = resumeEvaluation)]
    pub fn resume(&mut self) { self.model.resume_evaluation(); }
    pub fn evaluate(&mut self) { self.model.evaluate(); }
    #[wasm_bindgen(js_name = newSheet)]
    pub fn new_sheet(&mut self) -> Result<(), JsError> { self.model.new_sheet().map_err(js_error) }
    #[wasm_bindgen(js_name = renameSheet)]
    pub fn rename_sheet(&mut self, sheet: u32, name: &str) -> Result<(), JsError> { self.model.rename_sheet(sheet,name).map_err(js_error) }
    #[wasm_bindgen(js_name = setUserInput)]
    pub fn set_input(&mut self, sheet: u32, row: i32, column: i32, value: &str) -> Result<(), JsError> { self.model.set_user_input(sheet,row,column,value).map_err(js_error) }
    #[wasm_bindgen(js_name = getCellValue)]
    pub fn get_value(&self, sheet: u32, row: i32, column: i32) -> Result<JsValue, JsError> {
        let value = self.model.get_model().get_cell_value_by_index(sheet,row,column).map_err(js_error)?;
        let error = matches!(self.model.get_cell_type(sheet,row,column).map_err(js_error)?, CellType::ErrorValue);
        let (kind, raw) = match value {
            CellValue::None => ("blank",JsValue::UNDEFINED),
            CellValue::Number(n) => ("number",JsValue::from_f64(n)),
            CellValue::Boolean(b) => ("boolean",JsValue::from_bool(b)),
            CellValue::String(s) => (if error {"error"} else {"text"},JsValue::from_str(&s)),
        };
        let result=js_sys::Array::new();result.push(&JsValue::from_str(kind));result.push(&raw);Ok(result.into())
    }
    #[wasm_bindgen(js_name = getFormattedCellValue)]
    pub fn formatted(&self, sheet: u32, row: i32, column: i32) -> Result<String, JsError> { self.model.get_formatted_cell_value(sheet,row,column).map_err(js_error) }
    #[wasm_bindgen(js_name = getCellContent)]
    pub fn content(&self, sheet: u32, row: i32, column: i32) -> Result<String, JsError> { self.model.get_cell_content(sheet,row,column).map_err(js_error) }
    #[wasm_bindgen(js_name = insertRows)]
    pub fn insert_rows(&mut self, sheet: u32, row: i32, count: i32) -> Result<(), JsError> { self.model.insert_rows(sheet,row,count).map_err(js_error) }
    #[wasm_bindgen(js_name = deleteRows)]
    pub fn delete_rows(&mut self, sheet: u32, row: i32, count: i32) -> Result<(), JsError> { self.model.delete_rows(sheet,row,count).map_err(js_error) }
    #[wasm_bindgen(js_name = insertColumns)]
    pub fn insert_columns(&mut self, sheet: u32, column: i32, count: i32) -> Result<(), JsError> { self.model.insert_columns(sheet,column,count).map_err(js_error) }
    #[wasm_bindgen(js_name = deleteColumns)]
    pub fn delete_columns(&mut self, sheet: u32, column: i32, count: i32) -> Result<(), JsError> { self.model.delete_columns(sheet,column,count).map_err(js_error) }
    #[wasm_bindgen(js_name = newDefinedName)]
    pub fn new_name(&mut self, name: &str, scope: Option<u32>, formula: &str) -> Result<(), JsError> { self.model.new_defined_name(name,scope,formula).map_err(js_error) }
}
