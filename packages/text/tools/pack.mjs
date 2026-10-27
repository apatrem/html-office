#!/usr/bin/env node
// html-text pack: rewrites a valid document into canonical form (FORMAT.md › Canonical form)
// and lists every changed line. This is the only normalisation step: the editor never applies it silently.
//   node pack.mjs <document.html> [<output.html>]   (default: rewrite in place)
// Refuses a document with errors (exit 1) and leaves it unchanged.
import { readFile, writeFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { canonicalize } from "../editor/schema/document.mjs";

// Shortest edit script on lines: [{op: " " | "-" | "+", line, text}], line numbers 1-based in
// the old text for " " and "-", in the new text for "+". Common leading and trailing lines are
// trimmed first; past MAX_EDITS differences the middle is reported as one replaced range, so time
// and memory stay bounded.
const MAX_EDITS = 2000;

export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1])
    (endA--, endB--);
  const same = (i, j) => ({ op: " ", line: i + 1, text: a[i] });
  const head = a.slice(0, start).map((_, i) => same(i));
  const tail = a.slice(endA).map((_, k) => same(endA + k));
  return [...head, ...middle(a, b, start, endA, endB), ...tail];
}

function middle(a, b, start, endA, endB) {
  const n = endA - start,
    m = endB - start;
  const replaced = () => [
    ...a
      .slice(start, endA)
      .map((text, i) => ({ op: "-", line: start + i + 1, text })),
    ...b
      .slice(start, endB)
      .map((text, i) => ({ op: "+", line: start + i + 1, text })),
  ];
  if (!n || !m) return replaced();
  // Myers: v[k] is the furthest x on diagonal k; a copy is kept per edit (bounded by MAX_EDITS).
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace = [];
  let found = false;
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS) && !found; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) (x++, y++);
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return replaced();
  const edits = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const saved = trace[d],
      at = (k) => saved[k + d + 1],
      k = x - y;
    const prev = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = d ? at(prev) : 0,
      py = px - prev;
    while (x > px && y > py) {
      (x--, y--);
      edits.push({ op: " ", line: start + x + 1, text: a[start + x] });
    }
    if (d > 0)
      edits.push(
        x === px
          ? { op: "+", line: start + y, text: b[start + --y] }
          : { op: "-", line: start + x, text: a[start + --x] },
      );
    x = px;
    y = py;
  }
  return edits.reverse();
}

export function pack(source) {
  const { canonical, difference, unstable } = canonicalize(source, parseFile);
  if (unstable) throw new Error(`Cannot be saved faithfully: ${unstable}`);
  const changes = difference
    ? diffLines(source.split("\n"), canonical.split("\n")).filter(
        (e) => e.op !== " ",
      )
    : [];
  return { canonical, changes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output = input] = process.argv.slice(2);
  if (!input) {
    console.error("usage: pack.mjs <document.html> [<output.html>]");
    process.exit(2);
  }
  let result;
  try {
    result = pack(await readFile(input, "utf8"));
  } catch (error) {
    console.error(
      `${error.message}. Run check.mjs for every location; nothing was written.`,
    );
    process.exit(1);
  }
  for (const c of result.changes)
    console.log(`${c.op} ${String(c.line).padStart(5)}  ${c.text}`);
  if (!result.changes.length && output === input)
    console.log("Already canonical; nothing to write.");
  else {
    await writeFile(output, result.canonical);
    console.log(`${result.changes.length} line(s) changed; wrote ${output}.`);
  }
}
