# R05 — IronCalc toolbar on Preact: spike report

21 October 2026. Spike requested by the user after the [ADR-010](decisions/010-manual-formatting-and-ironcalc-toolbar.md) design review. Assessment tooling only: production Data sources, defaults and gates are unchanged. Tools, samples and receipts are in [`tools/ribbon-assessment/preact/`](../tools/ribbon-assessment/preact/README.md).

## Result

**Preact works and fits.** The pinned IronCalc toolbar plus the cell-style, theme and regional-settings panels and the link dialog build unmodified on `preact/compat` 11.0.1. Only ADR-010's own patches were applied. All functional browser checks pass identically on the Preact and React builds, and the two toolbars render pixel-identically. No React-19 or `preact/compat` incompatibility was observed in the tested flows.

Recommendation: adopt Preact for F04. No fallback to a framework-free port is needed.

## Sizes

Raw minified bytes. "Toolbar" means the same component set in every row: toolbar, right drawer (cell styles with editor, themes with editor, regional settings), link dialog, plus our mount and adapter.

| Build | JS | CSS | Total | gzip | Runtime packages |
| --- | ---: | ---: | ---: | ---: | --- |
| React + i18next + lucide-react (upstream stack) | 431,487 | 43,564 | **475,051** | 133,404 | react, react-dom, scheduler, i18next, react-i18next, html-parse-stringify, lucide-react, react-colorful, use-sync-external-store |
| React + our dictionary and static icons | 365,427 | 43,564 | 408,991 | 111,855 | react, react-dom, scheduler, react-colorful |
| **Preact + our dictionary and static icons** | 156,117 | 43,564 | **199,681** | **50,670** | **preact, react-colorful** |

Breakdown of the Preact JS: IronCalc components 87,088 (the right drawer alone is 30,353), Preact 24,212, built-in themes and cell styles (static data) 14,067, react-colorful 9,266, static icons 7,301, dictionary 6,757 (156 of 403 keys), mount and adapter about 7,300.

**Complete standard P&L sample: 558,873 bytes** of application code. The current editor is 349,618, and the ceiling is 750,000, so **191,127 bytes remain**. That remainder must cover F01–F06 (model and rendering, estimated at 40–60 kB) and T15–T22. The same sample on React would be 834,251 bytes, over the ceiling. The offline sample is 1,515,132 bytes.

Possible reductions, not done in the spike:
- the old ribbon markup still present as a fallback (removed in F04);
- unused upstream CSS;
- trimming default fields from the static built-in styles;
- replacing react-colorful's advanced picker with `<input type="color">`, which would drop one dependency.

## Behaviour and performance

- Chromium 151.0.7922.34. Standard and offline samples for both frameworks, 4 runs of the full flow.
- Checked in every run:
  - viewing makes no network request; offline files make no request at all;
  - no merge control, no custom number format (in the toolbar and in the style editor);
  - keyboard menu with focus returned to the trigger;
  - percent formatting with undo and redo through the canonical history;
  - long date, bold, centre across selection, font size, colour picker, border picker;
  - theme menu (charte first, IronCalc built-ins after) and theme drawer;
  - apply a built-in cell style and create a custom one;
  - regional settings;
  - links that reject `file:` and accept `https:`;
  - our conditional-format dialog, grid-line toggle;
  - scenario recalculation, save, and reopen with an empty toolbar shell;
  - no untranslated key in any rendered panel.
- No page overflow at 320, 768, 1024 or 1440 px; the overflow arrows work from the keyboard at 320 px.
- Mount time, 5 fresh contexts each: Preact 3.9–5.9 ms, React 8.5–8.9 ms. First menu open: Preact 14.1–27.5 ms, React 26.5–29.6 ms.
- P&L (offline, five assumption edits after warm-up): warm maximum 50.2 ms for baseline, 50.8 ms for Preact and 50.7 ms for React. No main-thread long task. The saved total matches the independent expectation.
- Existing Data unit tests: 116/116 pass.

## Findings for F01–F06

1. **Stacking:** toolbar menus opened underneath the grid (`isolation: isolate`) until the toolbar was given its own stacking level. The production file bar and toolbar need this explicitly.
2. **Font:** IronCalc expects the Inter web font. Without it, menus fell back to a serif font. Mapping `--typography-font-family` to the charte font fixes it with no embedded font, consistent with ADR-010.
3. **Accessibility:** the style-name field (patched here) and every link-dialog field rely on placeholders only. F04/F05 must add labels.
4. **Built-in styles:** upstream "Accent 1–6" styles have no font colour, so their text is barely readable on dark accents. Built-in styles also name Inter. F05's translation to our catalogue should use the charte font and set a light font colour on dark accents.
5. **Data from WASM:** themes, built-in styles and locales come from the engine upstream. Here they are extracted once from the pinned source (`extract.mjs`, needs Rust) into static JSON with the source hash. Time zones come from `Intl.supportedValuesOf`. Before the time zone becomes a document field, its list must be checked against the engine's.
6. **Regional "language":** the panel only shows locale and time zone. The hidden language value is IronCalc's formula language, which stays English per ADR-003.
7. **Integration seam:** as in R04, the host is reached through an assessment-only bridge appended to the app bundle. Features without a model yet (emphasis, colours, borders, alignment, cell styles, themes, regional settings, links, painter, PNG) are recorded as intents, not applied. F04 replaces this with a deliberate command/state API.

## Patches

Exact-anchor patches against `297553dc3a37ec6b0f4821055220e3d26c4ac6a1`; the build fails if upstream drifts.

| File | Change |
| --- | --- |
| `Toolbar/Toolbar.tsx` | Remove the merge menu; add "Center across selection"; R04's keyboard overflow, resize and format-label fixes |
| `FormatMenu/FormatMenu.tsx` | Remove "Custom" and its picker |
| `RightDrawer/NamedStyles/EditNamedStyle.tsx` | Remove the custom format option; label the name field |
| `RightDrawer/RightDrawer.tsx` | Stub the upstream conditional-format and named-range panels (not shipped) |
| `LinkDialog/util.ts` | Allow only `http:`, `https:` and `mailto:` |
| `Menu/Menu.tsx` | Block disabled menu triggers (R04) |

Licences: IronCalc MIT, Preact MIT, react-colorful MIT, and Lucide ISC for the static icons. Full texts are embedded in the samples (6,671 bytes).
