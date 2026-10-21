// Appended inside the assessment-only app bundle; production sources are untouched.
function assessmentNotify() {
  document.dispatchEvent(new Event("assessment-state"));
}
globalThis.HTMLDataToolbarBridge = {
  state() {
    const cell =
      book.sheets.find((s) => s.id === sheetId).cells[selected] ?? {};
    return {
      format: cell.format ?? { kind: "general" },
      role: cell.role ?? "normal",
      canEdit: !loading,
      canUndo: history.canUndo && !loading,
      canRedo: history.canRedo && !loading,
    };
  },
  format(format) {
    formatSelection((cell) => ({ ...cell, format }));
  },
  clear() {
    formatSelection((cell) => ({
      ...cell,
      role: "normal",
      format: { kind: "general" },
    }));
  },
  command(id) {
    document.getElementById(id).click();
  },
};
