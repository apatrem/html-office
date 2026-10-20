export function setupRibbon() {
  const root = document.querySelector(
    '[role="tablist"][aria-label="Workbook ribbon"]',
  );
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  function activate(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden =
        !selected;
    }
    if (focus) tab.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : event.key === "ArrowRight"
              ? (index + 1) % tabs.length
              : event.key === "ArrowLeft"
                ? (index + tabs.length - 1) % tabs.length
                : null;
      if (target === null) return;
      event.preventDefault();
      activate(tabs[target], true);
    });
  }
  let frame;
  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const grid = document.getElementById("grid"),
        sheets = document.getElementById("sheet-tabs"),
        note = document.getElementById("preview-note");
      const top = grid.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(
        240,
        innerHeight - top - sheets.offsetHeight - note.offsetHeight - 32,
      );
      document.documentElement.style.setProperty(
        "--grid-height",
        `${height}px`,
      );
    });
  }
  const observer = new ResizeObserver(scheduleLayout);
  for (const element of document.querySelectorAll(
    "header,.quick-access,.ribbon,.editor-context,.formula-bar,#status,#save-status,#sheet-tabs,#preview-note",
  ))
    observer.observe(element);
  window.addEventListener("resize", scheduleLayout);
  scheduleLayout();
  // Saved copies can capture an inactive Home panel; every reopen starts in Home.
  activate(tabs[0]);
}
