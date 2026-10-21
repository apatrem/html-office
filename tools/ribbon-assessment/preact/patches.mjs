// ADR-010 adaptations of the pinned IronCalc sources. Every anchor must match
// exactly once; upstream drift fails the build instead of silently diverging.
import { replaceOnce } from "../functional/patches.mjs";

function cut(source, startMarker, endMarker, label) {
  const anchor = source.indexOf(startMarker[1]);
  const start = source.lastIndexOf(startMarker[0], anchor),
    end = source.indexOf(endMarker, anchor);
  if (
    anchor < 0 ||
    start < 0 ||
    end < 0 ||
    source.indexOf(startMarker[1], anchor + 1) >= 0
  )
    throw new Error("Upstream patch anchor changed: " + label);
  return source.slice(0, start) + source.slice(end + endMarker.length);
}

export function patchToolbar(source) {
  // V1 has no merged cells: remove the merge menu entirely.
  source = cut(
    source,
    ["<Menu", '<Tooltip title={t("toolbar.merge_cells")}>'],
    "</Menu>",
    "merge menu",
  );
  // Centre across selection (centerContinuous), placed after right alignment.
  source = replaceOnce(
    source,
    '} from "lucide-react";',
    'AlignHorizontalSpaceAround,\n} from "lucide-react";',
  );
  source = replaceOnce(
    source,
    '          <Tooltip title={t("toolbar.vertical_align_top")}>',
    `          <Tooltip title={t("toolbar.align_center_across")}>
            <IconButton
              icon={<AlignHorizontalSpaceAround />}
              aria-label={t("toolbar.align_center_across")}
              pressed={properties.horizontalAlign === "centerContinuous"}
              onClick={() =>
                properties.onToggleHorizontalAlign(
                  properties.horizontalAlign === "centerContinuous"
                    ? "general"
                    : "centerContinuous",
                )
              }
              disabled={!canEdit}
            />
          </Tooltip>
          <Tooltip title={t("toolbar.vertical_align_top")}>`,
  );
  // Accessibility fixes carried over from R04.
  source = replaceOnce(
    source,
    "endIcon={<ChevronDown size={12} />}\n              >",
    'endIcon={<ChevronDown size={12} />}\n                aria-label={t("toolbar.format_number")}\n              >',
  );
  for (const side of ["left", "right"])
    source = replaceOnce(
      source,
      `<div\n          className="ic-toolbar-scroll-arrow ic-toolbar-scroll-arrow--${side}"`,
      `<button type="button" aria-label="Scroll toolbar ${side}"\n          className="ic-toolbar-scroll-arrow ic-toolbar-scroll-arrow--${side}"`,
    );
  for (const icon of ["ChevronLeft", "ChevronRight"])
    source = replaceOnce(
      source,
      `<${icon} />\n          </Tooltip>\n        </div>`,
      `<${icon} />\n          </Tooltip>\n        </button>`,
    );
  return replaceOnce(
    source,
    'toolbar.addEventListener("scroll", updateArrows);\n    return () => toolbar.removeEventListener("scroll", updateArrows);',
    'toolbar.addEventListener("scroll", updateArrows);\n    const resize = new ResizeObserver(updateArrows); resize.observe(toolbar);\n    return () => { resize.disconnect(); toolbar.removeEventListener("scroll", updateArrows); };',
  );
}

export function patchMenu(source) {
  return replaceOnce(
    source,
    "triggerOnClick?.(e);",
    'if ((e.currentTarget as HTMLElement).querySelector("button:disabled")) return;\n      triggerOnClick?.(e);',
  );
}

// V1 has presets only: drop the custom-format entry and its picker dialog.
export function patchFormatMenu(source) {
  source = replaceOnce(
    source,
    'import FormatPicker from "./FormatPicker";',
    "const FormatPicker = (_: Record<string, unknown>) => null;",
  );
  return replaceOnce(
    source,
    `      <MenuDivider />

      <MenuItem checked={isCustomFormat} onClick={onOpenPicker}>
        {t("toolbar.format_menu.custom")}
      </MenuItem>`,
    "",
  );
}

// Cell-style editor: presets only (no custom format codes) and a labelled
// name field (upstream relies on a placeholder alone).
export function patchEditNamedStyle(source) {
  source = replaceOnce(
    source,
    '    { value: CUSTOM_VALUE, label: t("toolbar.format_menu.custom") },\n',
    "",
  );
  return replaceOnce(
    source,
    'placeholder={t("named_styles.name_placeholder")}',
    'placeholder={t("named_styles.name_placeholder")}\n            aria-label={t("named_styles.name_placeholder")}',
  );
}

// Our own conditional-format dialog replaces upstream's panel (ADR-010);
// named ranges are outside this toolbar's scope.
export function patchRightDrawer(source) {
  source = replaceOnce(
    source,
    'import ConditionalFormatting from "./ConditionalFormatting/ConditionalFormatting";',
    "const ConditionalFormatting = (_: Record<string, unknown>) => null;",
  );
  return replaceOnce(
    source,
    'import NamedRanges from "./NamedRanges/NamedRanges";',
    "const NamedRanges = (_: Record<string, unknown>) => null;",
  );
}

// ADR-010 accepts only https, http and mailto targets.
export function patchLinkUtil(source) {
  return replaceOnce(
    source,
    `export const ALLOWED_SCHEMES = [
  "http:",
  "https:",
  "ftp:",
  "ftps:",
  "file:",
  "mailto:",
];`,
    'export const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"];',
  );
}

export const patches = [
  [/\/Toolbar\/Toolbar\.tsx$/, patchToolbar],
  [/\/Menu\/Menu\.tsx$/, patchMenu],
  [/\/FormatMenu\/FormatMenu\.tsx$/, patchFormatMenu],
  [/\/RightDrawer\/RightDrawer\.tsx$/, patchRightDrawer],
  [/\/NamedStyles\/EditNamedStyle\.tsx$/, patchEditNamedStyle],
  [/\/LinkDialog\/util\.ts$/, patchLinkUtil],
];
