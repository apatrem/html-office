// Review defects 1 and 3: the pinned engine stops reading a formula after its
// first complete expression and refuses some defined names, both without a
// word. The model refuses them first, with a located message.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formulaProblem, definedNameProblem } from "../model/formula.mjs";
import { validateWorkbook, validateCell } from "../model/workbook.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { loadEngine } from "../tools/engine-node.mjs";

const run = promisify(execFile),
  tool = fileURLToPath(new URL("../tools/workbook.mjs", import.meta.url)),
  examples = fileURLToPath(new URL("../examples/", import.meta.url)),
  num = (value) => ({ input: { type: "number", value } }),
  book = (cells, names = []) => ({
    version: "html-data/0.1",
    id: "b",
    title: "t",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [{ id: "s", name: "Sheet1", cells }],
    groups: [],
    names,
  });

test("formulas the engine would half read are refused with a position", () => {
  // The three the review reproduced: 103 instead of 108, 100 instead of 120
  // and 10 instead of 20000 with no error.
  assert.match(
    formulaProblem("=SUM(A1:A2))+5"),
    /Unexpected "\)" at position 12 of =SUM\(A1:A2\)\)\+5/,
  );
  assert.match(
    formulaProblem("=A1*1,2"),
    /"," at position 6 .*not a decimal point.*1\.2/,
  );
  assert.match(
    formulaProblem("=10 000*2"),
    /Numbers cannot contain spaces.*Write 10000/,
  );
  const cases = {
    "=(A1": /Missing "\)" for the "\(" at position 2/,
    "=SUM(A1:A2": /Missing "\)" for the "\(" at position 5/,
    "=A1)": /Unexpected "\)"/,
    "=A1 A2": /Missing operator before A2 at position 5/,
    "=A1 2": /Missing operator before 2/,
    '="a" "b"': /Missing operator/,
    "=A1;A2": /";" at position 4.*separate function arguments with ","/,
    "=SUM(A1;A2)": /";" at position 8/,
    "=A1,A2": /"," at position 4 .*outside a function/,
    "=SUM(A1,B1))": /Unexpected "\)" at position 12/,
    "=(A1+2}": /"\}" at position 7 .* does not match the "\(" at position 2/,
    '="open': /never closed/,
    "='Sheet 1!A1": /never closed/,
    "=1__2": /Missing operator/,
    "=5%A1": /Missing operator/,
  };
  for (const [formula, expected] of Object.entries(cases))
    assert.match(formulaProblem(formula), expected, formula);
});

test("what the engine reads correctly is never refused", () => {
  const valid = [
    "=SUM(A1:A2)+5",
    "=A1*1.2",
    "=10000*2",
    "=SUM(A1,B1)*(A1+B1)",
    "=SUM (A1)",
    "=SUM(A1,)",
    "=SUM(,)",
    "=NOW()",
    "=LET(x,1,x+1)",
    "=LET(perUnit,LAMBDA(a,u,a/u),ROUND(perUnit(10,4),2))",
    "=LAMBDA(x,x+1)(2)",
    "=@A1",
    "=A1#",
    "=SUM(B2#)",
    "=Sheet2!A1+'Sheet 1'!B$2+'It''s'!$A$1",
    "=SUM(A:A)+SUM(1:2)",
    "=-A1^-2",
    "=1E+3+.5+5.",
    "=A1%+5%",
    "=#REF!",
    "=IFERROR(#N/A,1)",
    "={1,2;3,4}",
    "=SUM({1,2;3,4})",
    '=IF(A1>=2,"a;b)","c,d(")',
    '=A1&" "&B1&"""quoted"""',
    "=A1<>A2",
    "=A1<=A2",
    "=LOG10(100)+ATAN2(1,1)",
    "=SUM(Orders[[#Data],[Amount]])",
    "=Orders[Amount]",
    "=XLOOKUP(A1,B1:B3,C1:C3,\"none\")",
    "=A1+",
    "=1-",
  ];
  for (const formula of valid)
    assert.equal(formulaProblem(formula), null, formula);
});

test("a cell with such a formula is refused by the model, naming the cell", () => {
  assert.throws(
    () => validateCell({ formula: "=SUM(A1:A2))+5" }),
    /Unexpected "\)"/,
  );
  const bad = book({ A1: num(100), B1: { formula: "=A1*1,2" } });
  assert.throws(() => validateWorkbook(bad), /^Error: Sheet1!B1: "," at position 6/);
  assert.doesNotThrow(() =>
    validateWorkbook(book({ A1: num(100), B1: { formula: "=A1*1.2" } })),
  );
});

