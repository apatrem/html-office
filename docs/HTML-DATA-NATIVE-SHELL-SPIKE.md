# R06 — Data editor shell on shared native components: spike report

22 October 2026. Spike requested by the user after choosing variant A of the shell mock-ups (U03): can shared, framework-free components replace the IronCalc toolbar on Preact (R05) in Data, and is building what Data still lacks easy? Assessment tooling only: production Data sources, defaults and gates are unchanged. Tools, samples and receipts are in [`tools/shell-spike/`](../tools/shell-spike/README.md). It feeds the U03 question "which components come from the IronCalc fork and which are shared native code" in the [cross-product plan](HTML-OFFICE-CROSS-PLAN.md).

## Result

**Yes, and it is small.** The variant A shell for Data was built in this spike from shared native components:
- menu bar, ARIA menus with type-ahead, and the menu button;
- toolbar with roving focus and overflow arrows;
- anchored popovers;
- the ADR-012 colour swatches and border picker;
- the side drawer, which becomes a bottom sheet when narrow;
- the link dialog;
- the cell-style, regional-settings and document-settings panels.

It runs against the real Data runtime through the same seam as R05. R05's functional browser flow passes on it, adapted to ADR-012, standard and offline, with the same three engine-failure modes.

Recommendation, for the user's U03 decision: **build the shared shell natively and drop the Preact fork.** The same components can serve Slides and Text. Nothing in Data needed a framework.

## Sizes

Raw minified bytes.

| Build | JS | CSS | Total | gzip | Runtime packages |
| --- | ---: | ---: | ---: | ---: | --- |
| R05: IronCalc toolbar, drawer and link dialog on Preact | 156,117 | 43,564 | 199,681 | 50,670 | preact, react-colorful |
| **R06: native shell (variant A) for Data** | **31,656** | **13,788** | **45,444** | **14,357** | **none** |

What the native JS contains:
- **Shared components: about 20.8 kB.**
  - icons 4,127
  - panels 3,982
  - dialogs 2,662
  - menus 2,400
  - pickers 2,114
  - DOM helpers and roving focus 1,936
  - drawer 1,388
  - popover 1,269
  - toolbar 882
- **Data adapter: 10,855.** It wires every Data command and holds the formats, menus and state sync.
- **CSS: 13,788.**

**Complete standard P&L sample: 417,611 bytes** of application code, against a baseline of 370,560 for today's main with the native ribbon (+47,051). The baseline has grown since R05 (349,618) because F01 merged. On today's baseline the R05 toolbar would come to about 580,000. **Headroom under the 750,000 ceiling: about 332,000 bytes native, against about 170,000 with Preact.** The offline sample is 1,373,859.

Size of the source, as a measure of effort:
- shared components: 818 lines, of which 153 are CSS;
- Data adapter: 308 lines.

Possible reductions, not done in the spike:
- the old ribbon markup still kept as a fallback, as in R05;
- icons shared with the Slides editor instead of duplicated.

## Behaviour and performance

- Chromium 151.0.7922.34. Standard and offline samples.
- Checked in every run:
  - viewing makes no network request, and offline files make none at all;
  - exclusions: no merge, custom number format, font size, underline or strike-through control;
  - menu bar keyboard: Down opens, Left/Right switch menus, Escape closes and returns focus to the menu bar;
  - number-format menu button by keyboard, with focus returned to the trigger;
  - exactly one tab stop in the toolbar, with arrow keys inside;
  - percent format with undo and redo through the canonical history;
  - long-date preset applied canonically (R05 recorded it as an intent);
  - more decimal places;
  - bold, centre across selection;
  - colour swatches: 6 text tokens and 7 fills, chosen by keyboard, with focus returned;
  - border picker: style, colour and side;
  - cell styles from the menu and from the drawer: 11-style catalogue, catalogue styles applied canonically, `alert` recorded as an intent;
  - focus moves into the drawer on open and back to its toggle on Escape;
  - document settings (theme, font) opened from the sheet bar;
  - regional settings with a live `Intl` preview, for example fr-FR `1 234,50`;
  - link dialog:
    - rejects `file:`, `javascript:` and bare addresses, with `aria-invalid` and a message;
    - accepts `https:` and a workbook place (sheet and cell);
    - opens with Cmd/Ctrl+K and returns focus on close;
  - our conditional-format dialog;
  - grid lines from both the toolbar and the View menu;
  - Manage sheets from the Data menu;
  - scenario recalculation, Save a copy, and reopen with an empty shell that mounts fresh.
- Engine failures (blocked engine, corrupted engine JavaScript, cancellation), in each case:
  - the shell is disabled while busy;
  - the attempted input is retained;
  - engine-free formatting still applies to it;
  - Save a copy writes an uncalculated draft;
  - retry calculates.
- No page overflow at 320, 768, 1024 or 1440 px. End reaches the last toolbar item and scrolls it into view at every width. At 320 px the menus collapse into ☰ and the drawer becomes a full-width bottom sheet.
- Timings over 5 fresh contexts: mount 7.2–8.0 ms, first menu open 2.0–15.9 ms. R05 measured 3.9–5.9 ms to mount Preact and 14.1–27.5 ms for the first menu. The runs were on different days, so treat this as indicative.

Screenshots are in [`tools/shell-spike/results/screenshots/`](../tools/shell-spike/results/screenshots/) (`shell-1440-styles.png`, `shell-menu.png`, `shell-borders.png`, `shell-link.png`, `shell-settings.png`, `shell-320*.png`).

## Findings for U03 and U04

1. **Data's page CSS leaks into any shell.** Data styles bare `header`, `button`, `dialog label` and `h2` globally. The spike's drawer header turned dark and the link dialog's radio labels stacked until the shell scoped itself. In production, the legacy page CSS should move under the old ribbon or be removed, and the shell should keep its scoped reset. IronCalc had the same exposure: R05 finding 1 (stacking).
2. **Labels must stay accessible when collapsed.** Hiding a button's visible text at narrow widths with `display:none` removed its accessible name. The shell now hides it visually only. A test asserts that the name is present at every width.
3. **Not in this spike:**
   - the variant A formula bar and sheet bar: the host's own controls are still shown, restyling is straightforward and the mock-ups give the target;
   - row and column header context menus (ADR-010);
   - submenus: menus use flat sections instead;
   - drawer resizing;
   - Safari and Firefox runs;
   - a screen-reader pass with VoiceOver or NVDA: the checks use accessibility roles and names only.
4. **Same seam as R05.** Formatting without an ADR-012 model is recorded as intents. F01r and F03 must still provide the commands. The shell needs a deliberate command/state API instead of the assessment bridge, as R05 already noted.
5. **Sharing.** The components know nothing about Data. The Slides editor (`src/engine/view.js`) already uses the same patterns, but with its own code. Moving Slides onto this module is a U04 step and has not been measured here.

## Trade-offs against keeping the Preact fork

| | Native shared shell | IronCalc on Preact (R05) |
| --- | --- | --- |
| Size in Data | 45 kB, no dependency | 200 kB, Preact plus react-colorful (which ADR-012 removes) |
| One component set for all three products | Yes | Only by adding Preact to Slides and Text, or keeping two implementations |
| ADR-012 vocabulary | Built in: swatches, three border styles, fixed catalogue | Patched upstream components, more patches to come |
| Upstream maintenance | None | Pinned fork with exact-anchor patches that fail on drift |
| What we must own | Keyboard, focus and ARIA behaviour of about 820 lines, plus tests | IronCalc's tested components, minus our patches |
| Remaining Data headroom | About 332 kB | About 170 kB |
