// The html-office-clip/1 envelope (ADR-013 §2) and the carrier limits (§1).
import { ClipboardError, plainObject } from "./errors.mjs";
import { validateTable } from "./table.mjs";

export const SCHEMA = "html-office-clip/1";
export const MIME = "application/x-html-office+json";
// Data's bare html-office-range/1 payload from before X02a; read only.
export const LEGACY_MIME = "application/x-html-office-range+json";
export const ATTRIBUTE = "data-html-office";
// Measured as string length (UTF-16 code units) before any parsing. Writers
// never produce a flavour that a reader would refuse.
export const LIMITS = {
  json: 64 * 2 ** 20,
  html: 8 * 2 ** 20,
  htmlCells: 20000,
  text: 64 * 2 ** 20,
};
const KINDS = ["table", "chart"];

// Recognised envelopes are validated whole; an unknown schema string (a newer
// major version) is reported as skipped so the reader can fall through.
export function decodeEnvelope(text, { maxCells } = {}) {
  if (text.length > LIMITS.json)
    throw new ClipboardError("the html-office clipboard data is too large");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ClipboardError(
      "the html-office clipboard data is not valid JSON",
    );
  }
  if (!plainObject(value) || typeof value.schema !== "string")
    throw new ClipboardError("the html-office clipboard data has no schema");
  if (value.schema !== SCHEMA) return { skipped: value.schema.slice(0, 64) };
  return { envelope: checkEnvelope(value, { maxCells }) };
}

// Unknown members are ignored (forward compatibility): only the known ones
// are copied out. The members a destination validates itself (range,
// chart) are returned as they are.
export function checkEnvelope(value, { maxCells } = {}) {
  const fail = (message) => {
    throw new ClipboardError(`clipboard envelope: ${message}`);
  };
  if (!plainObject(value) || value.schema !== SCHEMA)
    fail("unsupported schema");
  if (!KINDS.includes(value.kind)) fail("unknown kind");
  const out = { schema: SCHEMA, kind: value.kind, source: {} };
  if (value.source !== undefined) {
    if (!plainObject(value.source)) fail("source must be an object");
    for (const key of ["product", "format", "locale"]) {
      const v = value.source[key];
      if (v === undefined) continue;
      if (typeof v !== "string" || v.length > 64) fail(`invalid source ${key}`);
      out.source[key] = v;
    }
    if (value.source.stale !== undefined) {
      if (typeof value.source.stale !== "boolean") fail("invalid source stale");
      out.source.stale = value.source.stale;
    }
  }
  if (value.kind === "table") {
    if (value.range !== undefined) {
      if (!plainObject(value.range)) fail("range must be an object");
      out.range = value.range;
    }
    if (value.table !== undefined)
      out.table = validateTable(value.table, { maxCells });
    if (!out.table && !out.range) fail("a table needs a table or a range");
  } else {
    if (!plainObject(value.chart)) fail("a chart needs chart data");
    out.chart = value.chart;
    if (value.table !== undefined)
      out.table = validateTable(value.table, { maxCells });
  }
  return out;
}

// Data passes its own serialiser, which keeps signed zero.
export function encodeEnvelope(envelope, stringify = JSON.stringify) {
  const text = stringify(envelope);
  if (text.length > LIMITS.json)
    throw new ClipboardError(
      "the selection is too large for the clipboard; copy a smaller range",
    );
  return text;
}
