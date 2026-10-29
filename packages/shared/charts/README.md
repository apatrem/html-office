# Shared chart module

The chart contract of html-office, extracted from Slides ([ADR-013 §4](../../../docs/decisions/013-cross-product-clipboard.md), task X03). Slides, Data (T18) and Text (T11) draw charts with this code and the one pinned ECharts version. Each product bundles it into its own runtime.

| File | Contents |
| --- | --- |
| `index.mjs` | Type registry, `theme()` from charte tokens, the lazy SRI-verified ECharts loader, rendering into `figure.chart`, and SVG preview capture (`previewOf`, `refreshCaches`) |
| `schema.mjs` | Strict per-type schemas: `checkSchema` allow-lists fields and types recursively, `strictValidate` adds the type's own `validate`. A new type needs an entry here too. Chart JSON from another document (clipboard) must pass it. Part of the Slides engine bundle since X02c (pasted charts) |
| `clipboard.mjs` | Charts on the clipboard (ADR-013 §4, X02c): `readChart` (strict schema, `validate`, 1 Mi of JSON, 10,000 points), `chartTable` and `chartText` (the data through the type's table adapter), and `sanitizeSVG`, which rebuilds a pasted preview from the allow-list with prefixed ids. Needs a DOM |
| `picture.mjs` | `chartPicture`: the picture other applications receive, the title and unit above the plot preview, PNG at 2× (sides up to 4,096 px). Needs a DOM |
| `echarts.mjs` | Approved ECharts version, CDN URL and SHA-384 digest. A version bump changes all three products and needs a new digest |
| `types/common.mjs` | Helpers shared by the types: number formatting, axes, series colours, required-field checks, the categories × series table adapter |
| `types/<type>.mjs` | One chart type: `label`, `validate(data)`, `table` adapter and `toOption(data, theme)` |

Table adapters are lossless: `fromRows(toRows(d))` returns every per-item field, from typed cells (Data bindings) or text cells (the Slides data panel). Yes/no columns write `y`, `n`, or a blank cell when the field is absent, so an explicit `false` survives. The only normalisation is a waterfall total's missing value: `null` and `""` come back absent, which draws the same chart. Chart-level options (`title`, `unit`, `decimals`, `prefix`, `suffix`, `highlight`, `percent`, …) are not part of the table. Columns per type:

| Types | Columns |
| --- | --- |
| `column`, `hbar`, `line`, `stacked` | Category, then one column per series; series names in the header row |
| `waterfall` | Label, Value, Total (y/n) |
| `bubble` | Name, X, Y, Size |
| `gantt` | Task, Start, End, Group, Highlight (y/n) |

Category axes show every label, wrapped to its share of the axis, up to 12 categories; longer series let ECharts thin the labels to the axis's real length (every second, third… label), each on one line cut at 120 px, which keeps a horizontal bar chart's plot. Every series carries its colour at series level, which the legend swatch takes, even where bars set their own (column and bar highlights).

ECharts loads from the CDN with SRI only when a chart must be drawn or edited. Offline builds embed the same verified bytes: Slides as an executable `script#echarts`, Data as inert text (`script#echarts-source`) run only when a chart is first drawn or edited. Saved SVG previews display and print without it.

Moving the module out of `src/` left the Slides engine byte-identical (first X03 commit). `src/engine/model.js` still re-exports the ECharts constants so the bundle keeps its module order.

Used by: html-slides (`src/engine/`) and html-data (`packages/data/runtime/charts.mjs`, T18: bindings over typed ranges, saved previews, lazy instances). html-text (`packages/text/runtime/charts.mjs`, T11: saved previews keyed by what they were drawn from, instances created when a chart scrolls into view, the offline build's `script#echarts`).

Follow-up: chart numbers are formatted in `en-US` only (`types/common.mjs`); a document `locale` option is not implemented yet.
