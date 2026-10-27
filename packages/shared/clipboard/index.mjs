// Cross-product clipboard (ADR-013): envelope, carriers, limits, portable
// table model, inert HTML reader and writers. Each product bundles it.
export { ClipboardError, safeURL } from "./errors.mjs";
export {
  SCHEMA,
  MIME,
  LEGACY_MIME,
  ATTRIBUTE,
  LIMITS,
  decodeEnvelope,
  checkEnvelope,
  encodeEnvelope,
} from "./envelope.mjs";
export {
  TEXT_COLORS,
  FILLS,
  CELL_STYLES,
  validateTable,
  validateLink,
  toTSV,
  quoteTSV,
  tableText,
  fromTSV,
} from "./table.mjs";
export {
  tableHTML,
  writeClipboard,
  excelFormat,
  escapeAttribute,
} from "./write.mjs";
export { readClipboard, readTable, findEnvelope, parseInert } from "./read.mjs";
