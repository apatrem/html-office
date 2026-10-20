export function captureCells(book, refs) {
  const seen = new Set();
  return refs
    .filter(({ sheetId, ref }) => {
      const key = `${sheetId}:${ref}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ sheetId, ref }) => ({
      sheetId,
      ref,
      cell: structuredClone(
        book.sheets.find((s) => s.id === sheetId).cells[ref] ?? null,
      ),
    }));
}
export class EditHistory {
  past = [];
  future = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past.length = 0;
    this.future.length = 0;
  }
  record(entry) {
    this.past.push(structuredClone(entry));
    this.future.length = 0;
  }
  move(book, redo) {
    const from = redo ? this.future : this.past,
      to = redo ? this.past : this.future;
    const entry = from.pop();
    if (!entry) return null;
    const edits = redo ? entry.after : entry.before;
    for (const { sheetId, ref, cell } of edits) {
      const cells = book.sheets.find((s) => s.id === sheetId).cells;
      if (cell === null) delete cells[ref];
      else cells[ref] = structuredClone(cell);
    }
    const snapshot = redo ? entry.snapshotAfter : entry.snapshotBefore;
    if (snapshot === undefined) delete book.snapshot;
    else book.snapshot = structuredClone(snapshot);
    to.push(entry);
    return {
      edits,
      selection: structuredClone(
        redo ? entry.selectionAfter : entry.selectionBefore,
      ),
      calculate: !!entry.calculate,
    };
  }
  undo(book) {
    return this.move(book, false);
  }
  redo(book) {
    return this.move(book, true);
  }
}
