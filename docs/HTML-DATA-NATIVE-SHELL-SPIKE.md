# R06 — Data editor shell on shared native components: spike report

22 October 2026. The user asked for this spike after choosing variant A of the shell mock-ups (U03). It answers two questions:
- Can shared, framework-free components replace the IronCalc toolbar on Preact (R05) in Data?
- Is building what Data still lacks easy?

Assessment tooling only: production Data sources, defaults and gates are unchanged. Tools, samples and receipts are in [`tools/shell-spike/`](../tools/shell-spike/README.md). This spike feeds the U03 question "which components come from the IronCalc fork and which are shared native code" in the [cross-product plan](HTML-OFFICE-CROSS-PLAN.md).

## What works in the sample, and what does not yet

The spike reuses R05's seam to the Data runtime. **Only commands the current Data model supports change the workbook.** Formatting from ADR-012 has no model yet (F01r), no rendering (F02) and no command (F03), so those controls **record an intent and have no visible effect**. A yellow notice under the toolbar says so on screen.

| Applied to the workbook (canonical, undoable, saved) | Recorded only (no visible effect yet) |
| --- | --- |
| Undo and redo<br>Number formats: currency, percent, decimals, the format menu<br>Cell styles normal, title, header, row label, assumption, calculation, output, total, note and hyperlink<br>Clear formatting<br>Every former ribbon command: paste table, fill, rows, columns, sheets, dropdowns, conditional formatting, recalculation, save<br>Scenario selector, grid lines (presentation only) | Bold, italic, alignment, centre across selection, wrap<br>Text and fill colours, borders<br>The `alert` cell style<br>Links<br>Theme, font, regional settings<br>Copy style, column width, PNG |

Two caveats:
- The long-date, thousands, millions and negative-number presets are **written to the model** (`dateStyle`, `scale`, `negative`). Today's renderer does not yet show them differently; that arrives with F02.
- Cell styles beyond the five that Data renders today (normal, header, row label, assumption, calculation) are stored but not yet drawn.

## Result

**The components are small and easy to build; the finished look still needs U04.** Built in this spike:
- the menu bar, ARIA menus with type-ahead, and the menu button;
- the toolbar, with roving focus and overflow arrows;
- anchored popovers;
- the ADR-012 colour swatches and border picker;
- the side panel, which becomes a bottom sheet when narrow;
- the link dialog;
- the cell-style, regional and document-settings panels.

They run against the real Data runtime. R05's functional browser flow passes, adapted to ADR-012, on the standard and offline samples and in the same three engine-failure modes.

