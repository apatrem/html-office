# ADR-013 — Cross-product clipboard contract (tables and charts)

Status: proposed on 24 October 2026 (task X01 of the [cross-product plan](../HTML-OFFICE-CROSS-PLAN.md)). It details [ADR-011](011-html-office-shared-principles.md) §5 and §8. The user took the four open choices the same day; see [Decisions taken by the user](#decisions-taken-by-the-user). Nothing is implemented yet; the implementation is X02 (below) and X03.

## Context

The user requires (24 October 2026) that Slides, Data and Text use **the same ECharts code as Slides**, loaded from the pinned, SRI-verified CDN URL (embedded in offline builds), and that **a chart can be copied and pasted between the three apps**. Tables and ranges must also move between them, and to and from Excel, Google Sheets, Word and Google Docs.

What exists today:

- **Data** copies a rectangular range on the grid's `copy` event with two flavours ([`runtime/clipboard.mjs`](../../packages/data/runtime/clipboard.mjs)):
  - `application/x-html-office-range+json` holds `html-office-range/1`: `{schema, origin, cells, links?}`, where `cells` are complete Data cell records (inputs, formulas, saved results, `cellStyle`, `format`, `style`) and `links` are sheet-level links keyed by relative position ([`model/clipboard.mjs`](../../packages/data/model/clipboard.mjs));
  - `text/plain` holds TSV of raw values.
  
  Paste reads the custom type first; otherwise it opens the values-first paste dialog (TSV, CSV, Markdown, with explicit locale typing). There is no `text/html` flavour, so Excel and Sheets receive plain text only.
- **Slides** pastes plain text into the text box being edited (`src/engine/editor.js`) and has no element copy. Charts are `figure.chart[data-type]` with a JSON `script` and a saved `svg.render` preview. The chart contract is the registry in `src/engine/charts.js` with one module per type in `src/charts/`: `validate`, `toOption` and a `table` adapter (`columns`, `toRows`, `fromRows`) used by the chart data editor. ECharts 6.1.0 is pinned in `src/echarts.js`. Tables are `table.t` with `th`, `td.n` for numbers and `tr.tot` for a total row; text colours are `span.c-*` tokens, plus `hl` and `neg`; there are no links and no merged cells in the format reference.
- **Text** is specified only ([Text V1](../HTML-TEXT-V1.md), [ADR-004](004-html-text-format-and-editor.md)). It plans report tables with header rows, total row and merged cells, charts that reuse the Slides contract, and paste from Word, web pages and Excel (Text T07). Text T11 plans to extract the chart contract to `packages/shared/charts/`.
- **Data charts** are planned as T18 in the [Data plan](../HTML-DATA-PLAN.md) (paused): charts bound to typed ranges, with saved SVG previews.

## Research: what browsers allow

Two APIs write the clipboard.

1. **`ClipboardEvent` (`copy`, `cut`, `paste`) with `DataTransfer`.** It is synchronous and fired by the keyboard shortcut or by `document.execCommand('copy')` from a menu click. It works in every target browser and accepts strings only: `setData(type, string)`.
2. **The async Clipboard API** (`navigator.clipboard.write` and `read` with `ClipboardItem`). It can write `image/png`, but it needs user activation and, for reading, a permission or a browser paste prompt. Arbitrary types use Chromium's **web custom formats** (`"web "` + MIME type, Chromium 104+). `ClipboardItem.supports()` reports that Firefox and Safari do not support them ([Chrome blog](https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api), [caniuse](https://caniuse.com/mdn-api_clipboarditem_type_web)).

Findings that decide the design:

| Question | Chromium | Firefox | Safari / WebKit |
| --- | --- | --- | --- |
| Custom MIME type written with `DataTransfer.setData` readable on paste **in another document** | Yes, across origins: stored in one "Chromium Web Custom MIME Data Format" entry. **Verified** (PoC below). | Yes since Firefox 48, across origins (`application/x-moz-custom-clipdata` on Windows). Documented, not yet verified here. | **Same origin only** ([WebKit blog](https://webkit.org/blog/8170/clipboard-api-improvements/); [W3C thread](https://lists.w3.org/Archives/Public/public-webapps-github/2022Feb/0690.html)). An opaque origin gets a random per-document identifier (`Document::originIdentifierForPasteboard`, WebKit source), so two different local files never share custom types. |
| `text/html` read on paste across origins | Raw, as written. **Verified**: a 2 MB `data-*` attribute, comments and even `<script>` arrive intact through the paste event. | Raw ([Chromium intent thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/jepMbayI0UM/m/78kBjpEQAAAJ)). | **Sanitised** across origins: the fragment is laid out in a staging document and re-serialised. WebKit's `StyledMarkupAccumulator` keeps ordinary attributes, drops `on…` handlers and `javascript:` URLs, replaces `style` with computed inline style, and **skips nodes with no renderer**: comments, `script`, `template`, `display:none` (WebKit `editing/markup.cpp`). |
| `text/html` via `navigator.clipboard.read()` | Sanitised by default: `<script>`, `<meta>`, `<head>`, `<style>` removed and styles inlined ([Chrome docs](https://developer.chrome.com/docs/web-platform/unsanitized-html-async-clipboard)); `unsanitized: ['text/html']` from Chromium 120. **Verified**: `data-*` attributes survive the sanitiser; `<script>` does not. | Supported from Firefox 127 behind a paste prompt. | Same-origin rules as above; a paste callout is shown. |
| Web custom format visible to a `paste` event | **No. Verified**: written by `clipboard.write()`, it appears only to `clipboard.read()`. | Not supported. | Not supported. |
| `image/png` | Async write only. Verified: it then appears as a `Files` entry on paste. | Async write from Firefox 127. | Async write. |

**Proof of concept.** Two `file://` pages ran in Playwright Chromium 151 (headless) in one context. The source wrote the custom type, `text/html` and `text/plain` from a `copy` event, then wrote `text/html`, `text/plain`, `image/png` and a web custom format with `clipboard.write()`. The target read each through the `paste` event and through `clipboard.read()` (sanitised and unsanitised). The script and results are in [`docs/research/x01-clipboard-poc/`](../research/x01-clipboard-poc/README.md), together with a second script that checks whether inert HTML parsing fetches resources (§1, "Parsing"). Limits: headless Chromium may use an in-process clipboard rather than the macOS pasteboard. Safari, Firefox and native applications were not driven; they are X02 gates.

**Precedent.** Google Sheets carries cell types and formulas in `data-sheets-value` and `data-sheets-formula` attributes on the `td` elements of its `text/html` flavour ([analysis](https://iter.ca/post/docs-html/)). Google Docs keeps only a GUID in the HTML and the data in the browser's local storage, which works in one browser profile only.

## Decision

### 1. Carriers and flavours

One **envelope** (§2) travels in up to three places, written together by one synchronous `copy` handler:

| Flavour | Content | Who reads it |
| --- | --- | --- |
| `application/x-html-office+json` | The envelope as JSON text | html-office in Chromium and Firefox, across documents; Safari same origin only. The fast path, needed for ranges too large for HTML. |
| `text/html` | **Semantic HTML** for other applications: a `table`, or a `figure` with the chart picture. The **envelope is embedded as JSON in a `data-html-office` attribute on that root element.** | Everyone. It is the only carrier that crosses Safari documents and **different browsers** (custom types are browser-private). Other applications ignore the attribute. |
| `text/plain` | TSV for ranges and tables; for charts, the title then the chart's data table as TSV | Plain-text targets, Excel's fallback, Data's existing dialog |

Rules:

- **The carrier is an attribute on a rendered element**, not a comment, `script`, `template` or hidden element: WebKit's sanitiser drops those, while Chromium's and WebKit's sanitisers keep `data-*` attributes. The JSON is attribute-escaped (`&`, `"`, `<`, `>`); no base64, so the payload stays readable.
- **Do not use web custom formats.** They are Chromium-only and invisible to `paste` events, so they would only duplicate the HTML carrier.
- **Writing uses the `copy` event**, from the keyboard or from Edit › Copy through `document.execCommand('copy')`, as Data does today. **Charts** also try the async API from the same gesture, to add `image/png` for other applications; see §4. If that write is refused, the strings from the `copy` event remain.
- **Reading uses the `paste` event.** A menu Paste command may use `navigator.clipboard.read()` where available; it reads `text/html` (sanitised mode is enough, since the attribute survives) and `text/plain`. Otherwise it tells the user to press Ctrl/Cmd+V.
- **Reader precedence:**
  1. `application/x-html-office+json`;
  2. the first `[data-html-office]` element in `text/html`;
  3. the legacy `application/x-html-office-range+json` (Data, until 1.0; the project is pre-release, so this may also simply be dropped);
  4. semantic `text/html` tables (Excel, Sheets, Word, Docs, web pages);
  5. `text/plain`.
  
  **An absent carrier, or an envelope with an unknown `schema` string (a newer major version), is skipped** with a notice, and the reader continues down the list. **A recognised `html-office-clip/1` envelope that is malformed, over a limit or unsafe aborts the whole paste**, leaving the document unchanged. It never falls back to the semantic flavours: a broken Data range would otherwise paste rounded displayed values and silently lose its formulas.
- **Parsing.** The `text/html` flavour is parsed by assigning it to a detached `<template>` element's `innerHTML` and reading `template.content`. That content belongs to the template's inert document, which has no browsing context. It is read as data, and clipboard nodes are never inserted into the live document. `DOMParser` is not used: MDN warns that its document "can download resources specified in `<iframe>` and `<img>` elements".
  - Chromium 151 fetched nothing for `img`, `srcset`, `iframe`, `link`, `object`, `poster`, `@import` or `url()` with `<template>`, `DOMParser` or `createHTMLDocument` ([`parse.mjs`](../research/x01-clipboard-poc/parse.mjs)).
  - **X02a gate:** the same zero-request test passes with `<template>` in Firefox and WebKit. If it fails in an engine, X02a first removes every resource-bearing element and attribute from the string with a tokeniser pre-pass, before any parsing in that engine, and the test is repeated.
- **Size limits** (initial values, measured in X02). Writers and readers use the same limits, measured as JavaScript string length (UTF-16 code units) before any parsing. A writer never produces a flavour that a reader would refuse.

  | Flavour | Limit | Writer above the limit |
  | --- | --- | --- |
  | `application/x-html-office+json` | 64 Mi code units | Copy fails with a message (with Data's 2,000,000-cell limit, as today) |
  | `text/html` with the embedded envelope | 20,000 cells and 8 Mi code units | Omits `text/html` |
  | `text/plain` | 64 Mi code units | Copy fails with a message |

  A very large Data range therefore pastes richly into another Data file in Chromium and Firefox, and as values through the paste dialog in Safari across files.

### 2. Envelope `html-office-clip/1`

```json
{
  "schema": "html-office-clip/1",
  "kind": "table",
  "source": { "product": "data", "format": "html-data/0.2", "locale": "fr-FR", "stale": false },
  "table": { "…": "portable table, §3" },
  "range": { "schema": "html-office-range/1", "origin": { "row": 4, "column": 2 }, "cells": [], "links": {} }
}
```

```json
{
  "schema": "html-office-clip/1",
  "kind": "chart",
  "source": { "product": "slides", "format": "1" },
  "chart": {
    "type": "column",
    "data": { "title": "Weekly volunteer time", "unit": "hours", "categories": ["Watering", "Planting"], "series": [{ "name": "Week 1", "values": [12, 8] }] },
    "svg": "<svg …>…</svg>",
    "caption": "optional (Text)",
    "width": "text"
  },
  "table": { "…": "the chart's data as a portable table, from the type's table adapter" }
}
```

- `kind` is `table` (a Data range, or a Slides or Text table) or `chart`. One object per copy in V1. A mixed Text selection uses Text's own HTML, and other targets get its semantic HTML.
- `source` is informative only and is never trusted:
  - `product` and `format` identify the writer;
  - `locale` is present only when the writer itself formatted the displayed text in that locale: Data's `locale`. Slides and Text table text is typed by authors, so they omit it. Text's `lang` is a language, not a number format;
  - `stale: true` when copied Data results are not current.
  
  The envelope **never** contains the document URL, file path, title, author, comments or anything outside the copied selection.
- `range` appears only in Data copies. It is today's `html-office-range/1` unchanged, so Data-to-Data paste keeps formulas, formats, styles and links exactly as now.
- `chart.data` is exactly the JSON of the chart contract (the Slides `figure.chart` script). `chart.svg` is the source's saved preview. Neither carries a binding to the source document (§4), and the envelope has no workbook or document identifier.
- Unknown envelope members are ignored, for forward compatibility. Inside `range`, `table` and `chart.data`, the destination's own validators apply strictly. A new major version gets a new `schema` string.

### 3. Portable table model and mapping rules

```json
{
  "rows": [
    [ { "text": "Region", "header": true }, { "text": "2026", "header": true, "colspan": 2 }, { "covered": true } ],
    [ { "text": "North" }, { "text": "1 234,5 €", "value": { "type": "number", "value": 1234.5 }, "format": { "kind": "currency", "currency": "EUR", "digits": 1 } },
      { "text": "12 %", "value": { "type": "number", "value": 0.12 }, "format": { "kind": "percent", "digits": 0 }, "bold": true, "color": "alert" } ]
  ],
  "headerRows": 1,
  "totalRows": [],
  "columns": [ { "align": "left", "width": 30 }, { "align": "right", "width": 35 }, { "align": "right", "width": 35 } ]
}
```

- The grid is rectangular. Each slot is a cell, `null` (empty), or `{covered: true}` inside a `colspan`/`rowspan` anchor. Spans follow the HTML limits (`colspan` ≤ 1,000, `rowspan` ≤ 65,534). Readers check the expanded grid size against the destination limit **before** allocating it.
- `text` is required and is **the value as displayed in the source**. `value` (Data typed value: `number`, `text`, `boolean`, `date`, `error`) and `format` (a Data preset) are optional and only meaningful to Data.
- `runs` is optional and carries mixed inline formatting: `[{ "text": "Revenue " }, { "text": "growth", "bold": true }]`. Each run may have `bold`, `italic`, `color` and `link`, and the run texts concatenate to `text`. Slides and Text cells such as `Revenue <b>growth</b>` therefore survive Slides ↔ Text. They are flattened only for a destination without rich cell text (Data), and the paste notice counts it.
- Appearance uses **names only**: `bold`, `italic`, `color` (Slides and Data text-colour tokens `ink`, `acc`, `mid`, `alert`, `t2`, `bg`), `fill` (Data fill tokens), `cellStyle` (the ADR-012 catalogue), `link` (`{url}` with `https:`, `http:` or `mailto:`) and `align`. **No literal colours, fonts or sizes**: pasted content takes the destination's charte, as everything else in html-office does.
- `columns[].width` is a percentage of the table width.

**Data range → portable table** (Data has no merged cells; ADR-010):

| Data | Portable table | Slides `table.t` | Text table |
| --- | --- | --- | --- |
| Displayed value (`display(cell, locale)`, formats applied, `####` included) | `text` | Cell text | Cell text |
| Typed value (input or saved formula result) and `format` | `value`, `format` | Dropped | Dropped |
| Formula | Only in `range` | Values only | Values only |
| Leading rows whose cells all have `cellStyle: header` | `header`, `headerRows` | `th` row | Header row (repeats in print) |
| Row with `cellStyle: total` | `totalRows` | `tr.tot` | Total row |
| Number and date cells, or `align.horizontal: right` | `columns[].align` or cell `align` | `td.n` / `th.n` | Right-aligned (`ta-r`) |
| Explicit `left` or `center` alignment | `align` | `ta-l` / `ta-c` on the cell. The theme already applies these classes to any descendant; X02b documents them for cells in the format reference. | `ta-l` / `ta-c` |
| A `centerContinuous` run over empty cells | `colspan` | `colspan` (decision 3); with the fallback, the text stays in the anchor cell | `colspan` |
| `bold`, `italic` | Same | `<b>`, `<i>` | Bold, italic marks |
| `color` token | Same | `span.c-*` | Dropped (Text has no colour marks) |
| `alert` / `note` cell styles | `cellStyle` | `neg` / `<i>` with `c-t2` | Bold / italic |
| `title`, `rowHeader`, `assumption`, `calculation`, `output` | `cellStyle` | `title` and `output` become `<b>`; others plain | Same as Slides |
| `fill`, borders, `wrap`, row heights | `fill` only | Dropped | Dropped |
| Column widths (px) | Percentages of the copied width | Dropped (the element has its own width) | Column widths in % |
| URL link | `link` | Text kept, link dropped (Slides content has no links) | Link |
| Internal link (`{sheetId, ref}`) | Dropped | — | — |

**Slides or Text table → Data:**

- `th` rows become `cellStyle: header`; total rows become `cellStyle: total`.
- A cell with a typed `value` (a table that came from Data) keeps it, and its `format`, without asking.
- Untyped `text` follows the values-first rules of Data's paste dialog unchanged. Unambiguous numbers, `TRUE`/`FALSE` and ISO dates are typed; leading zeros stay text. **Any ambiguous cell** (for example `01/02/2026`, or `1,234` without a known locale) opens the existing paste dialog. Nothing is retyped silently. `source.locale` only preselects the dialog's choice, because a table typed by an author has no reliable locale.
- A trailing `%` on an otherwise unambiguous number gives the number divided by 100 with a percent format. Other units and currency symbols stay text.
- **Merged cells** (Data has none): a horizontal merge in a header row becomes the anchor value with `align.horizontal: centerContinuous` on the anchor and the covered cells, which is Excel's "centre across selection". Any other merge keeps the value in the top-left cell and leaves the covered cells empty. The paste notice counts them.
- Whole-cell `<b>`, `<i>` and `span.c-*` become `bold`, `italic` and `color`. Mixed `runs` are flattened (Data has no rich text) and counted.
- One URL link covering the cell becomes a Data link; a cell with several links keeps its text, and the dropped links are counted.

**Slides ↔ Text:**

- Tables use the same model and are lossless except for what one side lacks:
  - Slides has no links or caption. It gains merges with decision 3, unless X02b falls back to splitting them;
  - Text has no colour marks.
- Text's caption and figure ID are not copied into Slides. Pasting into Text creates a new ID and caption number. Slides `data-id` values are never copied; the destination assigns its own.

**Limits on paste** (initial values, measured in X02):

- Slides: 50 rows × 12 columns. The Slides density guidance stays a checker warning, not a paste error.
- Text: 1,000 rows × 30 columns.
- Data: the existing 2,000,000-cell limit.

Beyond these limits, the paste is refused with a message and the document is unchanged.

**To other applications:**

- `text/html` is a plain `<table>` with `th`/`td`, `colspan`/`rowspan` and **inline literal styles resolved from the source's charte**: font weight, italic, colour, fill, borders and alignment. That is the one place where token names become literal colours, because Word and Excel cannot read the charte.
- `text/plain` keeps today's Data behaviour: full-precision values with `.` as the decimal separator, TRUE/FALSE and error codes. Dates are written as ISO `YYYY-MM-DD` instead of serial numbers.
- Excel and Sheets prefer `text/html` over `text/plain`. Displayed text alone would **regress today's exact values**: `1234.567` displayed with no decimals becomes `1,235`, and `12.3 k` or `(5)` are not numbers. Data's `text/html` therefore carries, on every typed cell, the exact-value hints those applications emit themselves:
  - Excel's `x:num` (number or date serial) and `x:str`, and `mso-number-format` derived from the Data preset;
  - Sheets' `data-sheets-value`.
  
  These are compatibility hints only, never read by html-office.
- **X02a gate.** In Excel (macOS and Windows) and Google Sheets, pasted numbers, dates, percents, scaled formats, negatives in parentheses and leading-zero text keep their exact values. If an application cannot be made exact this way, X02a does not ship the Data `text/html` table, and the choice returns to the user. In that case Safari cross-file paste falls back to the values dialog.

### 4. Charts across the three products

**One chart module.**

- All three products use one shared module, `packages/shared/charts/`, extracted unchanged from Slides. It holds:
  - the type registry with `validate`, `toOption` and the `table` adapter;
  - `theme()` from charte tokens;
  - the ECharts loader with the **one** pinned version, URL and SRI digest (today `src/echarts.js`, ECharts 6.1.0 from jsDelivr);
  - SVG preview capture (`refreshCaches`);
  - the chart (de)serialisers for the clipboard.
- Each product builds the module into its runtime. ECharts loads from the CDN with SHA-384 SRI only when a chart must be drawn or edited. Offline builds embed the same verified bytes (`script#echarts`).
- A version bump changes all three products in one change, with a new digest.
- Number formatting in charts is `en-US` today (`src/charts/common.js`). The extraction keeps that byte-identical; a document `locale` option is a follow-up recorded in X03.

**Sequencing.** The extraction is pulled out of Text T11 into **X03**, which runs before Data T18 and before the chart increments of X02. Text T11 keeps only the Text chart figures (decision 2).

X03 is not a separate effort. It is **PR 1 of the session already assigned to the shared chart module and Data T18**, whose PR 2 is T18. That session waits for this ADR before it changes code.

- **X03** moves the contract to `packages/shared/charts/` with Slides output byte-identical (the T11 extraction acceptance, unchanged). Its prerequisites are already met: Slides PR #1 is merged and the Data loader exists. It does not depend on Text T08. X03 also adds two things the clipboard needs, outside the byte-identical rendering path:
  - **Strict per-type schemas.** Today's validators (`req` in `src/charts/common.js`) check required fields only: they accept unknown fields and wrongly typed titles or series names. X03 adds an allow-listed, recursive field and type check per chart type. Chart JSON from the clipboard must pass it as well as `validate`; unknown or wrongly typed fields reject the paste.
  - **Lossless table adapters.** Each type's `table` adapter must round-trip every per-item field, with tests. Today Gantt's adapter drops a task's `highlight`, so X03 adds a column for it. Chart-level options (`title`, `unit`, `decimals`, `prefix`, `suffix`, `highlight`, `percent`, …) are not part of the table.
- **Data T18** (when resumed) builds Data charts on the shared module. A Data chart stores **the chart-level options of the shared contract plus one binding**: a rectangular A1 block whose columns follow the type's table adapter.
  - `column`, `hbar`, `line`, `stacked`: category, then one column per series, with the series names in the header row;
  - `waterfall`: label, value, total flag;
  - `bubble`: name, x, y, size;
  - `gantt`: task, start, end, group, highlight.
  
  The chart JSON is the adapter's `fromRows` over the block's typed results. Data renders and caches SVG previews with the same functions as Slides. This one binding shape also makes the snapshot (below) and pasting a chart into Data (decision 1) the same operation in two directions.
- **Text T11** adds `figure.chart` with ID, caption and width on the shared module.

**Copying a chart.** The `copy` event writes:

- the envelope (`kind: chart`) to the custom type and in `data-html-office`;
- `text/html` as `<figure data-html-office="…"><img alt="{title}" src="data:image/png;base64,…"><figcaption>…</figcaption></figure>`;
- `text/plain` as the title and the chart's data table as TSV.

The **picture** must show what the reader sees. The saved preview (`refreshCaches`) captures only the plot's `svg`, while the title and unit are drawn separately in `.hs-chart-head`. The picture therefore draws the title and unit (from `chart.data`, in the charte font and colours) above the plot SVG. It is rasterised at 2× when the chart is selected or redrawn, because the `copy` handler is synchronous; sides are capped at 4,096 px, falling back to 1×.

**Upgrade to a native picture (to be proven in X02c).** The same handler then calls `navigator.clipboard.write()` with `text/html`, `text/plain` and `image/png`, passing `ClipboardItem` promises. Safari requires `write()` to be called within the gesture. When the call succeeds, PowerPoint, Keynote, Word and Docs receive a picture. When it is rejected, the strings already written by the `copy` event remain. html-office targets keep reading the envelope from `text/html`.

The PoC verified each half separately: the `text/html` of an async write is visible to `paste`. It did not run the combined sequence, and Chromium's granted permissions hide activation rules. X02c must test it in all three browsers:

- the `copy` write followed by the async replacement, in one gesture;
- a rejected promise;
- a paste before the promise resolves;
- two copies in quick succession, where the later copy must win.

If the sequence is unreliable in a browser, that browser falls back to a separate Edit › Copy as picture command, using the async API only.

**A Data chart becomes a values snapshot.**

- Copying a Data chart runs `fromRows` over the **saved typed results** of its binding:
  - category, label and name columns use the displayed text;
  - numeric columns use full-precision numbers, never rounded display;
  - Gantt dates use ISO text.
- Missing values follow the type:
  - category-series charts accept `null` (a missing point), and the copy reports how many blanks, texts and errors it turned into `null`;
  - every other type (`waterfall` values on non-total rows, `bubble` x/y/size, `gantt` start) needs a valid value. A chart that does not pass the shared `validate` cannot be copied, and the message lists the offending cells. Data already shows such a chart as invalid.
- If results are stale, the copy proceeds with `source.stale: true`. The destination says that the values were not recalculated, as Data's PNG download does with its warning band (decision 4).
- The envelope holds no references. A chart pasted anywhere, including back into Data, is an ordinary Slides-contract chart with literal values: **a snapshot with no link to the workbook**, as Text V1 already specifies. Refreshing from the workbook stays on the Text roadmap. Duplicating a chart inside one workbook with the same bindings is a T18 command (Duplicate chart), not a paste.

**Pasting a chart.**

| Into | Result |
| --- | --- |
| Slides | A new `figure.chart` with `chart.data` (strict schema, then the destination registry's `validate`), placed like Insert › Chart |
| Text | A new chart figure with a new ID and numbered caption; `caption` and `width` are used when present |
| Data, from any source | **Decision 1, recommendation A**: Data writes the chart's data table (`toRows` with the adapter's header row) as cells at the selection, **typed by column role, not inferred**. The header row and the label, name, category, group, date and flag columns are text cells. This applies to Gantt dates (month-only `2027-02` is not a date) and waterfall `y`/`n`. Numeric columns are written as numbers straight from the JSON, and `null` gives an empty cell. A category called `true` therefore stays text, and Slides → Data → Slides returns identical JSON. The header row gets `cellStyle: header`. Data then creates a chart whose binding is that block, with the chart-level options from `chart.data`. It shows the target rectangle first and asks before overwriting non-empty cells. One undoable step. |

**The pasted `chart.svg` is untrusted.**

- When ECharts is available, the destination redraws from `chart.data` with its own charte and discards the pasted SVG.
- When ECharts is unavailable (offline standard build), the SVG is shown only after a sanitiser rebuilds it from an allow-list in the SVG namespace:
  - elements: `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `defs`, `clipPath`, `linearGradient`, `radialGradient`, `stop`;
  - attributes, exactly:
    - `id`, `viewBox`, `preserveAspectRatio`, `transform`;
    - `d`, `x`, `y`, `dx`, `dy`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `points`;
    - `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-opacity`, `stroke-width`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `opacity`, `paint-order`;
    - `font-family`, `font-size`, `font-weight`, `font-style`, `text-anchor`, `dominant-baseline`;
    - `clip-path`, `clipPathUnits`, `gradientUnits`, `gradientTransform`, `fx`, `fy`, `offset`, `stop-color`, `stop-opacity`.
  
  Values may not contain `url(` except `url(#id)` in `fill`, `stroke` and `clip-path`. X02c checks this list against recorded ECharts 6.1.0 output for every chart type; any change to the list is a reviewed edit of this ADR.
  
  Everything else is dropped, including `script`, `foreignObject`, `style`, `image`, `use`, `a`, every `href` and every event attribute.
- **Fragment references are isolated.** ECharts emits IDs such as `zr0-c0`, so two pasted previews, or a preview and a live chart, can collide. Every pasted `id` gets a fresh per-paste prefix and every `url(#…)` is rewritten to match. A reference to an ID outside the pasted SVG, or any other `url()`, is removed. X02c tests two pastes of the same chart offline.
- The sanitised preview is marked as a preview in the source document's colours until the chart can be redrawn. If it is over 2 Mi code units, it is dropped, and the usual "Chart unavailable" message shows until ECharts loads.

**Chart limits** (initial): chart JSON 1 Mi code units and 10,000 data points per chart.

### 5. Security

Clipboard content is **untrusted**, including html-office envelopes. Any web page can write `text/html` with a `data-html-office` attribute, and in Chromium and Firefox it can also write the custom type.

- **Size before parsing.** Every flavour's string length is checked against §1's limits before `JSON.parse`, HTML parsing or TSV parsing. `text/html` over its limit is treated as absent, since it cannot be inspected. Because html-office writers never produce `text/html` over that limit, such HTML comes from another application, and falling through to the custom type or `text/plain` loses nothing html-office wrote. Cell, span and point counts are checked before a grid or a canvas is allocated.
- **Validation by the destination's own validators**, all or nothing:
  - Data `validateCell`, link and style validators;
  - the strict per-type chart schema (X03), then the chart registry's `validate`;
  - a table-model validator in the shared clipboard module.
  
  JSON is validated by allow-listed fields, so keys such as `__proto__` are rejected rather than merged. Failure leaves the document unchanged and shows a message (Data's existing "Paste failed: … Workbook unchanged." pattern).
- **No markup is adopted.**
  - Destinations build their own canonical nodes from the validated model; they never copy clipboard nodes.
  - HTML is parsed into a document without a browsing context, which runs no scripts. Fetching nothing is required and tested in every engine (§1, "Parsing").
  - No `style`, class outside the destination vocabulary, event attribute or external resource reaches the content. Slides' checker and Text's schema already reject them.
- **Links.** Only `https:`, `http:` and `mailto:` are accepted, up to 2,048 characters. Data's rule that an unsafe scheme rejects the paste applies to Data envelopes.
- **No network on paste.** Pasting a table makes no request, and X02a's tests record requests during paste in all three engines. Pasting a chart may trigger the ordinary pinned ECharts load where the destination would load it anyway to draw a chart.
- **Values only, no live link** (X02 scope). Nothing in a destination refers back to the source file. Formulas cross only Data → Data.
- **Formula-like text.** Text that starts with `=`, `+`, `-` or `@` is copied verbatim to other applications, as Excel does between workbooks. The CSV-injection policy of Data T19 is applied to the clipboard too if it adopts escaping.
- **The clipboard is not a confidentiality boundary.** Any page the user pastes into can read every flavour, including formulas and links in Data's `range` member. The envelope therefore carries only the copied selection and no document metadata; product guides say so.

### 6. X02 increments and test plan

Each increment is one PR (scope M), values only, and keeps every existing clipboard test green. Text has no editor yet, so its pairs are not a separate increment: they are acceptance items of the Text tasks that build tables and charts, on the shared modules delivered here. This avoids a circular dependency.

| Increment | Pair | Content | Depends on |
| --- | --- | --- | --- |
| **X02a** | Data → Data, Data → other applications | `packages/shared/clipboard/`: envelope, carriers, reader precedence, size limits, table model and validator, inert HTML table reader, TSV writer, charte-resolved HTML writer. Data writes the envelope with `range` and the semantic `text/html`; Data reads envelopes and Excel/Sheets/Word/Docs HTML tables (values-first). | X01 |
| **X02b** | Data ⇄ Slides tables | Slides element copy (a selected `table.t`) and paste of a table as a new element (also from Excel/Sheets/Docs); Data reads Slides tables. Adds `colspan`/`rowspan` to the Slides format and checker (decision 3), or ships the documented fallback that splits merges on paste. | X02a |
| **X03** | — | Shared chart module extraction, Slides byte-identical; then strict schemas and lossless adapters. PR 1 of the shared chart module / T18 session. | — |
| **X02c** | Slides ⇄ Slides charts, charts → other applications | Chart copy (envelope, PNG, async upgrade) and paste in Slides; SVG sanitiser | X02a, X03 |
| **X02d** | Data charts → Slides; Slides charts → Data | Snapshot from bindings; cells plus bound chart (decision 1). Data T18 delivers only the binding model; the clipboard behaviour is here. | X02c, Data T18 |
| Text T07 / T10 | Text ⇄ Data, Text ⇄ Slides tables | Acceptance items of those Text tasks (copy writes the envelope; paste uses §3) | X02a, X02b |
| Text T11 | Text ⇄ Slides charts | Acceptance item of T11 (Text part) | X02c, X03 |
| **X02f** | Text ⇄ Data charts | Data chart snapshot into Text; Text chart into Data as cells plus a bound chart | X02d, Text T11 |

**Automated tests (Playwright, in CI per increment):**

- **Two documents in separate tabs** of one browser context, opened from two different `file://` paths (the real use), and also served from two different `http://localhost` ports.
- Copy and paste with the keyboard (Ctrl/Cmd+C, Ctrl/Cmd+V) and with the menu commands.
- Assert the destination's canonical content (Data JSON, Slides or Text HTML), the paste notice, a single undo entry, and save, reopen and validate.
- Run the event path in Chromium, Firefox and WebKit engines. The PoC harness in `docs/research/x01-clipboard-poc/` is the starting point. Playwright's WebKit is not Safari's pasteboard security, so the Safari manual pass below stays mandatory.
- Run the async chart path in Chromium with clipboard permissions granted. Also run it **without** granted permissions, relying on user activation alone. Cover the combined sequence cases of §4: event write then async replacement, a rejected promise, a paste before resolution, and successive copies.
- **Zero requests** while parsing and pasting resource-bearing HTML (`img`, `srcset`, `iframe`, `link`, `object`, `poster`, CSS `@import` and `url()`) in all three engines.
- **Exact values.** Data → Excel and Sheets keep exact numbers, dates, percents, scaled values, parenthesised negatives and leading zeros (the X02a gate in §3). Pasted spreadsheet tables into Data give the same typed values as today's dialog, and ambiguous cells open it.
- **Rich cell text.** `Revenue <b>growth</b>` survives Slides ↔ Text, and is flattened with a notice into Data.
- **Chart pictures.** The PNG written for other applications shows the chart title and unit above the plot (pixel check on a fixture whose axes carry no unit).
- **Charts per type.** Every chart type, including labels such as `true` or `0012`, round-trips Slides → Data → Slides with identical JSON, including Gantt `highlight`. Two offline pastes of the same chart keep distinct, working SVG references.
- **Carrier fall-back tests:**
  - remove the custom type, so the envelope must come from `text/html`;
  - remove the attribute, so the semantic table must be used;
  - remove the HTML, so `text/plain` must be used.
  
  Each gives the documented result.
- **Hostile fixtures**, each refused or neutralised with the document unchanged:
  - `<script>`, `on…`, `javascript:` and `data:` links;
  - oversize strings;
  - `__proto__` keys;
  - invalid chart JSON;
  - SVG with `script`, `foreignObject` or an external `href`;
  - deeply nested HTML;
  - an envelope of an unknown major version, which falls through to the semantic flavours;
  - a malformed `html-office-clip/1` envelope with a valid HTML table beside it, which must abort, not fall through;
  - unknown or wrongly typed chart fields;
  - `colspan`/`rowspan` expanding past the destination limit.
- **No network on table paste.** Record requests during the paste.

**Manual matrix (each increment, recorded in its PR):**

- **Browsers:** Chrome or Edge, Safari and Firefox on macOS, plus Chrome or Edge and Firefox on Windows.
  - Copy and paste between two tabs and between two windows.
  - **Across browsers** (Chrome → Safari, Safari → Chrome, Firefox → Chrome), where only the `text/html` carrier can work.
- **Other applications, out:** Excel (macOS, Windows), Google Sheets, Word, Google Docs; for charts also PowerPoint and Keynote. The expected result is a typed table, or a picture for charts.
- **Other applications, in:** Excel, Sheets, Word and Docs tables into each product.
- **Fixtures:** fictional only.
  - `fr-FR` and `en-US` number, currency, percent, date and scaled formats, and parentheses negatives;
  - header and total rows; links; colour and bold cells;
  - a `centerContinuous` header and a Text table with merged headers;
  - every chart type, including a stale Data chart.

## Decisions taken by the user

The user took these on 24 October 2026; the options are kept for the record.

1. **What pasting a chart into Data creates: A, data cells and a chart bound to them.** Data's rule that charts reference typed cells holds, the values are editable in the grid, and Excel users expect it.
   - Not chosen: B, a free-standing chart holding literal values (simpler, but the data is invisible in the grid and T18 would need a second chart kind); C, cells only.
2. **When to extract the shared chart module: before Data T18, as X03.** The user pointed out that the session already working on the shared chart module and Data T18 plans this extraction as its PR 1. X03 is therefore that PR, not a new task.
   - X03 adds strict schemas and lossless table adapters (§4) to that session's scope. They come after the byte-identical move, in the same PR or a follow-up PR before T18, so the move stays a pure, checkable refactor.
   - Text T11 keeps only Text figures.
   - Not chosen: keeping the extraction inside Text T11, which would make Data charts wait for Text.
3. **Merged cells in Slides tables: A, allow `colspan`/`rowspan` in `table.t`** (format reference and checker, in X02b). Text and Slides tables then map one to one, and merged headers survive.
   - **Alternate option, kept open: split merges on paste.** Slides tables stay without merges, and a pasted merge keeps its text in the anchor cell and leaves the covered cells empty, with a notice. X02b may ship it instead of A only if merges prove incompatible with Slides table editing, the checker's geometry checks or print, and it must say so in its PR. The mapping rules above describe both.
4. **Copying stale Data results: A, allow the copy, mark it `stale` and show a notice in the destination**, consistent with Data's PNG download.
   - Not chosen: refusing the copy until recalculation, which may need the engine download in standard mode.

## Alternatives considered

- **Custom MIME type only** (today's Data design). It fails across Safari documents (same-origin rule; local files have unique origins) and across browsers. It is kept as the fast path, not as the only carrier.
- **Web custom formats** (`web application/…`). They are Chromium-only, need the async API and permissions, and are invisible to `paste` events (verified).
- **JSON in an HTML comment, `script` or `template`, or a hidden element.** These survive Chromium but are dropped by WebKit's cross-origin sanitiser, which skips non-rendered nodes.
- **A GUID in the clipboard with the data in browser storage** (Google Docs). It works only in one browser profile, fails across browsers and leaves copies of user data in storage.
- **Base64 payload.** It hides content from review and LLM inspection and grows the payload by a third, for no sanitiser benefit, since attributes survive anyway.
- **Live links from Slides or Text to Data.** They are out of scope by design: Text V1 specifies snapshots, and live links would need file identity and refresh across files.

## Consequences

- Data's clipboard changes shape: the envelope replaces the bare `html-office-range/1` object as the custom type's content, but `range` keeps it byte for byte. Data gains a `text/html` flavour, so Excel and Sheets receive formatting and structure.
- Slides gains element copy and paste for tables and charts. Its format reference gains merged cells (decision 3), unless X02b uses the fallback.
- Text T07, T10 and T11 inherit the mapping instead of defining their own for html-office sources.
- A new shared module, `packages/shared/clipboard/`, is added, and the chart contract moves to `packages/shared/charts/` (X03). Both count toward each product's code ceiling: the clipboard module is expected to be well under 20 KB, and the chart module is moved code, not new code.
- Safari, Firefox and native-application behaviour is documented from sources and WebKit code, not yet observed. X02 gates must observe it before any increment is accepted.
