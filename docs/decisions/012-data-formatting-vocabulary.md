# ADR-012 — Closed formatting vocabulary for html-data

Status: accepted by the user in design session S01, 22 October 2026. It supersedes the formatting, cell-style, theme and toolbar-content parts of [ADR-010](010-manual-formatting-and-ironcalc-toolbar.md). ADR-010's layering, sheet-level links, exclusions (no merges, no custom number formats), number-format presets, PNG export and regional settings remain in force. The interface layout stays under the cross-product shell design ([ADR-011](011-html-office-shared-principles.md) §7).

## Principle

Data uses a **closed vocabulary aligned with html-slides**: only named charte tokens, never literal colours, fonts or sizes. Semantic cell styles carry the conventions; direct formatting handles exceptions within the same vocabulary. One vocabulary serves the editor, LLM edits, the checker, theme changes and cross-product copy/paste.

## Decisions

1. **Font size:** one size for every cell, including titles and headers, set by the charte (`--data-font-size`, default 13 px). There is no size control and no `fs-*` class in Data.
2. **Colours:** the html-slides tokens, with no tints.
   - Text colour: `ink`, `acc`, `mid`, `alert`, `t2`, `bg`.
   - Fill: `none`, `tint`, `lig`, `mid`, `acc`, `alert`, `dark`.
   - Dark fills (`mid`, `acc`, `alert`, `dark`) switch text to white unless a text colour is given.
   - Data-specific colours (assumptions, calculations…) come only through cell styles and their charte tokens.
3. **Emphasis:** `bold` and `italic` only. Underline appears automatically on linked cells (the `hyperlink` style) but is never stored as formatting. Strike-through is not supported.
4. **Document font:** per-document `font`, chosen from fonts present on both Windows and macOS. In Data it applies to the whole grid.

   | Value | Stack |
   | --- | --- |
   | `arial` (default) | Arial, Helvetica, sans-serif |
   | `verdana` | Verdana, Geneva, sans-serif |
   | `tahoma` | Tahoma, Verdana, sans-serif |
   | `trebuchet` | "Trebuchet MS", Helvetica, sans-serif |
   | `georgia` | Georgia, "Times New Roman", serif |
   | `times` | "Times New Roman", Times, serif |

   Absent means the charte font. No font is embedded. There is no per-cell font.
5. **Borders:** four sides with styles `none` (suppresses an inherited side), `thin`, `medium` and `double`, coloured with a text-colour token (`ink` by default). On a shared edge the heavier line wins. Dotted and dashed styles are not supported.
6. **Alignment:**
   - horizontal `general` (default), `left`, `center`, `right` or `centerContinuous`, plus `wrap` and overflow of unwrapped text into empty neighbours;
   - no vertical alignment: text sits at the bottom, as Excel's default.
7. **Dimensions:**
   - Column widths can be set by mouse, keyboard or auto-fit, and are stored in pixels.
   - Row heights are automatic only: standard, or grown by wrapped cells when a command runs. The computed height is stored as `rows.N.height` so files open without re-measuring and LLMs see the geometry.
   - There is no manual row height and no `customHeight`.
8. **Cell styles:** a fixed catalogue of 11 styles defined by charte tokens. There are **no custom styles** and no `namedStyles`.

   | Style | Purpose | Default rendering |
   | --- | --- | --- |
   | `normal` | default | — |
   | `title` | sheet or block title | bold, `acc` |
   | `header` | column header | bold, white on `dark` |
   | `rowHeader` | row label | `acc` on a light `lig` fill |
   | `assumption` | input (Excel "Input") | `--assumption-*` tokens |
   | `calculation` | calculation | `--calculation-bg` |
   | `output` | key result | bold, `thin` border |
   | `total` | total row | bold, `thin` top and `double` bottom borders |
   | `note` | comment or source | italic, `t2` |
   | `alert` | value to watch | bold, `alert` |
   | `hyperlink` | applied automatically to linked cells | `acc`, underlined |

9. **Themes:**
   - A theme picker offers four built-in chartes: **blue** (default), **red**, **green** and **black** (greyscale, with one alert colour for negatives). It also offers "Document charte" when the file was created with an organisation charte.
   - Built-in chartes are part of the embedded code, so switching needs no network.
   - The document's own `style#charte` is never rewritten. Workbook `theme` (`blue` | `red` | `green` | `black`, absent for the document charte) selects the overlay.
   - Switching is undoable and never changes values or calculations. There is no colour editor in the document; organisation chartes are created by the skill.
   - The picker lives in document settings, placed by the shell design.
   - The 12 Excel theme slots added to the charte by ADR-010 are removed.
10. **Conditional formatting** ([ADR-008](008-conditional-format-rules.md)) uses the same tokens. Highlights use `style: { fill?, color?, bold?, italic? }`. Data bars use `positive` and `negative` tokens, `acc` and `alert` by default.
11. **IronCalc toolbar content:**
    - Removed: font-size group, underline, strike, theme menu and drawer, vertical alignment, custom-style editor.
    - The IronCalc colour picker is replaced by a small keyboard-accessible swatch component. This removes the react-colorful dependency.
    - The border picker is patched to the three styles and charte colours.
    - The cell-style panel applies the fixed catalogue.
12. **Excel import (T15):** formatting maps to the nearest vocabulary item and import never fails on formatting. A diagnostic report lists losses and is shown and stored with the import metadata.
    - Colours map to the nearest token in the workbook's charte (CIE ΔE); near-white fills become `none`.
    - Fonts, sizes, underline, strike, vertical alignment, rotation and indent are ignored and counted.
    - Dotted and dashed borders become `thin`, thick becomes `medium`, and diagonals are dropped.
    - Named styles map by name (Input → `assumption`, Calculation → `calculation`, Total → `total`, Title and Heading 1 → `title`, Note → `note`, Hyperlink → `hyperlink`); others dissolve into mapped direct formatting.
    - The Excel theme is ignored.

## Resulting schema

```json
"style": {
  "bold": true, "italic": false,
  "color": "acc", "fill": "tint",
  "border": { "bottom": { "style": "double", "color": "ink" } },
  "align": { "horizontal": "right", "wrap": true }
}
```

- Sheets carry `rows.N = { style?, height? }` and `columns.X = { style?, width? }`.
- The workbook carries `font?` and `theme?`.
- `background` is renamed `fill`.
- Removed from F01: `underline`, `strike`, `fontSize`, `fontFamily`, `align.vertical`, hex and `{theme, tint}` colours, `customHeight`, `namedStyles`, and dotted or dashed border styles.

The project is pre-release, so there is no migration; fixtures and tests are rewritten (task F01r).

## Consequences

Rendering (F02), commands (F03), panels (F05) and import (T15) shrink: fixed row height except wrap, no colour maths, a smaller toolbar and one fewer dependency. Slides and Text adopt the same `font` and `theme` fields (ADR-011). This is not Excel formatting parity, by design.
