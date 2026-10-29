# Fictional P&L acceptance workbook (T21)

A 24-month P&L for an invented bike rental co-op, built through the html-data skill to prove the authoring and recipient workflow end to end ([plan T21](../../../docs/HTML-DATA-PLAN.md#t21--publish-the-fictional-pl-acceptance-workbook)). Every name, figure and note is fictional; nothing comes from a client, a scratch assessment or a private file.

## What it covers

| Requirement | Where |
| --- | --- |
| 12 actual + 12 forecast months | P&L columns B–M (January–December 2025) read the imported records; N–Y (2026) apply the selected growth and price change |
| Grouped sheets, consulting theme | Summary (Summary, Stations), Inputs (Assumptions), Raw Data (Monthly actuals, Rentals), Calculations (P&L, Cash flow, Formula analysis, Chart data); default charte with `header`, `rowHeader`, `assumption`, `calculation`, `output`, `total`, `note`, `title` and `hyperlink` cell styles |
| Scenarios and dropdowns | Assumptions!B3 is the scenario selector (Base, Low, High, a range source); Formula analysis!B4 picks a station (a list) |
| Number formats | Currency (0 and 2 digits, thousands scale), accounting with parentheses, percent, short dates, integers |
| Conditional rules and data bars | Net income and cumulative cash data bars with negatives; negative margins, forecast columns and falling growth highlighted |
| Pivot table, charts | Stations: rentals by station × plan from the imported records; Summary: monthly line, 24-month waterfall, 2026 by scenario |
| Cash-flow NPV | Free cash flow = net income + depreciation − capex − change in working capital; `NPV(monthly rate, 24 flows) − initial investment` |
| Formula suite | Formula analysis: one row per function of the [V1 formula contract](../../../docs/HTML-OFFICE-V1.md#formula-contract) (all 51 names), on the P&L and on the imported records |
| Import and refresh | `sources/rentals-2025.csv` is imported in the browser; `sources/rentals-2025-v2.csv` (late December registrations, an August correction, a new Harbour station) refreshes it |

## How it is generated

The generated files are not committed. `node packages/data/acceptance/generate.mjs` writes them into `output/` (ignored by git), repeating the whole chain from step 1:

1. `author.mjs` writes the inputs: `model.json` (the canonical workbook an author writes, following [SKILL.md](../../../plugin/skills/html-data/SKILL.md) › Create), the two CSV files, and `patches/link-rentals.json`. `node packages/data/acceptance/author.mjs --check` compares them with the committed copies.
2. The skill is packaged afresh; its `tools/workbook.mjs new --offline` builds the model and `validate` says `Valid.`
3. In Chromium, a person's Data › Import CSV… reads `rentals-2025.csv` into a new Rentals sheet, then File › Save a copy. Imports happen only in the browser; the tools never read CSV files.
4. `inspect` finds the imported sheet's ID; `apply … --refresh-pivots` links Monthly actuals to the records (`SUMIFS`), adds the record rows of the formula analysis and the pivot table; `validate --since` confirms nothing else changed.
5. `extract --charte-out`, then `new --charte` and `new --charte --offline` write the standard and offline files from one canonical JSON and the document's charte; both validate.
6. Chromium exports the P&L as CSV and prints Summary and P&L to PDF (A4, the en-GB default) from the offline file, with every network request refused.

`tests/acceptance-browser.mjs` runs the same chain in CI, checks the generated workbook against the known totals and the CSV and PDF samples, then edits, extends, refreshes, undoes, saves and reopens it. `tests/acceptance.test.mjs` checks the committed inputs; `tests/acceptance-engines.mjs` reads the generated offline file in Chromium, Firefox and WebKit (the clipboard-engines job generates it first).

## Generated files

Measured on 29 October 2026 (sizes vary by a few bytes between runs: calculation and import times are saved in the workbook).

| File | Size |
| --- | --- |
| `output/fictional-bike-rentals.html` (standard: engine and chart library fetched only to edit) | 864,789 bytes |
| `output/fictional-bike-rentals-offline.html` (offline: engine, ECharts and the XLSX reader embedded) | 3,315,740 bytes |
| `output/fictional-bike-rentals-pnl.csv` (File › Export sheet as CSV…, calculated values) | 3,494 bytes |
| `output/fictional-bike-rentals-summary.pdf` (File › Print / PDF…, 3 pages) | 131,942 bytes |
| `output/fictional-bike-rentals-pnl.pdf` (3 pages across) | 95,794 bytes |

The standard file holds 523,073 bytes of application code (ceiling 750,000) and 341,716 bytes of workbook content; the offline file 2,974,024 bytes of code.

Versions: document `html-data/0.2` (model `html-data/0.1`), IronCalc `ironcalc/0.9.0+html-office.3`, ECharts 6.1.0, SheetJS CE 0.20.3 (offline file only, for XLSX import), plugin `html-slides` 0.7.1 with the html-data skill as on this branch; generated with Node 26.0.0, Playwright 1.62.1 Chromium.

## Known totals

Independently computed in `tests/acceptance-expected.mjs` from the CSV records and the assumptions, without the workbook's formulas; every saved result is compared to them.

| Base scenario | Actual 2025 | Forecast 2026 | 24 months |
| --- | --- | --- | --- |
| Rentals | 18,640 | 20,131.2 | 38,771.2 |
| Revenue | €121,160 | €134,778 | €255,938 |
| Net income | €5,873 | €15,209 | €21,082 |
| Free cash flow | €7,753 | €17,550 | €25,303 |

Cash-flow NPV at 9% a year (monthly rate (1.09)^(1/12) − 1), after the €20,000 initial investment: €2,560; 9 loss-making months; lowest cumulative cash −€25,315. After refreshing from `rentals-2025-v2.csv` (102 records): revenue €263,655, net income €26,645, NPV €7,334. In the High scenario before the refresh: revenue €267,461, NPV €9,295.

## What the skill and tools lacked

Found while generating this workbook through the skill:

| Gap | Outcome |
| --- | --- |
| A pivot definition without `filters` was refused with "Pivot filters must list at most 4 fields" | Fixed: the message says the field is a list, `[]` for none (one corrective retry of the patch) |
| `set.pivots` and other `set` fields need stable sheet IDs; an imported sheet's ID is known only after the import | SKILL.md now says to `inspect` for IDs |
| `new` does not refresh pivot tables, so a model with pivots fails `validate` until `recalculate --refresh-pivots` | SKILL.md › Create now says so |
| No command turns a standard file into an offline one (or back), and `extract` kept only the JSON, so a rebuilt copy lost a custom charte | Fixed: `extract --charte-out theme.css` writes the document's charte; SKILL.md gives `extract … --charte-out`, then `new … --charte [--offline]` |
| `new --charte` with a partial charte (some tokens missing) fails with "Unsupported JSON value" while drawing chart previews | Listed: a complete charte works; missing tokens should fall back to the default or be named |
| Imports run only in the browser, so a workbook built on imported data needs a person (or a driven browser) between two tool steps | By design (FORMAT.md › Imported sources); documented in SKILL.md |
| `inspect --range` prints about 15 lines of JSON per cell; reading 60 analysis results needed a small script | Listed: a compact table view would help |
| The shared category axis draws every label, so 24 `mmm yy` labels overlap on the line chart | Worked around with `mmm` labels and a wider chart; fixed in the shared chart module by PR #94 (long axes thinned) |
| Column charts with several series set colours per bar, so the legend swatches take ECharts' default palette (blue-violet and lime) instead of the bar colours; the existing P&L fixture has the same | Fixed in the shared chart module by PR #94 (it also affects Slides) |
| Refresh source… lists only the formulas that read the sheet directly (Monthly actuals, Formula analysis), not the P&L and Summary that follow | Listed for T16 |
| IronCalc's `TEXT` rounds halves to even (`TEXT(2.5,"0")` is `2`, `TEXT(0.125,"0%")` is `12%`); Excel rounds them away from zero | Listed as a formula-contract finding; this workbook avoids ties |
