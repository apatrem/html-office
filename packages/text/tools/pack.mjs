#!/usr/bin/env node
// html-text pack: rewrites a valid document into canonical form (FORMAT.md › Canonical form)
// and lists every changed line. This is the only normalisation step: the editor never applies it silently.
//   node pack.mjs <document.html> [<output.html>]   (default: rewrite in place)
// Refuses a document with errors (exit 1) and leaves it unchanged.
import { readFile, writeFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { canonicalize } from "../editor/schema/document.mjs";

// Myers' shortest edit script on lines: [{op: " " | "-" | "+", line, text}].
export function diffLines(a, b) {
  const max = a.length + b.length;
  const v = new Map([[1, 0]]);
  const trace = [];
  search: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))
          ? v.get(k + 1)
          : v.get(k - 1) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) (x++, y++);
      v.set(k, x);
      if (x >= a.length && y >= b.length) break search;
    }
  }
  const edits = [];
  let x = a.length,
    y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d],
      k = x - y;
    const prev =
      k === -d || (k !== d && v.get(k - 1) < v.get(k + 1)) ? k + 1 : k - 1;
    const px = v.get(prev),
      py = px - prev;
    while (x > px && y > py) edits.push({ op: " ", line: x--, text: a[--y] });
    if (d > 0)
      edits.push(
        x === px
          ? { op: "+", line: y, text: b[--y] }
          : { op: "-", line: x, text: a[--x] },
      );
    x = px;
    y = py;
  }
  return edits.reverse();
}

export function pack(source) {
  const { canonical, difference } = canonicalize(source, parseFile);
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
