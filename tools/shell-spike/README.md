# R06 native shell spike

Assessment tooling only; production Data sources are untouched. The report is [docs/HTML-DATA-NATIVE-SHELL-SPIKE.md](../../docs/HTML-DATA-NATIVE-SHELL-SPIKE.md).

## Reproduce

From the repository root, with the repository's Playwright Chromium:

```sh
npm ci --ignore-scripts
npm ci --prefix packages/data --ignore-scripts
node tools/shell-spike/build.mjs
node tools/shell-spike/browser.mjs
node tools/shell-spike/compare.mjs   # side-by-side with the variant A mock-up
```

`build.mjs` bundles the Data runtime with the same assessment-only seam as R05 (`host-bridge.mjs`, plus a `cellStyle` command) and the shell from `entry.mjs`. It writes `dist/shell-spike/shell-native[-offline].html` and the baselines. Size receipts go to `results/build.json`, including a per-module breakdown and source line counts. `browser.mjs` runs R05's functional flow on the native shell, the three engine-failure modes, layout at 320/768/1024/1440 px and timings. It writes `results/browser.json` and `results/screenshots/`. `compare.mjs` captures the sample in the same states as the U02 variant A screenshots (copied as `results/variant-a/target-*.jpg`) and writes `results/variant-a/index.html` and `measurements.json`.

The sample shows a yellow notice: formatting without an ADR-012 model (bold, italic, alignment, wrap, colours, borders, links, theme, font, regional settings) is recorded only and has no visible effect yet.

No IronCalc checkout or extra package is needed: the shell has no runtime dependency.

## Pieces

- `shell/`: the candidate shared module, framework-free and product-agnostic.
  - `dom.mjs`: element helper, icons, buttons and roving focus.
  - `popover.mjs`: anchored popover with outside-click, Escape and focus return.
  - `menu.mjs`: ARIA menu, menu button and menubar.
  - `toolbar.mjs`: ARIA toolbar with overflow arrows.
  - `pickers.mjs`: ADR-012 colour swatches and the border picker.
  - `drawer.mjs`: side drawer, a bottom sheet at narrow widths.
  - `dialogs.mjs`: link dialog on native `<dialog>`.
  - `panels.mjs`: panel bodies for cell styles, regional settings and document settings.
  - `shell.css`, `icons.mjs`: styles and icons.
- `data-shell.mjs`: variant A for Data, built from those components. Commands the current model supports go through the existing canonical handlers. ADR-012 features without a model yet are recorded in `globalThis.toolbarSpikeIntents`, as in R05.
- `integration.css`: hides the host header and the old ribbon, which stays in the page as a fallback, as in R05.
