# R05 Preact toolbar spike

Assessment tooling only; production Data sources are untouched. The report is [docs/HTML-DATA-PREACT-SPIKE.md](../../../docs/HTML-DATA-PREACT-SPIKE.md).

## Reproduce

From the repository root, with a Git checkout of https://github.com/ironcalc/IronCalc containing `297553dc3a37ec6b0f4821055220e3d26c4ac6a1` and the repository's Playwright Chromium:

```sh
npm ci --prefix tools/ribbon-assessment --ignore-scripts
npm ci --prefix packages/data --ignore-scripts
node tools/ribbon-assessment/preact/build.mjs --source /path/to/IronCalc
node tools/ribbon-assessment/preact/browser.mjs
node tools/ribbon-assessment/preact/performance.mjs
```

`build.mjs` extracts committed upstream sources with `git archive`, applies the exact-anchor patches in `patches.mjs`, and bundles `entry.jsx` three times: on React with the upstream i18next/lucide stack, on React with our shims, and on `preact/compat`. It writes size receipts to `results/build.json` and samples to `dist/toolbar-preact/`: `toolbar-preact[-offline].html`, `toolbar-react-upstream[-offline].html` and the baselines. Browser, layout and timing receipts go to `results/browser.json`; P&L timings to `results/pnl-performance.json`.

`ironcalc-static.json` holds the built-in themes, built-in cell styles and locales that upstream obtains from WASM. Regenerate it with `node tools/ribbon-assessment/preact/extract.mjs --source /path/to/IronCalc`, which needs `cargo` with the dependencies already cached because it runs `--offline`.

## Pieces

- `shims/i18n.mjs` replaces i18next/react-i18next with a flat dictionary. The build keeps only the keys the bundle references, including template prefixes.
- Icons are lucide's SVG markup rendered at build time into pure components; there is no icon runtime.
- `shims/wasm.mjs` provides the type enums, the engine-free tint helper and static data in place of `@ironcalc/wasm`.
- `entry.jsx` mounts the toolbar, right drawer and link dialog. Supported commands use the existing canonical handlers through `host-bridge.mjs`. ADR-010 features without a model yet are recorded in `globalThis.toolbarSpikeIntents`.
- `spike.css` holds the integration CSS: toolbar stacking above the grid, the charte font for IronCalc's `--typography-font-family`, and the drawer position.
