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

// Functions whose result changes with the clock or at random: a fingerprint
// of inputs and formulas cannot tell that a saved result has aged.
const VOLATILE = /\b(TODAY|NOW|RANDBETWEEN|RANDARRAY|RAND)\s*\(/gi;
export function volatileFunctions(book) {
  const found = new Set();
  for (const sheet of book.sheets)
    for (const cell of Object.values(sheet.cells))
      if (cell.formula)
        for (const m of cell.formula
          .replace(/"(?:[^"]|"")*"/g, '""')
          .matchAll(VOLATILE))
          found.add(m[1].toUpperCase());
  return [...found].sort();
}
// A note for results that are current but were calculated on an earlier day
// than `now`, when the workbook uses volatile functions; otherwise null. The
// saved file stays deterministic: only the editor says it.
export function volatileNotice(book, now = new Date()) {
  const when = Date.parse(book.snapshot?.calculatedAt);
  if (
    !Number.isFinite(when) ||
    new Date(when).toDateString() === now.toDateString()
  )
    return null;
  const names = volatileFunctions(book).map((f) => `${f}()`);
  if (!names.length) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Saved results are current, but ${list} show${names.length === 1 ? "s" : ""} the value calculated on ${new Date(when).toLocaleDateString(book.locale, { dateStyle: "medium" })}. Recalculate to refresh ${names.length === 1 ? "it" : "them"}.`;
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
