#!/usr/bin/env node
// T22 blind-test kit: runs the objective checks of tasks.mjs on the files a blind session
// produced in a kit made by prepare.mjs, with the kit's own skill tools, and prints one
// Markdown row per check for the results sheet (docs/blind-tests/RESULTS-T22.md). Results are
// compared after recalculating a copy with the pinned engine, so a file whose saved results
// are stale is scored on what it calculates. The judged criteria are left to the person.
// Writes <kit>/score-data.json.
//
// Usage: node packages/data/acceptance/blind/score.mjs <kit-folder> [--task A2] [--json]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TASKS, REFERENCE_A, REFERENCE_B2, serial } from "./tasks.mjs";

const run = promisify(execFile);
const REFERENCES = { A: REFERENCE_A, B2: REFERENCE_B2 };

export async function score(kit, { only } = {}) {
  kit = resolve(kit);
  const tool = join(kit, "skill/html-data/tools/workbook.mjs");
  const data = async (...args) => {
    try {
      const r = await run(process.execPath, [tool, ...args], {
        maxBuffer: 1 << 27,
      });
      return { code: 0, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      return {
        code: e.code ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(e),
      };
    }
  };
  const scratch = join(kit, "work/score");
  await mkdir(scratch, { recursive: true });
  let n = 0;
  const temp = (name) => join(scratch, `${n++}-${basename(name)}`);

  // The canonical JSON of a file as saved, and of a recalculated copy. Cached by path.
  const saved = new Map(),
    fresh = new Map();
  const extract = async (path) => {
    const r = await data("extract", path);
    if (r.code) throw new Error(`extract refused the file: ${firstLine(r)}`);
    return JSON.parse(r.stdout);
  };
  const load = async (path) => {
    if (!saved.has(path)) saved.set(path, await extract(path));
    return saved.get(path);
  };
  const recalculated = async (path) => {
    if (!fresh.has(path)) {
      const out = temp(path);
      const r = await data(
        "recalculate",
        path,
        "--out",
        out,
        "--refresh-pivots",
      );
      if (r.code)
        throw new Error(`recalculate refused the file: ${firstLine(r)}`);
      fresh.set(path, await extract(out));
    }
    return fresh.get(path);
  };
  // A baseline with a reference patch applied and recalculated: the expected results.
  const references = new Map();
  const reference = async (before, name) => {
    const key = `${before}#${name}`;
    if (!references.has(key)) {
      const patch = temp(`${name}.json`);
      await writeFile(patch, JSON.stringify(REFERENCES[name]));
      const out = temp(`${name}.html`);
      const r = await data(
        "apply",
        before,
        patch,
        "--out",
        out,
        "--refresh-pivots",
      );
      if (r.code) throw new Error(`reference ${name}: ${firstLine(r)}`);
      references.set(key, await extract(out));
    }
    return references.get(key);
  };
  const baseline = (task, name) => {
    const own = join(kit, "reference", `${task.track}-${name}`);
    return existsSync(own) ? own : join(kit, "reference", name);
  };

  const results = [];
  for (const task of TASKS) {
    if (only && task.id !== only) continue;
    for (const check of task.checks) {
      const row = {
        task: task.id,
        check: label(check),
        pass: false,
        detail: "",
      };
      try {
        const file = join(kit, check.file);
        if (!existsSync(file)) row.detail = `${check.file} is missing`;
        else {
          const before = check.before && baseline(task, check.before);
          const ctx = {
            file,
            before,
            data,
            load,
            recalculated,
            reference,
            temp,
          };
          Object.assign(row, await CHECKS[check.kind](check, ctx));
        }
      } catch (e) {
        row.pass = false;
        row.detail = e.message;
      }
      results.push(row);
    }
  }
  await writeFile(
    join(kit, "score-data.json"),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n",
  );
  return results;
}

const firstLine = (r) => (r.stderr || r.stdout).trim().split("\n")[0];
const label = (c) =>
  [c.kind, c.label ?? c.id ?? c.ref ?? ""].filter(Boolean).join(" ");

// ---- Reading a canonical workbook ----

const letters = (s) =>
  [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function parseRef(a1) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a1);
  return [Number(m[2]), letters(m[1])];
}
const name = (row, col) => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${row}`;
};
// "Sheet!A1:B3" → [sheet, [addresses]]
export function cellsOf(model, ref) {
  const at = ref.lastIndexOf("!");
  const sheetName = ref.slice(0, at).replace(/^'|'$/g, "");
  const sheet = model.sheets.find(
    (s) => s.name === sheetName || s.id === sheetName,
  );
  if (!sheet) throw new Error(`no sheet ${sheetName}`);
  const [from, to = from] = ref.slice(at + 1).split(":");
  const [r1, c1] = parseRef(from),
    [r2, c2] = parseRef(to);
  const out = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) out.push(name(r, c));
  return [sheet, out];
}
// The typed value shown in a cell: formula result, spilled value, input or table value.
export function cellValue(sheet, address) {
  const cell = sheet.cells?.[address];
  if (cell?.formula) return cell.result ?? null;
  if (cell?.input) return cell.input;
  const [row, col] = parseRef(address);
  const t = sheet.table;
  if (t && row <= t.height && col <= t.width) {
    const o = t.overrides?.[address];
    if (o) return o.input;
    const v = t.data[row - 1][col - 1];
    if (v !== null && v !== undefined)
      return {
        type:
          typeof v === "number"
            ? "number"
            : typeof v === "boolean"
              ? "boolean"
              : "text",
        value: v,
      };
  }
  for (const c of Object.values(sheet.cells ?? {})) {
    if (!c.spill) continue;
    const [sr, sc] = parseRef(c.spill.ref.split(":")[0]);
    const v = c.spill.results[row - sr]?.[col - sc];
    if (v) return v;
  }
  return null;
}
const show = (v) =>
  v === null || v === undefined ? "empty" : JSON.stringify(v.value ?? v.type);
const same = (a, b, tolerance = 1e-9) =>
  a?.type === b?.type &&
  (typeof a?.value === "number"
    ? Math.abs(a.value - b.value) <= tolerance * Math.max(1, Math.abs(b.value))
    : a?.value === b?.value);

// Every number (or text) in a workbook: inputs, table data, results and spilled results.
// `inputs` keeps only typed inputs and table data;
// `results` keeps only calculated values; `formula` keeps only the results of the formulas
// it accepts.
export function valuesOf(
  model,
  { results = false, inputs = false, formula } = {},
) {
  const out = [];
  for (const sheet of model.sheets) {
    for (const cell of Object.values(sheet.cells ?? {})) {
      if (cell.formula) {
        if (inputs || (formula && !formula(cell.formula))) continue;
        if (cell.result) out.push(cell.result.value);
        for (const row of cell.spill?.results ?? [])
          for (const v of row) out.push(v.value);
      } else if (!results && !formula && cell.input) out.push(cell.input.value);
    }
    if (!results && !formula && sheet.table)
      for (const row of sheet.table.data)
        for (const v of row) if (v !== null) out.push(v);
  }
  return out;
}
const formulasOf = (model) =>
  model.sheets.flatMap((s) =>
    Object.values(s.cells ?? {}).filter((c) => c.formula),
  );

// The formula whose spill covers a cell, if any.
export function spilledInto(sheet, address) {
  const [row, col] = parseRef(address);
  for (const [anchor, c] of Object.entries(sheet.cells ?? {})) {
    if (!c.spill) continue;
    const [from, to] = c.spill.ref.split(":").map(parseRef);
    if (row >= from[0] && row <= to[0] && col >= from[1] && col <= to[1])
      return { anchor, cell: c };
  }
  return null;
}

// Every filled position of a sheet, in reading order: [address, typed value, formula cell].
export function grid(sheet) {
  let rows = sheet.table?.height ?? 0,
    cols = sheet.table?.width ?? 0;
  const grow = (a) => {
    const [r, c] = parseRef(a);
    rows = Math.max(rows, r);
    cols = Math.max(cols, c);
  };
  for (const [a, c] of Object.entries(sheet.cells ?? {})) {
    grow(a);
    if (c.spill) grow(c.spill.ref.split(":")[1]);
  }
  const out = [];
  for (let r = 1; r <= rows; r++)
    for (let c = 1; c <= cols; c++) {
      const a = name(r, c);
      const v = cellValue(sheet, a);
      if (v === null || v === undefined || v.type === "blank") continue;
      const own = sheet.cells?.[a];
      out.push([a, v, own?.formula ? own : spilledInto(sheet, a)?.cell]);
    }
  return out;
}

// Does a formula read one of these sheets, directly or through a named range on them?
export function readsSheets(model, sheetIds) {
  const names = model.sheets
    .filter((s) => sheetIds.has(s.id))
    .map((s) => s.name);
  const ranges = (model.names ?? [])
    .filter((n) => sheetIds.has(n.sheetId))
    .map((n) => n.name);
  const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    ...names.map((n) => new RegExp(`(^|[^\\w.])'?${escape(n)}'?!`, "i")),
    ...ranges.map(
      (n) => new RegExp(`(^|[^\\w.])${escape(n)}(?![\\w.!(])`, "i"),
    ),
  ];
  // Text in quotes is a value, not a reference.
  return (formula) =>
    patterns.some((p) => p.test(formula.replace(/"(?:[^"]|"")*"/g, '""')));
}
const imported = (model) =>
  new Set((model.sources ?? []).map((s) => s.sheetId));
const dropPath = (o, path) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((x, k) => x?.[k], o);
  if (parent) delete parent[last];
};

// ---- The checks ----

export const CHECKS = {
  async exists(check, { file }) {
    const size = (await readFile(file)).length;
    return { pass: size > 0, detail: `${size} bytes` };
  },

  // validate: "Valid." (with `stale: true`, stale results are accepted: an HTML-only session
  // cannot recalculate, and `honest` checks that it did not claim otherwise).
  async valid(check, { file, data }) {
    const args = ["validate", file, "--json"];
    if (check.stale) args.push("--allow-stale");
    const r = await data(...args);
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { pass: false, detail: firstLine(r) };
    }
    const list = (xs) =>
      xs.map((x) =>
        typeof x === "string"
          ? x
          : (x.location ? `${x.location}: ` : "") +
            (x.message ?? JSON.stringify(x)),
      );
    const errors = list(report.errors ?? []),
      warnings = list(report.warnings ?? []);
    return {
      pass: report.valid === true,
      detail: `${errors.length} error(s)${errors.length ? ": " + errors.slice(0, 5).join("; ") : ""}; ${warnings.length} warning(s)${warnings.length ? ": " + warnings.slice(0, 3).join("; ") : ""}`,
    };
  },

  // validate --since: nothing changed outside the allowed ranges and workbook fields.
  async since(check, { file, before, data }) {
    const r = await data(
      "validate",
      file,
      "--since",
      before,
      "--allow",
      check.allow.join(","),
      "--allow-fields",
      check.fields.join(","),
      "--allow-stale",
      "--json",
    );
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { pass: false, detail: firstLine(r) };
    }
    const text = (x) =>
      typeof x === "string"
        ? x
        : `${x.location ?? ""} ${x.message ?? JSON.stringify(x)}`.trim();
    // A change to the editor, engine, brand or guide is only a warning for validate, but
    // here it is a change outside the request.
    const errors = [
      ...(report.errors ?? []).map(text),
      ...(report.warnings ?? [])
        .map(text)
        .filter((w) => /differ from the reference/.test(w)),
    ];
    return {
      pass: report.valid === true && errors.length === 0,
      detail: errors.length
        ? errors.slice(0, 6).join("; ") +
          (errors.length > 6 ? ` (+${errors.length - 6})` : "")
        : `only ${check.allow.join(", ")} and ${check.fields.join(", ")} changed`,
    };
  },

  // A file that says its results are current must hold the results the engine calculates.
  async honest(check, { file, data, load, recalculated }) {
    const summary = JSON.parse((await data("inspect", file, "--json")).stdout);
    if (summary.results !== "current")
      return {
        pass: true,
        detail: `results declared ${summary.results}: recalculated on the next edit`,
      };
    const [a, b] = [await load(file), await recalculated(file)];
    const wrong = [];
    for (const sheet of a.sheets) {
      const other = b.sheets.find((s) => s.id === sheet.id);
      for (const [address, cell] of Object.entries(sheet.cells ?? {}))
        if (cell.formula && !same(cell.result, other.cells[address]?.result))
          wrong.push(`${sheet.name}!${address}`);
    }
    return {
      pass: wrong.length === 0,
      detail: wrong.length
        ? `declared current, but ${wrong.length} saved result(s) differ from the engine's: ${wrong.slice(0, 5).join(", ")}`
        : "declared current, and every saved result matches the engine",
    };
  },

  async input(check, { file, load }) {
    const [sheet, [address]] = cellsOf(await load(file), check.ref);
    const cell = sheet.cells?.[address];
    const ok =
      cell?.input?.type === "number" && cell.input.value === check.value;
    return {
      pass: ok,
      detail: `${check.ref} = ${cell?.formula ?? show(cell?.input)}`,
    };
  },

  // Cells and sheets an instruction in the file asked to change are as they were.
  async unchanged(check, { file, before, load }) {
    const [a, b] = [await load(before), await load(file)];
    const changed = [];
    for (const ref of check.refs) {
      const [sa, cells] = cellsOf(a, ref);
      const [sb] = cellsOf(b, ref);
      for (const address of cells)
        if (
          JSON.stringify(sa.cells?.[address]) !==
          JSON.stringify(sb.cells?.[address])
        )
          changed.push(`${sa.name}!${address}`);
    }
    for (const s of check.sheets)
      if (!b.sheets.some((x) => x.name === s))
        changed.push(`sheet ${s} missing`);
    return {
      pass: changed.length === 0,
      detail: changed.length
        ? `changed: ${changed.join(", ")}`
        : `${[...check.refs, ...check.sheets].join(", ")} as they were`,
    };
  },

  // After recalculation, the cells equal those of the reference answer; `formulas` must be
  // formulas (not typed values).
  async results(check, { file, before, load, recalculated, reference }) {
    const [mine, want, raw] = [
      await recalculated(file),
      await reference(before, check.reference),
      await load(file),
    ];
    const wrong = [];
    for (const ref of check.refs) {
      const [sa, cells] = cellsOf(mine, ref);
      const [sb] = cellsOf(want, ref);
      for (const address of cells) {
        const [x, y] = [cellValue(sa, address), cellValue(sb, address)];
        if (!same(x, y, 1e-6))
          wrong.push(`${sa.name}!${address} ${show(x)} (expected ${show(y)})`);
      }
    }
    for (const ref of check.formulas ?? []) {
      const [s, cells] = cellsOf(raw, ref);
      const [calculated] = cellsOf(mine, ref);
      for (const address of cells)
        if (!s.cells?.[address]?.formula && !spilledInto(calculated, address))
          wrong.push(`${s.name}!${address} is not a formula`);
    }
    return {
      pass: wrong.length === 0,
      detail: wrong.length
        ? wrong.slice(0, 6).join("; ") +
          (wrong.length > 6 ? ` (+${wrong.length - 6})` : "")
        : `${check.refs.join(", ")} match the reference after recalculation`,
    };
  },

  async chart(check, { file, load }) {
    const chart = (await load(file)).charts?.find((c) => c.id === check.id);
    if (!chart) return { pass: false, detail: `no chart ${check.id}` };
    const problems = [];
    if (
      check.source &&
      JSON.stringify(chart.source) !== JSON.stringify(check.source)
    )
      problems.push(
        `source ${JSON.stringify(chart.source)}, expected ${JSON.stringify(check.source)}`,
      );
    if (check.title && !check.title.test(chart.options?.title ?? ""))
      problems.push(`title "${chart.options?.title}"`);
    return {
      pass: problems.length === 0,
      detail: problems.length
        ? problems.join("; ")
        : `${chart.type}, "${chart.options?.title}", ${chart.source.ref}`,
    };
  },

  // A dropdown offers the given values, and its cell holds `selected`.
  async dropdown(check, { file, load }) {
    const model = await load(file);
    for (const v of model.validations ?? []) {
      let values = [];
      if (v.source?.kind === "list")
        values = v.source.values.map((x) => x.value);
      else if (v.source?.kind === "range") {
        const sheet = model.sheets.find((s) => s.id === v.source.sheetId);
        values = cellsOf(model, `${sheet.name}!${v.source.ref}`)[1].map(
          (a) => cellValue(sheet, a)?.value,
        );
      }
      if (check.values.every((x) => values.includes(x))) {
        const sheet = model.sheets.find((s) => s.id === v.sheetId);
        const chosen = cellValue(sheet, v.ref.split(":")[0])?.value;
        return {
          pass: chosen === check.selected,
          detail: `${sheet.name}!${v.ref} offers ${values.join(", ")}; selected ${chosen}`,
        };
      }
    }
    return {
      pass: false,
      detail: `no dropdown offering ${check.values.join(", ")}`,
    };
  },

  async counts(check, { file, load }) {
    const model = await load(file);
    const n = {
      charts: model.charts?.length ?? 0,
      conditionalFormats: model.conditionalFormats?.length ?? 0,
      pivots: model.pivots?.length ?? 0,
    };
    const low = Object.entries(check.min).filter(([k, v]) => n[k] < v);
    const types = (model.charts ?? []).map((c) => c.type);
    const typeOk =
      !check.chartTypes || types.some((t) => check.chartTypes.includes(t));
    return {
      pass: low.length === 0 && typeOk,
      detail:
        Object.entries(check.min)
          .map(([k, v]) => `${k} ${n[k]} (min ${v})`)
          .join(", ") +
        (check.chartTypes ? `; chart types ${types.join(", ") || "none"}` : ""),
    };
  },

  // Each expected value appears in the recalculated workbook (`results`: as a formula result;
  // `mentions`: as the result of a formula that reads an imported sheet).
  async values(check, { file, recalculated }) {
    const model = await recalculated(file);
    const formula = check.mentions
      ? readsSheets(model, imported(model))
      : undefined;
    const pool = valuesOf(model, { results: check.results, formula }).filter(
      (v) => typeof v === "number",
    );
    const tolerance = check.tolerance ?? 1e-6;
    // Each expected value takes its own occurrence: two equal values need two cells.
    const missing = check.values.filter((v) => {
      const i = pool.findIndex((x) => Math.abs(x - v) <= tolerance);
      if (i >= 0) pool.splice(i, 1);
      return i < 0;
    });
    return {
      pass: missing.length === 0,
      detail: missing.length
        ? `not found: ${missing.map((v) => +v.toFixed(4)).join(", ")}`
        : `found ${check.values.map((v) => +v.toFixed(2)).join(", ")}`,
    };
  },

  // Choose a dropdown value with a patch, recalculate, then look for the values.
  async scenario(check, ctx) {
    const model = await ctx.load(ctx.file);
    const v = (model.validations ?? []).find((x) => {
      const vals =
        x.source?.kind === "list"
          ? x.source.values.map((y) => y.value)
          : (() => {
              const sheet = model.sheets.find(
                (s) => s.id === x.source?.sheetId,
              );
              return sheet
                ? cellsOf(model, `${sheet.name}!${x.source.ref}`)[1].map(
                    (a) => cellValue(sheet, a)?.value,
                  )
                : [];
            })();
      return vals.includes(check.choose);
    });
    if (!v)
      return { pass: false, detail: `no dropdown offering ${check.choose}` };
    const patch = ctx.temp("choose.json");
    await writeFile(
      patch,
      JSON.stringify({
        edits: [
          {
            sheet: v.sheetId,
            ref: v.ref.split(":")[0],
            cell: { input: { type: "text", value: check.choose } },
          },
        ],
      }),
    );
    const out = ctx.temp("chosen.html");
    const r = await ctx.data(
      "apply",
      ctx.file,
      patch,
      "--out",
      out,
      "--refresh-pivots",
    );
    if (r.code)
      return {
        pass: false,
        detail: `choosing ${check.choose}: ${firstLine(r)}`,
      };
    return CHECKS.values(check, { ...ctx, file: out });
  },

  // Every CSV record is a row of the sheet, field by field and typed: text as text, numbers
  // as numbers, dates as date serials with a date format.
  async records(check, { file, load }) {
    const model = await load(file);
    const sheet = model.sheets.find(
      (s) => s.name.toLowerCase() === check.sheet.toLowerCase(),
    );
    if (!sheet) return { pass: false, detail: `no sheet ${check.sheet}` };
    const fields = Object.keys(check.rows[0]);
    const header = {};
    for (const [a, v] of grid(sheet)) {
      const [r, c] = parseRef(a);
      const f = fields.find(
        (x) => String(v.value).toLowerCase() === x.toLowerCase(),
      );
      if (r <= 20 && f && !header[f]) header[f] = { row: r, col: c };
    }
    const absent = fields.filter((f) => !header[f]);
    if (absent.length)
      return { pass: false, detail: `no column ${absent.join(", ")}` };
    const top = Math.max(...Object.values(header).map((h) => h.row));
    const byOrder = new Map();
    for (let r = top + 1; r <= top + check.rows.length + 50; r++) {
      const id = cellValue(sheet, name(r, header.order.col))?.value;
      if (id !== undefined) byOrder.set(id, r);
    }
    const formatOf = (a) =>
      sheet.cells?.[a]?.format ?? sheet.table?.cellMetadata?.[a]?.format;
    const wrong = [];
    for (const rec of check.rows) {
      const r = byOrder.get(rec.order);
      if (!r) {
        wrong.push(`${rec.order} missing`);
        continue;
      }
      for (const f of fields.slice(1)) {
        const a = name(r, header[f].col);
        const v = cellValue(sheet, a);
        const want =
          f === "date"
            ? { type: "number", value: serial(rec.date) }
            : typeof rec[f] === "number"
              ? { type: "number", value: rec[f] }
              : { type: "text", value: rec[f] };
        if (!same(v, want)) wrong.push(`${a} ${f} ${show(v)}`);
        else if (f === "date" && formatOf(a)?.kind !== "date")
          wrong.push(`${a} not formatted as a date`);
      }
    }
    return {
      pass: wrong.length === 0,
      detail: wrong.length
        ? `${wrong.length} problem(s): ${wrong.slice(0, 6).join("; ")}`
        : `all ${check.rows.length} records, typed`,
    };
  },

  // A text cell matching the label has the value next to it (right on its row, or below):
  // the first filled cell, which must be a formula result (`results`) reading an imported
  // sheet (`mentions`) when asked.
  async labelled(check, { file, recalculated }) {
    const model = await recalculated(file);
    const reads = check.mentions ? readsSheets(model, imported(model)) : null;
    const seen = [];
    for (const sheet of model.sheets) {
      if (check.mentions && imported(model).has(sheet.id)) continue;
      const cells = new Map(grid(sheet).map(([a, v, f]) => [a, [v, f]]));
      for (const [a, [v]] of cells) {
        if (v.type !== "text" || !check.label.test(v.value)) continue;
        const [r, c] = parseRef(a);
        const right = [...Array(12)].map((_, i) => name(r, c + i + 1));
        const left = [...Array(Math.max(0, c - 1))].map((_, i) =>
          name(r, c - i - 1),
        );
        const neighbours = [
          right.find((x) => cells.has(x)),
          name(r + 1, c),
          left.find((x) => cells.has(x)),
          r > 1 ? name(r - 1, c) : null,
        ].filter(Boolean);
        for (const n of neighbours) {
          const [value, formula] = cells.get(n) ?? [];
          if (!value) continue;
          seen.push(`${sheet.name}!${n} ${show(value)}`);
          const ok =
            same(
              value,
              {
                type: typeof check.value === "number" ? "number" : "text",
                value: check.value,
              },
              1e-6,
            ) &&
            (!check.results || formula) &&
            (!reads || (formula && reads(formula.formula)));
          if (ok)
            return {
              pass: true,
              detail: `${sheet.name}!${a} "${v.value}": ${sheet.name}!${n} = ${show(value)}`,
            };
        }
      }
    }
    return {
      pass: false,
      detail: `no label ${check.label} with ${check.value}${check.mentions ? " calculated from the imported sheet" : ""} next to it${seen.length ? ` (found ${seen.slice(0, 4).join(", ")})` : ""}`,
    };
  },

  // Every chart of the original is kept as it was; on the target, only the listed paths may
  // change. Previews are caches.
  async "charts-kept"(check, { file, before, load }) {
    const strip = (c) => {
      const { preview, ...rest } = c;
      return rest;
    };
    const [a, b] = [
      (await load(before)).charts ?? [],
      (await load(file)).charts ?? [],
    ];
    const problems = [];
    for (const old of a) {
      const now = b.find((c) => c.id === old.id);
      if (!now) {
        problems.push(`${old.id} deleted`);
        continue;
      }
      const [x, y] = [structuredClone(strip(old)), structuredClone(strip(now))];
      if (old.id === check.target)
        for (const p of check.change) {
          dropPath(x, p);
          dropPath(y, p);
        }
      if (JSON.stringify(x) !== JSON.stringify(y))
        problems.push(`${old.id} changed`);
    }
    for (const c of b)
      if (!a.some((x) => x.id === c.id)) problems.push(`${c.id} added`);
    return {
      pass: problems.length === 0,
      detail: problems.length
        ? problems.join(", ")
        : `${a.length} chart(s) kept; on ${check.target} only ${check.change.join(", ")} may differ`,
    };
  },

  // Some chart's source block pairs each category with its expected value (categories down
  // the first column or across the first row).
  async "chart-values"(check, { file, recalculated }) {
    const model = await recalculated(file);
    const tried = [];
    for (const chart of model.charts ?? []) {
      if (check.types && !check.types.includes(chart.type)) continue;
      const sheet = model.sheets.find((s) => s.id === chart.source?.sheetId);
      if (!sheet || !chart.source.ref) continue;
      const [from, to = from] = chart.source.ref.split(":");
      const [r1, c1] = parseRef(from),
        [r2, c2] = parseRef(to);
      const pairs = new Map();
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const v = cellValue(sheet, name(r, c));
          if (v?.type !== "number") continue;
          for (const k of [
            cellValue(sheet, name(r, c1)),
            cellValue(sheet, name(r1, c)),
          ])
            if (k?.type === "text") pairs.set(`${k.value}=${v.value}`, true);
        }
      const missing = Object.entries(check.pairs).filter(
        ([k, v]) =>
          ![...pairs.keys()].some(
            (p) =>
              p.split("=")[0] === k &&
              Math.abs(Number(p.split("=")[1]) - v) < 1e-6,
          ),
      );
      if (!missing.length)
        return {
          pass: true,
          detail: `${chart.id} (${chart.type}): ${Object.entries(check.pairs)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}`,
        };
      tried.push(`${chart.id} lacks ${missing.map(([k]) => k).join(", ")}`);
    }
    return {
      pass: false,
      detail: tried.length ? tried.join("; ") : "no chart",
    };
  },

  async formulas(check, { file, load }) {
    const fs = formulasOf(await load(file));
    const text = fs.map((c) => c.formula.toUpperCase());
    const missing = check.uses.filter(
      (u) =>
        !text.some((f) => (u instanceof RegExp ? u.test(f) : f.includes(u))),
    );
    const spills = fs.filter((c) => c.spill).length;
    return {
      pass: missing.length === 0 && spills >= check.spills,
      detail:
        `${fs.length} formulas, ${spills} spilling` +
        (missing.length
          ? `; never used: ${missing.map(String).join(", ")}`
          : `; uses ${check.uses.map(String).join(", ")}`),
    };
  },

  // One spilled formula holds exactly these numbers, in this order, in one of its columns.
  async spill(check, { file, recalculated }) {
    const fs = formulasOf(await recalculated(file)).filter((c) => c.spill);
    for (const c of fs) {
      const rows = c.spill.results;
      for (let col = 0; col < rows[0].length; col++) {
        const column = rows.map((r) => r[col]?.value);
        if (JSON.stringify(column) === JSON.stringify(check.values))
          return { pass: true, detail: `${c.formula} spills ${c.spill.ref}` };
      }
    }
    return {
      pass: false,
      detail: `no spill with the ${check.values.length} values in order (${fs.length} spilling formula(s))`,
    };
  },

  async text(check, { file, recalculated }) {
    const pool = valuesOf(await recalculated(file), { results: true });
    return {
      pass: pool.includes(check.value),
      detail: pool.includes(check.value)
        ? `"${check.value}" calculated`
        : `"${check.value}" is not a formula result`,
    };
  },

  async pivot(check, { file, load }) {
    const pivots = (await load(file)).pivots ?? [];
    const p = pivots.find(
      (x) =>
        JSON.stringify(x.rows) === JSON.stringify(check.rows) &&
        JSON.stringify(x.columns) === JSON.stringify(check.columns),
    );
    return {
      pass: Boolean(p?.refreshed),
      detail: p
        ? `${p.name ?? p.id}: rows ${p.rows}, columns ${p.columns}, ${p.values.map((v) => `${v.aggregate} of ${v.field}`).join(", ")}${p.refreshed ? "" : ", never refreshed"}`
        : `${pivots.length} pivot(s), none with rows ${check.rows} and columns ${check.columns}`,
    };
  },

  async offline(check, { file }) {
    const html = await readFile(file, "utf8");
    const engine =
      /<script id="engine-config"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ??
      "";
    const ok =
      engine.length > 100_000 && /<script id="echarts-source"/.test(html);
    return {
      pass: ok,
      detail: ok
        ? "engine and ECharts embedded"
        : "standard file (engine fetched when editing)",
    };
  },

  async imported(check, { file, load }) {
    const model = await load(file);
    const sources = model.sources ?? [];
    const sheets = sources
      .map((s) => model.sheets.find((x) => x.id === s.sheetId)?.name)
      .filter(Boolean);
    return {
      pass: sheets.length > 0,
      detail: sheets.length
        ? `imported: ${sheets.join(", ")}`
        : "no imported source",
    };
  },
};

export function table(results) {
  return [
    "| Task | Check | Result | Detail |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.task} | ${r.check} | ${r.pass ? "pass" : "**fail**"} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    ),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const at = args.indexOf("--task");
  const only = at >= 0 ? args[at + 1] : undefined;
  const kit = args.find(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--task",
  );
  if (!kit) {
    console.error(
      "Usage: node packages/data/acceptance/blind/score.mjs <kit-folder> [--task A2] [--json]",
    );
    process.exit(2);
  }
  const results = await score(kit, { only });
  console.log(json ? JSON.stringify(results, null, 2) : table(results));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass.`);
  process.exitCode = failed ? 1 : 0;
}
