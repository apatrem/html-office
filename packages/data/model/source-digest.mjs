// Digests of an imported source (T15): the file's bytes, and one digest per
// source column. Kept apart from sources.mjs so the import chunk does not
// bundle the workbook validator.
// One line per cell: nothing for a missing or blank cell, "f" and the
// formula, or the type's initial and the value (strings JSON-quoted, so a
// line break inside text cannot fake a row; signed zero kept).
function encode(cell) {
  if (!cell) return "";
  if (cell.formula) return "f" + JSON.stringify(cell.formula);
  const v = cell.input;
  if (!v || v.type === "blank") return "";
  return (
    v.type[0] +
    (typeof v.value === "string"
      ? JSON.stringify(v.value)
      : Object.is(v.value, -0)
        ? "-0"
        : String(v.value))
  );
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const fileDigest = (bytes) => sha256(bytes);
// One digest per source column over its typed inputs, top to bottom (the
// header included), so a later refresh can tell which columns were edited by
// hand. Formats and styles are not part of it.
export async function columnFingerprints(cells, ref) {
  const [, l1, t1, l2, t2] = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref),
    column = (letters) =>
      [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0),
    r = {
      left: column(l1),
      top: Number(t1),
      right: column(l2 ?? l1),
      bottom: Number(t2 ?? t1),
    },
    digests = [];
  for (let col = r.left; col <= r.right; col++) {
    const values = [];
    for (let row = r.top; row <= r.bottom; row++)
      values.push(encode(cells[columnRef(col, row)]));
    digests.push(await sha256(new TextEncoder().encode(values.join("\n"))));
  }
  return digests;
}
const letters = [];
function columnRef(col, row) {
  let name = letters[col];
  if (name === undefined) {
    name = "";
    for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    letters[col] = name;
  }
  return name + row;
}
