// Build-time replacement used only by the storage comparison artifacts.
import { encodeWorkbook, decodeWorkbook, safeJSON } from "./encodings.mjs";
let encoding = "per-cell";
export function readModel(text) {
  const value = JSON.parse(text);
  encoding = value.storageExperiment?.encoding ?? "per-cell";
  return decodeWorkbook(value);
}
export function writeModel(book) {
  return safeJSON(encodeWorkbook(book, encoding));
}
