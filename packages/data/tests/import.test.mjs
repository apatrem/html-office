import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { convertWorkbook } from "../bench/storage/import.mjs";
import { validateWorkbook } from "../model/workbook.mjs";
test("XLSX conversion retains formulas, cached typed errors, leading zeros and date serials", () => {
  const wb = XLSX.utils.book_new();
  const s = {
    A1: { t: "s", v: "0012" },
    A2: { t: "n", v: 1 / 3 },
    A3: { t: "b", v: true },
    A4: { t: "e", v: 0 },
    A5: { t: "n", v: 0, z: "yyyy-mm-dd" },
    B1: { t: "n", f: "A2*3", v: 1 },
    "!ref": "A1:B5",
  };
  XLSX.utils.book_append_sheet(wb, s, "Inputs");
  wb.Workbook = { WBProps: { date1904: true } };
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    result = convertWorkbook(bytes, { id: "test" });
  validateWorkbook(result.book);
  const cells = result.book.sheets[0].cells;
  assert.deepEqual(cells.A1.input, { type: "text", value: "0012" });
  assert.equal(cells.A2.input.value, 1 / 3);
  assert.deepEqual(cells.A3.input, { type: "boolean", value: true });
  assert.deepEqual(cells.A4.input, { type: "error", value: "#NULL!" });
  assert.deepEqual(cells.A5.input, { type: "date", value: 1462 });
  assert.equal(cells.B1.formula, "=A2*3");
  assert.equal(cells.B1.result.value, 1);
  assert.equal(result.diagnostics.find((d) => d.kind === "date1904").count, 1);
});
test("source row limits are explicit and unsupported source features are counted", () => {
  const wb = XLSX.utils.book_new();
  const s = XLSX.utils.aoa_to_sheet([["Header"], [1], [2], [3]]);
  s.A2.l = { Target: "https://example.com" };
  s["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, s, "Raw");
  const r = convertWorkbook(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    { id: "test", rowLimit: 2 },
  );
  assert.equal(r.book.sheets[0].cells.A3, undefined);
  assert.ok(r.diagnostics.some((d) => d.kind === "rowLimit"));
  assert.ok(r.diagnostics.some((d) => d.kind === "mergedCells"));
});
