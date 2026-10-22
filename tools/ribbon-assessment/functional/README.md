# Functional toolbar assessment (R04)

Experimental tools only. Production Data runtime/build sources and the default editor are unchanged. Import remains paused. The delivery decision belongs to the user after the report.

## Reproduce

From the repository root, with an IronCalc Git checkout containing revision `297553dc3a37ec6b0f4821055220e3d26c4ac6a1`:

```sh
npm ci --prefix tools/ribbon-assessment --ignore-scripts
node --test tools/ribbon-assessment/functional/adapter.test.mjs
node tools/ribbon-assessment/functional/build.mjs --source /path/to/IronCalc
node tools/ribbon-assessment/functional/browser.mjs
node tools/ribbon-assessment/functional/performance.mjs
```

The build extracts committed source via `git archive`; local upstream changes are ignored. It writes fictional P&L samples, the baseline, adapted source and size receipts to ignored `dist/toolbar-functional/`. The browser test starts a gzip/CORS/cache-enabled loopback asset server on port 8765 and tests local-file HTML. Keep the build stable while tests collect timings. Requires the repository's existing Playwright Chromium installation.

`--asset-base https://...` builds a CDN sample with that asset directory. The default loopback base is a controlled simulation, not an Internet CDN. The build writes `../vendor/` (ignored by git). The immutable assets used for the real-CDN receipts remain available at repository commit `4ea4fd2e1c4cfc2c8175a9e078db5e8bf55432d0`; they are experimental fixtures, not a public package API or production release.

The actual Internet comparison uses the immutable experimental assets below. Run it separately from the local test (which expects its default loopback build):

```sh
node tools/ribbon-assessment/functional/build.mjs --source /path/to/IronCalc --asset-base https://cdn.jsdelivr.net/gh/apatrem/html-office@4ea4fd2e1c4cfc2c8175a9e078db5e8bf55432d0/tools/ribbon-assessment/vendor
node tools/ribbon-assessment/functional/cdn-browser.mjs
node tools/ribbon-assessment/functional/performance.mjs
node tools/ribbon-assessment/functional/copy-samples.mjs /path/to/a/new/sample-directory
```

The copy command creates a comparison index and six samples and refuses to overwrite an existing directory. The [final report](../../../docs/HTML-DATA-TOOLBAR-ASSESSMENT.md) links the size, browser, actual-CDN and P&L receipts in `results/`. The native sample carries only its applicable icon notices; the upstream samples include runtime dependency attribution texts, including declared prebundled helper dependencies.

## Integration boundary

An esbuild plugin appends `host-bridge.mjs` only to the experimental app bundle, emits state notifications at existing render/selection boundaries, and clears transient React/CSS/blob DOM from saved copies. Supported toolbar callbacks use the same canonical formatting/history/dialog handlers as the normal editor. No duplicate workbook or history store is introduced. This source-injection seam is a prototype coupling that would need a deliberate command API before production adoption.

The upstream extraction uses real TypeScript enums from the pinned WASM type definitions and an engine-free JavaScript port of IronCalc's tint helper, verified against upstream golden cases. There are no throwing size-probe helper stubs. Unused name/column helpers are tree-shaken. Unsupported action callbacks throw defensively and their controls are disabled; the supported path must never invoke them.

`patches.mjs` applies exact pinned-source adaptations: disable unsupported capabilities, block disabled menu triggers, label the number-format trigger, make overflow arrows keyboard-accessible, observe resize, and disable custom/long-date formats absent from our model. Changed upstream anchors fail the build. Extracted JS/CSS includes React/DOM, translations, icons, colors and peer runtimes. Full runtime licence texts are collected from the actual build dependency closure and embedded in samples.

The lightweight prototype uses native buttons/selects and static Lucide SVG icons, rendered at build time. React does not enter its browser runtime. It matches the compact group/icon treatment; its format dropdown remains a native select. It is a bounded visual alternative, not a full IronCalc UI clone.

## What the samples do

Use **Enable editing toolbar**. All variants retain **Existing editing commands / fallback**, quick-access saving, the formula bar, scenario selection and sheet groups.

Supported: undo/redo, clear formatting, currency/percentage, decimal adjustments, supported number/date presets, conditional-format dialog entry and a presentation-only grid-line toggle. Grey controls indicate fonts/emphasis, colors, borders, themes/named styles, alignment/wrapping, merging, links, PNG and copy-style commands unsupported by the current canonical model. Merely loading IronCalc's toolbar does not implement those workbook features.

CDN assets fetch only on activation, with credentials omitted and SHA-256 verified before CSS insertion or JS execution. Complete dependency closure is bundled, with no unchecked module graph. Compressed embedding uses gzip/Base64 plus `DecompressionStream`, verifies decoded digests, and makes no ribbon request. Failure offers retry/fallback and leaves canonical state/pending edits open. Offline variants embed the calculation engine as well as the toolbar. Save/reopen starts with an unmounted toolbar and empty undo history, preserving the edited workbook.

Report stored HTML/application bytes separately from decoded JS/CSS. The prototype deliberately emits an over-budget embedded candidate for comparison; it does not relax the production builder's 500,000-byte standard-mode gate. Readable workbook data and guide stay uncompressed.
