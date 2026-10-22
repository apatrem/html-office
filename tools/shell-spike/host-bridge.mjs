// Appended inside the assessment-only app bundle; production sources are untouched.
// Same seam as R05 (tools/ribbon-assessment/preact/host-bridge.mjs) plus cell styles.
function assessmentNotify() {
  document.dispatchEvent(new Event("assessment-state"));
}
globalThis.HTMLDataToolbarBridge = {
  state() {
    const sheet = book.sheets.find((s) => s.id === sheetId);
    const cell = sheet.cells[selected] ?? {};
    return {
      sheetId,
      address: selected,
      sheetName: sheet.name,
      sheetNames: book.sheets.map((s) => s.name),
      title: book.title,
      locale: book.locale,
      displayText:
        document.querySelector(`#grid [data-cell="${selected}"]`)
          ?.textContent ?? "",
      format: cell.format ?? { kind: "general" },
      cellStyle: cell.cellStyle ?? "normal",
      canEdit: !loading,
      canUndo: history.canUndo && !loading,
      canRedo: history.canRedo && !loading,
    };
  },
  format(format) {
    formatSelection((cell) => ({ ...cell, format }));
  },
  cellStyle(name) {
    formatSelection((cell) => ({ ...cell, cellStyle: name }));
  },
  // Clears cell style, number format and direct formatting; keeps values.
  clear() {
    formatSelection(({ style, ...cell }) => ({
      ...cell,
      cellStyle: "normal",
      format: { kind: "general" },
    }));
  },
  command(id) {
    document.getElementById(id).click();
  },
};
