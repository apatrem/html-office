#!/usr/bin/env node
// HTML Data document tools (T20). They read and write the canonical JSON
// workbook inside an HTML Data file; everything else in the file is kept
// byte for byte.
//   new         <out.html> --model model.json [--offline] [--charte f.css] [--force]
//   extract     <file.html> [--out model.json] [--charte-out theme.css]
//   inspect     <file.html> [--range Sheet!A1:D20] [--json]
//   apply       <file.html> <patch.json> (--out out.html | --in-place)
//               [--no-recalculate] [--refresh-pivots] [--dry-run] [--json]
//   recalculate <file.html> (--out out.html | --in-place) [--refresh-pivots]
//   validate    <file.html> [--range Sheet!A1:D20] [--since before.html]
//               [--allow Sheet!A1:B5,...] [--allow-fields charts,...]
//               [--allow-stale] [--json]
// Exit code 1 when the command found errors (nothing is written then),
// 2 for a usage error.
import { readFile, writeFile, access, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { readModel, writeModel } from "../model/document.mjs";
import { snapshotState } from "../model/snapshots.mjs";
import { pivotState, pivotLabel } from "../model/pivot.mjs";
import { chartData, chartRevision, chartLabel } from "../model/charts.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { display } from "../runtime/view.mjs";
import {
  readDocument,
  writeDocument,
  locatePayload,
  outside,
  charteCSS,
} from "./document-html.mjs";
import {
  applyPatch,
  inspectRange,
  locateErrors,
  parseTarget,
  preservation,
  summary,
  SETTABLE,
} from "./workbook-ops.mjs";
import { recalculate, refreshPivots } from "./engine-node.mjs";
import { renderPreviews, cssTheme } from "./chart-previews.mjs";

const USAGE = `Usage:
  workbook.mjs new <out.html> --model model.json [--offline] [--charte f.css] [--force]
  workbook.mjs extract <file.html> [--out model.json] [--charte-out theme.css]
  workbook.mjs inspect <file.html> [--range Sheet!A1:D20] [--json]
  workbook.mjs apply <file.html> <patch.json> (--out out.html | --in-place) [--no-recalculate] [--refresh-pivots] [--dry-run] [--json]
  workbook.mjs recalculate <file.html> (--out out.html | --in-place) [--refresh-pivots]
  workbook.mjs validate <file.html> [--range Sheet!A1:D20] [--since before.html] [--allow Sheet!A1:B5,...] [--allow-fields charts,...] [--allow-stale] [--json]`;

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (
      [
        "--model",
        "--charte",
        "--out",
        "--range",
        "--since",
        "--allow",
        "--allow-fields",
        "--charte-out",
      ].includes(a)
    )
      out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

// The located errors, and the reader's own message when they miss it.
const withCause = (detail, error) =>
  detail.some((line) => line.endsWith(error.message))
    ? detail
    : [...detail, `document: ${error.message}`];

class Failure extends Error {
  constructor(errors, code = 1) {
    super(errors.join("\n"));
    this.errors = errors;
    this.code = code;
  }
}
const usage = (message) => new Failure([`${message}\n${USAGE}`], 2);
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function load(file) {
  const html = await readFile(file, "utf8");
  try {
    return { html, read: readDocument(html) };
  } catch (error) {
    // A workbook that does not validate: list every invalid cell.
    let detail = [];
    try {
      const { start, end } = locatePayload(html);
      detail = locateErrors(JSON.parse(html.slice(start, end)));
    } catch {
      // Not parsable as JSON: the first message says why.
    }
    throw new Failure(withCause(detail, error));
  }
}

// Where an edited file goes: a new path, or the same one with --in-place.
async function target(input, args) {
  if (args["in-place"]) return input;
  if (!args.out) throw usage("Choose --out <file.html> or --in-place.");
  if (resolve(args.out) === resolve(input))
    throw usage("--out is the input file: use --in-place to overwrite it.");
  return args.out;
}

// Results, pivots and chart previews that are not current.
async function freshness(book, html) {
  const state = await snapshotState(book),
    current = state.state === "current",
    findings = [];
  if (state.state === "missing")
    findings.push(
      `${state.missing.length} formula result${state.missing.length === 1 ? " is" : "s are"} missing: recalculate.`,
    );
  else if (state.state === "stale")
    findings.push("Saved results are stale: recalculate.");
  for (const pivot of book.pivots ?? []) {
    const { state: p } = await pivotState(book, pivot, {
      formulaResultsCurrent: current,
    });
    if (p !== "current")
      findings.push(
        `Pivot table "${pivotLabel(pivot)}" is ${p === "never" ? "not yet refreshed" : p}: recalculate with --refresh-pivots.`,
      );
  }
  if (book.charts?.length) {
    const theme = cssTheme(charteCSS(html), CHARTES[book.theme]),
      label = (cell) => display(cell, book.locale);
    for (const chart of book.charts) {
      const { data, errors } = chartData(book, chart, label);
      if (errors.length)
        findings.push(
          `Chart "${chartLabel(chart)}" cannot be drawn: ${errors.join(" ")}`,
        );
      else if (
        !chart.preview ||
        chart.preview.revision !== (await chartRevision(chart, data, theme))
      )
        findings.push(
          `Chart "${chartLabel(chart)}" has ${chart.preview ? "an out-of-date" : "no"} preview: recalculate to redraw it.`,
        );
    }
  }
  return findings;
}

// Recalculation (with pivot refresh on request), then chart previews.
async function calculate(book, html, { pivots, committed }) {
  const next = pivots
    ? await refreshPivots(book, committed)
    : await recalculate(book);
  return renderPreviews(next, charteCSS(html));
}

// A file is replaced only once its new content is fully written: a failed
// or interrupted write leaves the previous file intact.
async function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

const print = (args, value, text) =>
  console.log(args.json ? JSON.stringify(value, null, 2) : text);

export async function run(argv) {
  const args = parseArgs(argv),
    [command, file, second] = args._;
  if (!command || !file) throw usage("Missing command or file.");
  if (command === "new") {
    if (!args.model) throw usage("new needs --model model.json.");
    if (!args.force && (await exists(file)))
      throw usage(`${file} exists: use --force to replace it.`);
    const text = await readFile(args.model, "utf8");
    let book;
    try {
      book = readModel(text);
    } catch (error) {
      let detail = [];
      try {
        detail = locateErrors(JSON.parse(text));
      } catch {
        // Not JSON: the first message says why.
      }
      throw new Failure(withCause(detail, error));
    }
    const { buildWorkbook } = await import("./build.mjs"),
      html = await buildWorkbook(book, {
        offline: !!args.offline,
        charte: args.charte,
      });
    await writeAtomic(file, html);
    const { book: built } = readDocument(html);
    print(
      args,
      { output: file, offline: !!args.offline, bytes: html.length },
      `Created ${file} (${args.offline ? "offline" : "standard"}, ${html.length.toLocaleString("en-US")} bytes); results ${(await snapshotState(built)).state}.`,
    );
    return;
  }
  const { html, read } = await load(file);
  if (command === "extract") {
    // The document's own brand stylesheet, to build another file of the
    // same workbook with `new --charte`.
    if (args["charte-out"]) {
      await writeAtomic(args["charte-out"], charteCSS(html));
      console.error(`Wrote ${args["charte-out"]}.`);
    }
    const json = writeModel(read.book);
    if (args.out) {
      await writeAtomic(args.out, json + "\n");
      console.log(`Wrote ${args.out}.`);
    } else console.log(json);
    return;
  }
  if (command === "inspect") {
    const value = args.range
      ? inspectRange(read.book, args.range)
      : await summary(read.book);
    print(args, value, JSON.stringify(value, null, 2));
    return;
  }
  if (command === "apply") {
    if (!second) throw usage("apply needs a patch file.");
    let patch;
    try {
      patch = JSON.parse(await readFile(second, "utf8"));
    } catch (error) {
      throw new Failure([`${second}: not valid JSON (${error.message}).`]);
    }
    const result = applyPatch(read.book, patch);
    if (result.errors.length)
      throw new Failure(result.errors.map((e, i) => `${i + 1}. ${e}`));
    if (args["dry-run"]) {
      print(
        args,
        { valid: true, cells: result.touched.size },
        `Patch valid: ${result.touched.size} cell${result.touched.size === 1 ? "" : "s"}. Nothing written (--dry-run).`,
      );
      return;
    }
    const output = await target(file, args);
    let next = result.book;
    if (!args["no-recalculate"])
      next = await calculate(next, html, {
        pivots: args["refresh-pivots"],
        committed: read.book.pivots ?? [],
      });
    const allow = [...result.touched.keys()].map((key) => {
        const [sheetId, ref] = key.split("!");
        return { sheetId, rect: parseTarget(next, ref, sheetId).rect };
      }),
      problems = preservation(read.book, next, {
        allow,
        fields: Object.keys(patch.set ?? {}),
      });
    if (problems.length) throw new Failure(problems);
    const updated = writeDocument(html, read, next);
    await writeAtomic(output, updated);
    const state = (await snapshotState(next)).state;
    print(
      args,
      {
        output,
        cells: result.touched.size,
        recalculated: !args["no-recalculate"],
        results: state,
      },
      `Applied ${result.touched.size} cell edit${result.touched.size === 1 ? "" : "s"} to ${output}; results ${state}${args["no-recalculate"] ? " (not recalculated)" : ""}.`,
    );
    return;
  }
  if (command === "recalculate") {
    const output = await target(file, args),
      next = await calculate(read.book, html, {
        pivots: args["refresh-pivots"],
      }),
      problems = preservation(read.book, next);
    if (problems.length) throw new Failure(problems);
    await writeAtomic(output, writeDocument(html, read, next));
    console.log(`Recalculated ${output}.`);
    return;
  }
  if (command === "validate") {
    const errors = [],
      warnings = [];
    const stale = await freshness(read.book, html);
    (args["allow-stale"] ? warnings : errors).push(...stale);
    if (args.range) {
      const { cells, sheet, range } = inspectRange(read.book, args.range);
      for (const { ref, cell } of cells)
        if (cell.formula && !cell.result)
          errors.push(
            `${sheet}!${ref}: formula ${cell.formula} has no result.`,
          );
        else if (cell.formula && cell.result.type === "error")
          warnings.push(
            `${sheet}!${ref}: ${cell.formula} returns ${cell.result.value}.`,
          );
      warnings.push(`Checked ${sheet}!${range}: ${cells.length} cells.`);
    }
    if (args.since) {
      const before = await load(args.since),
        allow = (args.allow ? String(args.allow).split(",") : []).map(
          (text) => {
            const { sheet, rect } = parseTarget(read.book, text.trim());
            return { sheetId: sheet.id, rect };
          },
        );
      // Workbook fields a patch replaced with "set" (charts, pivots…).
      const fields = args["allow-fields"]
        ? String(args["allow-fields"])
            .split(",")
            .map((f) => f.trim())
        : [];
      for (const field of fields)
        if (!SETTABLE.includes(field))
          throw usage(
            `--allow-fields: "${field}" is not a settable field (${SETTABLE.join(", ")}).`,
          );
      errors.push(
        ...preservation(before.read.book, read.book, { allow, fields }),
      );
      if (outside(before.html, before.read) !== outside(html, read))
        warnings.push(
          "The file's editor, engine, brand or guide differ from the reference; only the workbook payload is expected to change.",
        );
    }
    print(
      args,
      { valid: !errors.length, errors, warnings },
      [
        errors.length
          ? `${errors.length} error${errors.length === 1 ? "" : "s"}:`
          : "Valid.",
        ...errors.map((e, i) => `  ${i + 1}. ${e}`),
        ...warnings.map((w) => `  note: ${w}`),
      ].join("\n"),
    );
    if (errors.length) process.exitCode = 1;
    return;
  }
  throw usage(`Unknown command "${command}".`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  run(process.argv.slice(2)).catch((error) => {
    if (error instanceof Failure) {
      console.error(
        error.code === 2
          ? error.errors.join("\n")
          : `Error${error.errors.length > 1 ? "s" : ""}; nothing was written:\n${error.errors.join("\n")}`,
      );
      process.exit(error.code);
    }
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
