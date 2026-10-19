import { fingerprint } from "./workbook.mjs";
import { ENGINE } from "../engine/identity.mjs";

export async function snapshotState(book) {
  const missing = [];
  let formulas = 0;
  for (const sheet of book.sheets)
    for (const [ref, cell] of Object.entries(sheet.cells))
      if (cell.formula) {
        formulas++;
        if (!cell.result) missing.push({ sheetId: sheet.id, ref });
      }
  if (missing.length) return { state: "missing", missing };
  if (!formulas) return { state: "current", missing };
  if (!book.snapshot) return { state: "missing", missing };
  const current =
    book.snapshot.engine === ENGINE &&
    book.snapshot.fingerprint === (await fingerprint(book));
  return { state: current ? "current" : "stale", missing };
}

// Monotonic tokens prevent old async work (including cancellation/retry) publishing.
export class CalculationRevision {
  revision = 0;
  begin() {
    return ++this.revision;
  }
  cancel() {
    this.revision++;
  }
  current(token) {
    return token === this.revision;
  }
  publish(token, commit) {
    if (!this.current(token)) return false;
    commit();
    return true;
  }
}
