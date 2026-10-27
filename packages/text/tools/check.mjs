#!/usr/bin/env node
// html-text checker: validates a document against the canonical subset (FORMAT.md).
//   node check.mjs <document.html> [--json]
// Lists errors (rejected), protected blocks (kept, not editable) and warnings, with line:column.
// Exit code 1 when at least one error remains.
import { readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";

export async function checkFile(file) {
  return validateFile(parseFile(await readFile(file, "utf8")));
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
