#!/usr/bin/env node
// html-text checker: validates a document against the canonical subset (FORMAT.md).
//   node check.mjs <document.html> [--json]
// Lists errors (rejected), protected blocks (kept, not editable) and warnings, with line:column.
// A valid document that is not in canonical form gets a not-canonical warning: run pack.mjs.
// Exit code 1 when at least one error remains.
import { readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { canonicalize } from "../editor/schema/document.mjs";

const excerpt = (text, offset) =>
  JSON.stringify(text.slice(offset, offset + 40));

export function checkSource(source) {
  const report = validateFile(parseFile(source));
  if (!report.ok) return report;
  const { canonical, difference, unstable } = canonicalize(source, parseFile);
  if (unstable) {
    report.ok = false;
    report.errors.push({
      code: "unstable",
      message: `Cannot be saved faithfully: ${unstable}. Usually markup the HTML parser repaired, inside a protected block`,
      path: "article#doc",
    });
  } else if (difference)
    report.warnings.push({
      code: "not-canonical",
      message: `Not in canonical form: expected ${excerpt(canonical, difference.offset)}, found ${excerpt(source, difference.offset)}. pack.mjs rewrites it`,
      path: "document",
      line: difference.line,
      col: difference.col,
    });
  return report;
}

export async function checkFile(file) {
  return checkSource(await readFile(file, "utf8"));
}

const at = (f) => (f.line ? `${f.line}:${f.col}` : "-");

export function formatReport(report) {
  const lines = [
    ...report.errors.map(
      (f) => `error      ${at(f)}  ${f.code}: ${f.message} (${f.path})`,
    ),
    ...report.protected.map(
      (f) => `protected  ${at(f)}  ${f.path}: ${f.reasons.join("; ")}`,
    ),
    ...report.warnings.map(
      (f) => `warning    ${at(f)}  ${f.code}: ${f.message} (${f.path})`,
    ),
  ];
  lines.push(
    `${report.errors.length} error(s), ${report.protected.length} protected block(s), ${report.warnings.length} warning(s)`,
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: check.mjs <document.html> [--json]");
    process.exit(2);
  }
  const report = await checkFile(file);
  const { blocks, ...findings } = report;
  console.log(
    args.includes("--json")
      ? JSON.stringify(findings, null, 2)
      : formatReport(report),
  );
  process.exit(report.ok ? 0 : 1);
}