The sample is still **far from the variant A mock-up**: see [Gap to variant A](#gap-to-variant-a).

Recommendation, for the user's U03 decision: **build the shared shell natively and drop the Preact fork.** The same components can serve Slides and Text, and nothing in Data needed a framework.

## Sizes

Raw minified bytes. Gzip uses R05's method: JS and CSS compressed separately at level 9.

| Build | JS | CSS | Total | gzip | Runtime packages |
| --- | ---: | ---: | ---: | ---: | --- |
| R05: IronCalc toolbar, drawer and link dialog on Preact (untrimmed) | 156,117 | 43,564 | 199,681 | 50,670 | preact, react-colorful |
| **R06: native shell (variant A) for Data** | **32,792** | **14,024** | **46,816** | **15,072** | **none** |

The two builds do not cover the same ground. R05 was measured **before** ADR-012 trimmed the toolbar: it still includes the font-size, underline and strike controls, IronCalc's theme menu and editor, the custom-style editor and react-colorful. Trimming would shrink it, but it would still carry Preact (24,212) and IronCalc's components.

What the native JS contains:
- **Shared components: about 21 kB.**
  - icons 4,127
  - panels 3,982
  - dialogs 2,771
  - menus 2,400
  - pickers 2,114
  - DOM helpers and roving focus 1,936
  - drawer 1,440
  - popover 1,269
  - toolbar 882
- **Data adapter: 11,830.**
- **CSS: 14,024.**

**Complete standard P&L sample: 419,021 bytes** of application code, against a baseline of 370,560 for today's main with the native ribbon (+48,461). The baseline has grown since R05 (349,618) because F01 merged. On today's baseline the R05 toolbar would come to about 580,000. **Headroom under the 750,000 ceiling: about 331,000 bytes native, against about 170,000 with Preact.** The offline sample is 1,375,269.

Size of the source, as a measure of effort:
- shared components: 926 lines, of which 157 are CSS;
- Data adapter: 345 lines.

## Behaviour and performance

- Chromium 151.0.7922.34. Standard and offline samples.
- Checked in every run:
  - viewing makes no network request, and offline files make none at all;
  - exclusions: no merge, custom number format, font size, underline or strike-through control;
  - menu bar keyboard: Down opens, Left/Right switch menus, Escape closes and returns focus to the menu bar;
  - number-format menu button by keyboard, with focus returned to the trigger;
  - exactly one tab stop in the toolbar;
  - percent format with undo and redo through the canonical history;
  - the long-date, thousands and negative-in-parentheses presets are written to the model and found in the saved file;
  - more decimal places;
  - recorded intents for bold, centre across selection, colours (6 text and 7 fill tokens, chosen by keyboard) and borders (style, colour, side);
  - cell styles from the menu and from the drawer: 11 styles, catalogue styles applied canonically, `alert` recorded;
  - focus moves into the drawer and back to its toggle, and an open styles panel follows selection, undo and clear;
  - document settings opened from the sheet bar, then regional settings, with focus returning to the original trigger after the switch;
  - regional preview through `Intl`, for example fr-FR `1 234,50`;
  - link dialog:
    - rejects `file:`, `javascript:` and bare addresses, with `aria-invalid` and a message;
    - accepts `https:` and a workbook place;
    - Cancel works after invalid input;
    - Cmd/Ctrl+K opens it and closes an open menu first;
    - Escape reaches the dialog;
    - focus returns to the link button;
  - clear formatting resets both canonical and recorded formatting across the whole selected range;
  - the on-screen notice is present;
  - our conditional-format dialog;
  - grid lines from both the toolbar and the View menu;
  - Manage sheets from the Data menu;
  - scenario recalculation, Save a copy, and reopen with an empty shell that mounts fresh. The saved cell keeps its canonical style and has no direct `style`.
- Engine failures (blocked engine, corrupted engine JavaScript, cancellation), in each case:
  - the shell is disabled while busy;
  - the attempted input is retained;
  - engine-free formatting still applies to it;
  - Save a copy writes an uncalculated draft;
  - retry calculates.
- No page overflow at 320, 768, 1024 or 1440 px. End reaches the last toolbar item and scrolls it into view at every width. At 320 px the menus collapse into ☰ and the drawer becomes a full-width bottom sheet.
- Over 5 fresh contexts: mount 4.8–5.0 ms, first menu open 7.0–8.6 ms. R05 measured 3.9–5.9 ms to mount and 14.1–27.5 ms for the first menu. The runs were on different days, so treat this as indicative.

Screenshots are in [`tools/shell-spike/results/screenshots/`](../tools/shell-spike/results/screenshots/).

## Gap to variant A

The spike proves the components, not the finished look. Side-by-side screenshots in the same states (Calculations sheet, cell C4, same panel and viewport) are in [`tools/shell-spike/results/variant-a/`](../tools/shell-spike/results/variant-a/index.html), with the measurements in `measurements.json`. `node tools/shell-spike/compare.mjs` regenerates them; the targets are copies of the U02 variant A screenshots.

| Viewport | Grid rows, mock-up (header included) | Grid rows, spike |
| --- | ---: | ---: |
| 1440 × 900 | 32, no page scroll | 17, page scrolls |
| 375 × 812 | 28, no page scroll | 8, page scrolls |

| Area | Variant A mock-up | Spike today | Work in U04-Data |
| --- | --- | --- | --- |
| File bar, menus, toolbar | As drawn | Matches, plus the spike's notice row | Keep; no notice once every control works |
| Side panels | Overlay on the right, bottom sheet when narrow | Matches | Keep |
| Formatting buttons | Bold, alignment, borders, colours change the cells | Recorded only, no visible effect | Ship each with its command (F02/F03); no inert button |
| Page frame | Full-window application | Page card with margins and grey background from today's Data page | Full-window layout; remove the legacy page CSS (finding 1) |
| Formula bar | One 36 px row: name box, fx, value, scenario, calculation state | Labelled form (cell address, input type, value, Apply edit, Cancel calculation), a "Sheet / Scenario" row and two status lines, about 150 px | One row. Enter applies. Cancel and retry move into the calculation-state chip. Status goes to the file bar. Explicit input type moves to the name-box menu (to decide) |
| Grid | Light grey headers, 23 px rows, blue active cell, highlighted row and column headers, charte cell styles | Dark headers, 28 px rows, orange active outline, bold calculation style from the old role CSS | Restyle with F02 (ADR-012 rendering) |
| Keyboard hint line | In Help | Under the grid | Move to Help |
| Sheet tabs | One 36 px bar: group labels, tabs, add and sheet menu, settings button; a sheet select when narrow | Boxed group cards with ↑/↓ buttons, wrapping onto two rows when narrow (about 300 px at 375) | One bar; group ordering moves to the sheet menu and Manage sheets |
| Embedded guide and notices | Reached from File and Help | Also shown below the application | Keep embedded (ADR-011 §9), open from Help |

## Findings for U03 and U04

1. **Data's page CSS leaks into any shell.** Data styles bare `header`, `button`, `dialog label` and `h2` globally. In this spike the drawer header turned dark and the link dialog's radio labels stacked until the shell scoped itself. In production, the legacy page CSS should move under the old ribbon or be removed, and the shell should keep its scoped reset.
2. **Labels must stay accessible when collapsed.** Hiding a button's visible text at narrow widths with `display:none` removed its accessible name. The shell now hides it visually only, and a test checks the name at every width.
3. **Overlay order matters.** A shortcut that opens a dialog must first close any open popover, otherwise the popover's Escape handler swallows the dialog's Escape. A panel opened from inside another panel must keep the first trigger for focus return. Both are now handled and tested.
4. **Not in this spike:**
   - the variant A formula bar, sheet bar and grid styling (see the gap);
   - row and column header context menus;
   - submenus: menus use flat sections instead;
   - drawer resizing;
   - Safari and Firefox runs;
   - a screen-reader pass with VoiceOver or NVDA: the checks use accessibility roles and names only.
5. **Same seam as R05.** The shell needs a deliberate command/state API instead of the assessment bridge.
6. **Sharing.** The components know nothing about Data. Moving the Slides editor (`src/engine/view.js`) onto them is a U04 step and has not been measured here.

## Trade-offs against keeping the Preact fork

| | Native shared shell | IronCalc on Preact (R05) |
| --- | --- | --- |
| Size in Data | 47 kB, no dependency | 200 kB untrimmed, Preact plus react-colorful (which ADR-012 removes) |
| One component set for all three products | Yes | Only by adding Preact to Slides and Text, or keeping two implementations |
| ADR-012 vocabulary | Built in: swatches, three border styles, fixed catalogue | Upstream components needing more patches |
| Upstream maintenance | None | Pinned fork with exact-anchor patches that fail on drift |
| What we must own | Keyboard, focus and ARIA behaviour of about 930 lines, plus tests | IronCalc's tested components, minus our patches |
| Remaining Data headroom | About 331 kB | About 170 kB |
