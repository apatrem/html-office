# Shared chart module

The chart contract of html-office, extracted from Slides ([ADR-013 §4](../../../docs/decisions/013-cross-product-clipboard.md), task X03). Slides, Data (T18) and Text (T11) draw charts with this code and the one pinned ECharts version. Each product bundles it into its own runtime.

| File | Contents |
| --- | --- |
| `index.mjs` | Type registry, `theme()` from charte tokens, the lazy SRI-verified ECharts loader, rendering into `figure.chart`, and SVG preview capture (`refreshCaches`) |
| `echarts.mjs` | Approved ECharts version, CDN URL and SHA-384 digest. A version bump changes all three products and needs a new digest |
| `types/common.mjs` | Helpers shared by the types: number formatting, axes, series colours, required-field checks, the categories × series table adapter |
| `types/<type>.mjs` | One chart type: `label`, `validate(data)`, `table` adapter and `toOption(data, theme)` |

ECharts loads from the CDN with SRI only when a chart must be drawn or edited. Offline builds embed the same verified bytes as `script#echarts`; saved SVG previews display and print without it.

Moving the module out of `src/` left the Slides engine byte-identical. `src/engine/model.js` still re-exports the ECharts constants so the bundle keeps its module order.

Follow-up: chart numbers are formatted in `en-US` only (`types/common.mjs`); a document `locale` option is not implemented yet.