test("the editor path refuses it before the engine or the book change", async () => {
  const session = new EngineSession(await loadEngine());
  try {
    session.load(book({ A1: num(100), A2: num(3) }));
    for (const formula of ["=SUM(A1:A2))+5", "=A1*1,2", "=10 000*2"]) {
      const before = structuredClone(session.book);
      assert.throws(
        () => session.edit("s", "B1", { formula }),
        /position/,
        formula,
      );
      assert.deepEqual(session.book, before);
    }
    session.edit("s", "B1", { formula: "=SUM(A1:A2)+5" });
    assert.equal(
      (await session.calculateDelta()).results[0].result.value,
      108,
    );
  } finally {
    session.dispose();
  }
});

test("the command line refuses it in new, apply and validate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "html-data-formula-")),
    model = JSON.parse(
      await readFile(join(examples, "valid/budget.json"), "utf8"),
    ),
    cell = Object.values(model.sheets)
      .flatMap((sheet) => Object.entries(sheet.cells ?? {}))
      .find(([, c]) => c.formula)?.[1],
    cli = async (...args) => {
      try {
        const { stdout } = await run(process.execPath, [tool, ...args]);
        return { code: 0, out: stdout };
      } catch (error) {
        return { code: error.code, out: error.stdout + error.stderr };
      }
    };
  assert.ok(cell, "the example has a formula");
  const good = join(dir, "good.html");
  assert.equal(
    (await cli("new", good, "--model", join(examples, "valid/budget.json")))
      .code,
    0,
  );
  // new: a model whose formula has a stray bracket.
  const original = cell.formula;
  cell.formula = original + ")";
  await writeFile(join(dir, "bad.json"), JSON.stringify(model));
  const made = await cli("new", join(dir, "bad.html"), "--model", join(dir, "bad.json"));
  assert.equal(made.code, 1, made.out);
  assert.match(made.out, /Unexpected "\)"/);
  // validate: the saved file was edited by hand after it was written.
  const html = await readFile(good, "utf8"),
    escaped = JSON.stringify(original).slice(1, -1);
  assert.ok(html.includes(escaped), "the formula is stored in the file");
  await writeFile(join(dir, "hand.html"), html.replace(escaped, escaped + ")"));
  const checked = await cli("validate", join(dir, "hand.html"));
  assert.equal(checked.code, 1, checked.out);
  assert.match(checked.out, /Unexpected "\)"/);
});

test("defined names the engine refuses are refused with their name", () => {
  for (const name of [
    "Q1",
    "q1",
    "FY25",
    "H2",
    "TAX2",
    "XFD1",
    "A01",
    "tax-rate",
    "C",
    "r",
    "TRUE",
    "false",
    "R1C1",
    "RC12",
  ])
    assert.match(
      definedNameProblem(name),
      new RegExp(`^Defined name "${name}" `),
      name,
    );
  for (const name of [
    "Tax",
    "Rate",
    "Total",
    "tax_rate",
    "TAX_2",
    "A0",
    "A1048577",
    "XFE1",
    "ABCD1",
    "RC",
    "R1C",
    "x1y",
    "Q1_total",
    "A1B",
  ])
    assert.equal(definedNameProblem(name), null, name);
  for (const name of ["", "_x", "1x", "a b", "é", "a.b", 5])
    assert.notEqual(definedNameProblem(name), null, String(name));
  assert.match(definedNameProblem("tax-rate"), /tax_rate/);
  assert.match(definedNameProblem("Q1"), /cell address \(column Q, row 1\)/);
});

test("the validator and the engine agree on defined names", async () => {
  const module = await loadEngine();
  for (const name of [
    "Q1",
    "FY25",
    "H2",
    "TAX2",
    "tax-rate",
    "C",
    "TRUE",
    "R1C1",
    "Tax",
    "Total",
    "TAX_2",
    "A0",
    "XFE1",
    "RC",
    "R1C",
  ]) {
    const model = book({ A1: num(1) }, [{ name, sheetId: "s", ref: "A1" }]),
      problem = definedNameProblem(name);
    // The model check is bypassed to ask the engine itself.
    const engine = new module.Model("t", "en", "UTC", "en");
    let loaded = true;
    try {
      engine.newDefinedName(name, undefined, "Sheet1!$A$1");
    } catch {
      loaded = false;
    } finally {
      engine.free();
    }
    assert.equal(loaded, problem === null, name);
    if (problem) assert.throws(() => validateWorkbook(model), /Defined name/);
    else assert.doesNotThrow(() => validateWorkbook(model));
  }
});
