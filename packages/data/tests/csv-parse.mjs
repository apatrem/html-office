// Test helper: an independent RFC 4180 reader (quoted fields, doubled quotes,
// CRLF or LF line ends), used to read exported CSV back.
export function parseCSV(text, separator = ",") {
  if (text.startsWith("﻿")) text = text.slice(1);
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
    i++;
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
