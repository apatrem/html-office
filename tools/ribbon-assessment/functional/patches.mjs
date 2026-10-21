// Exact pinned-source adaptations; a changed upstream anchor fails the build.
export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("Upstream patch anchor changed: " + before.slice(0, 70));
  return source.replace(before, after);
}
export function patchToolbar(source) {
  for (const [start, end] of [
    ["Font Size Group", "Text Style Group"],
    ["Text Style Group", "Color & Border Group"],
    ["Alignment Group", "Links, checkboxes, dropdowns, etc"],
    ["Links, checkboxes, dropdowns, etc", "View & Tools Group"],
  ]) {
    const a = source.indexOf(`{/* ${start} */}`),
      b = source.indexOf(`{/* ${end} */}`);
    if (a < 0 || b < a) throw new Error("Missing toolbar group");
    source =
      source.slice(0, a) +
      source
        .slice(a, b)
        .replaceAll(
          "disabled={!canEdit}",
          'disabled={true} title="Unsupported in the current HTML Data model"',
        ) +
      source.slice(b);
  }
  const a = source.indexOf("{/* Color & Border Group */}"),
    b = source.indexOf("{/* Alignment Group */}");
  let colors = source
    .slice(a, b)
    .replaceAll(
      "disabled={!canEdit}",
      'disabled={true} title="Unsupported in the current HTML Data model"',
    );
  colors = colors.replace(
    'onClick={properties.onOpenConditionalFormatting}\n              disabled={true} title="Unsupported in the current HTML Data model"',
    "onClick={properties.onOpenConditionalFormatting}\n              disabled={!canEdit}",
  );
  source = source.slice(0, a) + colors + source.slice(b);
  source = replaceOnce(
    source,
    "onClick={properties.onCopyStyles}",
    'disabled={true} title="Unsupported in the current HTML Data model" onClick={properties.onCopyStyles}',
  );
  source = replaceOnce(
    source,
    "onClick={() => properties.onDownloadPNG()}\n              disabled={!canEdit}",
    'onClick={() => properties.onDownloadPNG()}\n              disabled={true} title="PNG export is not implemented"',
  );
  source = replaceOnce(
    source,
    "endIcon={<ChevronDown size={12} />}\n              >",
    'endIcon={<ChevronDown size={12} />}\n                aria-label={t("toolbar.format_number")}\n              >',
  );
  // Fix upstream overflow affordances as part of the measured extraction.
  source = source.replaceAll(
    '<div\n          className="ic-toolbar-scroll-arrow',
    '<button type="button" aria-label="Scroll toolbar"\n          className="ic-toolbar-scroll-arrow',
  );
  for (const icon of ["ChevronLeft", "ChevronRight"])
    source = replaceOnce(
      source,
      `<${icon} />\n          </Tooltip>\n        </div>`,
      `<${icon} />\n          </Tooltip>\n        </button>`,
    );
  source = replaceOnce(
    source,
    'toolbar.addEventListener("scroll", updateArrows);\n    return () => toolbar.removeEventListener("scroll", updateArrows);',
    'toolbar.addEventListener("scroll", updateArrows);\n    const resize = new ResizeObserver(updateArrows); resize.observe(toolbar);\n    return () => { resize.disconnect(); toolbar.removeEventListener("scroll", updateArrows); };',
  );
  return source;
}
export function patchMenu(source) {
  return replaceOnce(
    source,
    "triggerOnClick?.(e);",
    'if ((e.currentTarget as HTMLElement).querySelector("button:disabled")) return;\n      triggerOnClick?.(e);',
  );
}
export function patchFormats(source) {
  source = replaceOnce(
    source,
    "checked={isLongDateFormat}",
    "disabled={true} checked={isLongDateFormat}",
  );
  return replaceOnce(
    source,
    "checked={isCustomFormat}",
    "disabled={true} checked={isCustomFormat}",
  );
}
