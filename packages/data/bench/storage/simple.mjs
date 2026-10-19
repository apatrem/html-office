// Assessment-only evaluator. Never bundled into the default document runtime.
// Its eligibility/conformance report is evidence, not permission to ship a second engine.
import { parseAddress, parseRange, address } from "../../model/workbook.mjs";
const aggregate = new Set(["SUM", "AVERAGE", "MIN", "MAX"]);
const reference =
  /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*)$/;
const lex =
  /\s*(?:((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|((?:(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?[A-Za-z]{1,3}\$?[1-9]\d*)|("(?:[^"]|"")*")|([A-Za-z_][\w.]*)|(>=|<=|<>|[+*/(),:=>\-<]))/gy;
export function parseFormula(formula) {
  const text = formula.slice(1),
    tokens = [];
  let offset = 0;
  while (offset < text.length) {
    lex.lastIndex = offset;
    const m = lex.exec(text);
    if (!m) {
      if (!text.slice(offset).trim()) break;
      throw new Error("Unsupported formula syntax");
    }
    tokens.push({
      value: m[0].trim(),
      number: m[1],
      ref: m[2],
      string: m[3],
      id: m[4],
      op: m[5],
    });
    offset = lex.lastIndex;
  }
  let cursor = 0;
  const take = (value) =>
    tokens[cursor]?.value === value ? (cursor++, true) : false;
  function atom() {
    if (take("-")) return { kind: "unary", node: atom() };
    if (take("+")) return atom();
    if (take("(")) {
      const node = expression();
      if (!take(")")) throw new Error("Missing )");
      return node;
    }
    const token = tokens[cursor++];
    if (!token) throw new Error("Expected value");
    if (token.number)
      return {
        kind: "literal",
        value: { type: "number", value: Number(token.number) },
      };
    if (token.string)
      return {
        kind: "literal",
        value: {
          type: "text",
          value: token.string.slice(1, -1).replaceAll('""', '"'),
        },
      };
    if (token.ref) {
      const m = reference.exec(token.ref);
      const node = {
        kind: "ref",
        sheet: m[1]?.replaceAll("''", "'") ?? m[2] ?? null,
        ref: m[3].replaceAll("$", "").toUpperCase(),
      };
      parseAddress(node.ref);
      if (take(":")) {
        const end = atom();
        if (end.kind !== "ref") throw new Error("Invalid range");
        if (end.sheet && node.sheet !== end.sheet)
          throw new Error("Unsupported range");
        return {
          kind: "range",
          sheet: node.sheet,
          ref: `${node.ref}:${end.ref}`,
        };
      }
      return node;
    }
    if (token.id) {
      const name = token.id.toUpperCase();
      if (!take("(")) {
        if (name === "TRUE" || name === "FALSE")
          return {
            kind: "literal",
            value: { type: "boolean", value: name === "TRUE" },
          };
        throw new Error("Named expression requires engine");
      }
      const args = [];
      if (!take(")")) {
        do {
          args.push(expression());
        } while (take(","));
        if (!take(")")) throw new Error("Missing )");
      }
      return { kind: "call", name, args };
    }
    throw new Error("Unsupported token");
  }
  function product() {
    let node = atom();
    while (["*", "/"].includes(tokens[cursor]?.value)) {
      const op = tokens[cursor++].value;
      node = { kind: "binary", op, left: node, right: atom() };
    }
    return node;
  }
  function sum() {
    let node = product();
    while (["+", "-"].includes(tokens[cursor]?.value)) {
      const op = tokens[cursor++].value;
      node = { kind: "binary", op, left: node, right: product() };
    }
    return node;
  }
  function expression() {
    let node = sum();
    if (["=", "<>", ">", "<", ">=", "<="].includes(tokens[cursor]?.value)) {
      const op = tokens[cursor++].value;
      node = { kind: "binary", op, left: node, right: sum() };
    }
    return node;
  }
  const node = expression();
  if (cursor !== tokens.length) throw new Error("Trailing syntax");
  return node;
}
function walk(node, fn) {
  fn(node);
  if (node.kind === "binary") {
    walk(node.left, fn);
    walk(node.right, fn);
  }
  if (node.kind === "unary") walk(node.node, fn);
  for (const a of node.args ?? []) walk(a, fn);
}
export function analyse(book) {
  const formulas = new Map(),
    bySheet = new Map(book.sheets.map((s) => [s.id, []])),
    classes = { arithmetic: 0, aggregates: 0, "round-if": 0, other: 0 };
  for (const sheet of book.sheets)
    for (const [ref, cell] of Object.entries(sheet.cells))
      if (cell.formula) {
        let node,
          kind = "arithmetic";
        try {
          node = parseFormula(cell.formula);
          walk(node, (n) => {
            if (n.kind === "call") {
              if (!aggregate.has(n.name))
                kind =
                  ["ROUND", "IF"].includes(n.name) && kind !== "other"
                    ? "round-if"
                    : "other";
              else if (kind === "arithmetic") kind = "aggregates";
            }
            if (
              n.kind === "binary" &&
              !["+", "-", "*", "/"].includes(n.op) &&
              kind !== "other"
            )
              kind = "round-if";
          });
        } catch {
          kind = "other";
        }
        const entry = { sheetId: sheet.id, ref, node, kind };
        formulas.set(`${sheet.id}!${ref}`, entry);
        bySheet.get(sheet.id).push(entry);
        classes[kind]++;
      }
  const sheetID = (name, current) =>
    name === null
      ? current
      : book.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase())
          ?.id;
  for (const entry of formulas.values()) {
    entry.dependencies = new Set();
    if (!entry.node) continue;
    walk(entry.node, (n) => {
      if (n.kind === "ref") {
        const key = `${sheetID(n.sheet, entry.sheetId)}!${n.ref}`;
        if (formulas.has(key)) entry.dependencies.add(key);
      }
      if (n.kind === "range") {
        const range = parseRange(n.ref);
        for (const e of bySheet.get(sheetID(n.sheet, entry.sheetId)) ?? []) {
          const p = parseAddress(e.ref);
          if (
            p.row >= range.top &&
            p.row <= range.bottom &&
            p.column >= range.left &&
            p.column <= range.right
          )
            entry.dependencies.add(`${e.sheetId}!${e.ref}`);
        }
      }
    });
  }
  const eligible = new Set(),
    memo = new Map(),
    depthMemo = new Map();
  let cycles = 0;
  function simple(key, path = new Set()) {
    if (memo.has(key)) return memo.get(key);
    const e = formulas.get(key);
    if (path.has(key)) {
      cycles++;
      return false;
    }
    if (!["arithmetic", "aggregates"].includes(e.kind)) {
      memo.set(key, false);
      return false;
    }
    const next = new Set(path);
    next.add(key);
    const ok = [...e.dependencies].every((d) => simple(d, next));
    memo.set(key, ok);
    if (ok) eligible.add(key);
    return ok;
  }
  function depth(key, path = new Set()) {
    if (depthMemo.has(key)) return depthMemo.get(key);
    if (path.has(key) || path.size > 500) return null;
    const e = formulas.get(key);
    if (!e.node) return null;
    const next = new Set(path);
    next.add(key);
    let max = 0;
    for (const dep of e.dependencies) {
      const d = depth(dep, next);
      if (d === null) return null;
      max = Math.max(max, d);
    }
    const value = max + 1;
    depthMemo.set(key, value);
    return value;
  }
  for (const key of formulas.keys()) simple(key);
  const depths = [...formulas.keys()].map((k) => depth(k));
  return {
    formulas,
    eligible,
    classes,
    sheetID,
    cycles,
    dependencyDepth: {
      maximumParsedDepth: Math.max(0, ...depths.filter((d) => d !== null)),
      unresolvedFormulaCount: depths.filter((d) => d === null).length,
    },
  };
}
const error = (code) => ({ type: "error", value: code });
export function evaluateSimple(book, analysis = analyse(book)) {
  const values = new Map();
  const numeric = (v) =>
    v.type === "error"
      ? v
      : v.type === "blank"
        ? 0
        : v.type === "boolean"
          ? v.value
            ? 1
            : 0
          : v.type === "text"
            ? v.value.trim() !== "" && Number.isFinite(Number(v.value))
              ? Number(v.value)
              : error("#VALUE!")
            : v.value;
  function cell(sheetId, ref) {
    const key = `${sheetId}!${ref}`;
    if (values.has(key)) return values.get(key);
    const sheet = book.sheets.find((s) => s.id === sheetId);
    if (!sheet) return error("#REF!");
    const c = sheet.cells[ref];
    if (!c) return { type: "blank" };
    if (!c.formula) return c.input ?? { type: "blank" };
    if (!analysis.eligible.has(key))
      throw new Error("Dependency is outside the evaluator scope");
    let value = calculate(analysis.formulas.get(key).node, sheetId);
    if (value.type === "date") value = { type: "number", value: value.value };
    if (value.type === "blank") value = { type: "number", value: 0 };
    values.set(key, value);
    return value;
  }
  function calculate(node, current) {
    if (node.kind === "literal") return node.value;
    if (node.kind === "ref")
      return cell(analysis.sheetID(node.sheet, current), node.ref);
    if (node.kind === "range") throw new Error("Range outside aggregate");
    if (node.kind === "unary") {
      const a = numeric(calculate(node.node, current));
      return typeof a === "number" ? { type: "number", value: -a } : a;
    }
    if (node.kind === "binary") {
      const left = numeric(calculate(node.left, current));
      if (typeof left !== "number") return left;
      const right = numeric(calculate(node.right, current));
      if (typeof right !== "number") return right;
      if (node.op === "/" && right === 0) return error("#DIV/0!");
      const value =
        node.op === "+"
          ? left + right
          : node.op === "-"
            ? left - right
            : node.op === "*"
              ? left * right
              : left / right;
      return Number.isFinite(value)
        ? { type: "number", value }
        : error("#NUM!");
    }
    const numbers = [];
    for (const arg of node.args) {
      let args = [];
      if (arg.kind === "range") {
        const r = parseRange(arg.ref);
        if ((r.bottom - r.top + 1) * (r.right - r.left + 1) > 2000000)
          throw new Error("Range exceeds assessment bound");
        for (let row = r.top; row <= r.bottom; row++)
          for (let col = r.left; col <= r.right; col++)
            args.push(
              cell(analysis.sheetID(arg.sheet, current), address(row, col)),
            );
      } else args = [calculate(arg, current)];
      for (const v of args) {
        if (v.type === "error") return v;
        if (["number", "date"].includes(v.type)) numbers.push(v.value);
        else if (
          arg.kind !== "ref" &&
          arg.kind !== "range" &&
          v.type !== "blank"
        ) {
          const n = numeric(v);
          if (typeof n !== "number") return n;
          numbers.push(n);
        }
      }
    }
    let value;
    if (node.name === "SUM" || node.name === "AVERAGE") {
      value = numbers.reduce((sum, n) => sum + n, 0);
      if (node.name === "AVERAGE") {
        if (!numbers.length) return error("#DIV/0!");
        value /= numbers.length;
      }
    } else if (node.name === "MIN")
      value = numbers.length ? numbers.reduce((a, b) => Math.min(a, b)) : 0;
    else if (node.name === "MAX")
      value = numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : 0;
    else throw new Error("Function outside assessment scope");
    return Number.isFinite(value) ? { type: "number", value } : error("#NUM!");
  }
  for (const key of analysis.eligible) {
    const e = analysis.formulas.get(key);
    cell(e.sheetId, e.ref);
  }
  return values;
}
