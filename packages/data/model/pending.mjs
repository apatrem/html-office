import { applyLinkEdits } from "./formatting.mjs";
import { captureHead } from "./structure.mjs";
export const pendingList = (value) =>
  value ? (Array.isArray(value) ? value : [value]) : [];
export function draftPatches(book, value) {
  return pendingList(value).map((attempt) => {
    if (attempt.cell === null)
      return { sheetId: attempt.sheetId, ref: attempt.ref, cell: null };
    const cell = { ...attempt.cell },
      current = book.sheets.find((s) => s.id === attempt.sheetId).cells[
        attempt.ref
      ];
    if (attempt.preserveFormat !== false && current?.format)
      cell.format = current.format;
    return { sheetId: attempt.sheetId, ref: attempt.ref, cell };
  });
}
export function overlayDraft(book, value) {
  const edits = draftPatches(book, value);
  if (!edits.length) return book;
  const bySheet = new Map();
  for (const edit of edits) {
    if (!bySheet.has(edit.sheetId)) bySheet.set(edit.sheetId, []);
    bySheet.get(edit.sheetId).push(edit);
  }
  const next = {
    ...book,
    sheets: book.sheets.map((sheet) => {
      if (!bySheet.has(sheet.id)) return sheet;
      const cells = { ...sheet.cells };
      for (const edit of bySheet.get(sheet.id)) {
        if (edit.cell === null) delete cells[edit.ref];
        else cells[edit.ref] = edit.cell;
      }
      return applyLinkEdits(
        { ...sheet, cells },
        pendingList(value).filter((a) => a.sheetId === sheet.id),
      );
    }),
  };
  delete next.snapshot;
  return next;
}

// Head of the draft (canonical head plus pending link changes) without
// materializing cells: heads exclude cells, and copying a large sheet here
// would block the UI thread.
export function draftHead(book, value, base) {
  const head = structuredClone(base ?? captureHead(book)),
    linkEdits = pendingList(value).filter((a) => a.link !== undefined);
  if (linkEdits.length)
    head.sheets = head.sheets.map((sheet) =>
      applyLinkEdits(
        sheet,
        linkEdits.filter((edit) => edit.sheetId === sheet.id),
      ),
    );
  return head;
}
