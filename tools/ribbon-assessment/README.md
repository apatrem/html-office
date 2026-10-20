# Ribbon reuse assessment

The production-size experiment rejects straightforward adaptation of IronCalc's React toolbar under the existing total embedded-code budget. It does not establish a universal minimum or claim that every stripped/re-written upstream variant would be too large.

| Production bundle | Raw JavaScript | Raw CSS | Total raw bytes |
| --- | ---: | ---: | ---: |
| React mount baseline | 222,934 | 0 | 222,934 |
| Upstream toolbar lower bound | 367,698 | 22,713 | 390,411 |

Current Data P&L standard application code is 324,414 bytes (`packages/data/bench/conditional-core-pnl-results.json`). Adding the toolbar gives 714,825 before removing old controls, adapting commands or adding notices. Fitting it would require substantial removal/reimplementation and leave little room for the remaining import, chart, pivot and export features. Gzip sizes are recorded for transfer information only; the 500,000-byte ceiling applies to raw embedded application code.

## Reproduce

Use a Git checkout of https://github.com/ironcalc/IronCalc containing commit `297553dc3a37ec6b0f4821055220e3d26c4ac6a1`:

```sh
npm ci --prefix tools/ribbon-assessment --ignore-scripts
node tools/ribbon-assessment/measure.mjs --source /path/to/IronCalc
```

The script extracts committed sources with `git archive`, ignoring local source edits. It builds with locked dependencies, production React, minification, tree shaking, the English locale and real upstream SVG/CSS assets. All runtime peer packages are bundled. The source archive hash and sizes are in `results.json`; metafiles and bundles remain in ignored `dist/ribbon-assessment/`. Two local runs reproduced the same sizes.

This is a **size-only lower bound, not a usable integrated toolbar**. WASM border enums and `hexWithTintToRgb`, `columnNameFromNumber`, `quoteName` are stubbed; functions throw rather than pretending to supply calculation behaviour. Real helper implementations, canonical command adapters, complete notices and additional locales are excluded. No functional/browser success is claimed for this probe.

## Integration findings

The upstream component is a scrolling single toolbar. It is not exported as a standalone package API; extraction reaches into `src/components/Toolbar/Toolbar.tsx`. It depends on React, React DOM, translation, icons, colour/menu/theme/border components and some WASM UI helpers. Its callback interface could be adapted to our commands, but its formatting strings/theme/border/merge features differ from our smaller canonical contract. Showing unsupported buttons would mislead users. Initial formatting must keep working before calculation-engine initialization.

The included runtime package declarations are MIT or ISC (see the measured closure). IronCalc offers MIT/Apache-2.0 options. These declarations are not a completed redistribution/notice audit. Licensing is not the rejection reason; no assessment dependency is adopted by the Data runtime.

## Selected approach and verification

Implement a native HTML/CSS ribbon with small JavaScript tab/focus handling and existing command elements. Aim for a small incremental footprint and measure the complete resulting standard file; do not assume the budget from an isolated component. Provide File/Home/Formulas/Data/View groups as actual supported commands warrant, quick-access save/history, a compact formula bar, clear scenario controls and bottom sheet navigation. Preserve readable JSON, existing worker/edit/history/recovery operations and shared branding. Keyboard, narrow-width, offline, save/reopen and existing regression/performance checks are required before merging it.
