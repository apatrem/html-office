# R04 — Functional toolbar delivery assessment

21 October 2026. Assessment complete; **delivery choice remains open**. The current native ribbon remains the default. Import and T15–T22 remain paused. This report completes the experiment requested in [issue #38](https://github.com/apatrem/html-office/issues/38), not a production migration.

## Recommendation for the user decision

Use the **actual IronCalc toolbar through a lazy CDN in standard mode**, with the same toolbar embedded in `--offline`, if the upstream appearance is the priority. The approximately 117 kB gzip / 119 kB observed CDN payload is reasonable in this experiment. The earlier size-only rejection of straightforward embedding was not grounds to reject CDN delivery.

Our lightweight alternative is viable and visually close for the current supported actions. It avoids UI downloads/frameworks but makes us responsible for component interactions and visual maintenance. Compressed embedding of the full toolbar is functional, but this prototype exceeds both the stored standard application budget and the decoded raw-code interpretation. It is not selected or declared compliant.

Before production adoption, replace the experimental source-injection bridge with a deliberate command/state interface and retain explicit capability gates. Loading upstream UI does not add fonts, borders, merging or other workbook features missing from our canonical model.

## Scope and reproducibility

The [functional tools and instructions](../tools/ribbon-assessment/functional/README.md) reproduce three usable candidates against the same fictional 24-month P&L with Base/Upside/Downside scenarios. Every candidate retains the existing controls inside **Existing editing commands / fallback**, the same quick-access saving, formula bar, sheet groups, canonical workbook and calculation worker.

Upstream is pinned to `297553dc3a37ec6b0f4821055220e3d26c4ac6a1`. Experimental CDN assets are pinned to repository commit `4ea4fd2e1c4cfc2c8175a9e078db5e8bf55432d0`, bundled with all runtime peers and checked by SHA-256 before CSS insertion or JavaScript execution. This is an experimental asset fixture, not a production CDN release or upstream standalone package.

The size-only R01 probe remains historical evidence. R04 has real callbacks/helpers, supported capability gates, complete collected notices and browser-tested saving. No production Data source, default distribution, dependency manifest or performance gate was modified. Experimental files can be over budget without relaxing the production builder's guard.

## Complete sizes

Bytes are decimal, measured from generated files, including host UI, notices, loaders, assets/configuration and retained fallback controls. Readable workbook/guide content is reported separately. The ceiling is 500,000 bytes of standard embedded application content, not total workbook file size. Baseline is the same P&L with the current editor: **349,618 application bytes**, 116,331 document-content bytes, 465,949 total HTML bytes.

| Candidate | Stored standard application bytes | Complete standard HTML | UI bytes delivered separately | Standard budget |
| --- | ---: | ---: | ---: | --- |
| A — Actual IronCalc, lazy CDN | 371,460 | 487,791 | 395,103 decoded JS/CSS; 118,571 actual compressed response bodies | Pass |
| B — Lightweight native alternative | 376,072 | 492,403 | None; 15,890-byte native implementation/icons included in the file | Pass |
| C — Actual IronCalc, compressed inside HTML | 527,289 | 643,620 | None | **Fail: 27,289 bytes over stored ceiling** |

The native prototype includes its applicable static-icon notices; upstream candidates include the wider runtime notices. None hides a new application dependency in an unchecked module graph.

The actual toolbar is **372,390 JS + 22,713 CSS = 395,103 decoded bytes**. Gzip level 9 gives **116,775 bytes**; Base64 stores that as **155,700 bytes**, before inert element/configuration overhead. The shared loader is 3,422 bytes. Upstream attribution text is 14,553 bytes; native icon attribution is 3,278 bytes. These are included in file measurements, not added on top of the table.

For C, replacing the encoded payload with its decoded JS/CSS gives approximately **767 kB of host plus toolbar application content**. Compression therefore does not silently make raw executable code compliant. A future reduction or explicit budget-policy decision would be needed even if stored bytes were trimmed below 500 kB. Native workbook data and the LLM guide remain readable and uncompressed in all candidates.

Actual CDN response compression was Brotli: 114,301 bytes JS + 4,270 bytes CSS. It differs from the local maximum-compression estimate (101,624 bytes Brotli). HTTP headers/transport overhead are separate; recorded Resource Timing/CDP receipts retain them where exposed.

Offline files embed the existing calculation engine as well as UI assets. Complete sizes are 1,599,886 bytes for A's **embedded offline distribution**, 1,448,653 for B, and 1,599,870 for C. A's offline file does not use an offline CDN: its effective toolbar delivery is embedded, explicitly labelled in the file and receipts. Larger offline files are permitted by the existing policy.

## Measured responsiveness

Apple M5, 24 GiB memory, macOS arm64, Chromium 151.0.7922.34. Activation timing starts at the click and ends after mounting plus two animation frames. It excludes initial document opening; B's inline UI code is already parsed when activated. Five fresh browser contexts per candidate, each followed by a same-context cached reopen. Browser/CDN cache states are distinguished; no network or CPU throttling was applied.

| Measurement | First browser load, median | First-load range | Cached reopen, median |
| --- | ---: | ---: | ---: |
| A — Actual Internet CDN | 148 ms | 148–225 ms | 49.6 ms |
| A — Controlled loopback gzip server | 64.9 ms | 62.6–66.4 ms | 48.4 ms |
| B — Lightweight native | 33.9 ms | 31.7–36.1 ms | 33.1 ms |
| C — Embedded upstream | 64.8 ms | 63.4–81.0 ms | 48.3 ms |

Local measurements are retained separately in [local-browser.json](../tools/ribbon-assessment/functional/results/local-browser.json); they are not presented as CDN/WAN performance. They put the lightweight activation around 30–35 ms and the embedded toolbar around 50–70 ms on this machine. The embedded verified-assets wall time includes Base64, gzip decoding and hashing. The `decompressionMs` field sums two overlapping asset-operation timers, so it must not be added to wall-clock stages. `parseExecuteMs`, `mountMs` and activation long-task records are also retained.

An **earlier first exposure to the same immutable CDN asset revision took 1.84 s**, retained in [real-cdn-first-use.json](../tools/ribbon-assessment/functional/results/real-cdn-first-use.json). It came from an earlier loader iteration; the payload hashes are the same. Network/CDN edge state is uncontrolled. The final repeated run above is not a guarantee against slow first loads. The [final real CDN receipt](../tools/ribbon-assessment/functional/results/real-cdn.json) uses actual `file://` HTML, no routes/mocks, and verifies editing plus downloaded-file reopen. Cached asset responses transferred zero body bytes in the measured cache hits; cache persistence/availability is not guaranteed.

P&L edits were also measured after activating each offline toolbar: an engine warm-up then five growth-assumption edits, with the saved revenue checked against an independent geometric-series expectation. The [receipt](../tools/ribbon-assessment/functional/results/pnl-performance.json) records baseline, lightweight and actual upstream results. All remain around 49–50 ms warm maximum with no observed warm main-thread long task. Existing gates (warm P&L <250 ms and main task <100 ms) pass. This is an assessment workload, not a rerun or replacement of the full 50k/100k-row release suite.

## Features, portability and maintenance

| Concern | A — Actual toolbar via CDN | B — Lightweight implementation | C — Actual toolbar embedded |
| --- | --- | --- | --- |
| Appearance | Actual pinned upstream UI and menus, with unsupported controls greyed | Similar compact icon/group design; native format select, not a pixel/interaction clone | Same actual UI as A |
| Supported commands | Undo/redo, clear formatting, currency/percentage/precision, supported number/date presets, conditional-format dialog, grid-line visibility | Same supported command set through the same host handlers | Same as A |
| First use without Internet | Cold toolbar load fails safely; existing editing controls remain usable | Formatting UI available locally; standard calculation edits still need the existing remote engine | Toolbar available locally; standard calculation edits still need the existing remote engine |
| Fully offline distribution | Toolbar and calculation engine embedded explicitly | Native UI plus embedded calculation engine | Toolbar and calculation engine embedded |
| Failed or corrupt load | No unverified asset execution; retry/fallback; workbook and pending edits preserved | No UI asset fetch | Missing gzip-decoding API fails to existing controls; hashes verified before execution |
| Runtime components | React/DOM, i18n, menu/color/icon helpers bundled in a single verified JS/CSS pair | Native DOM, static SVG; React used only by the build to render icons | Same runtime as A plus local gzip decoding |
| Maintenance | Own extracted internal upstream component, pinned dependency updates and source patches/adapters; host toolbar API is not an upstream public package | Own controls/menus, keyboard/focus/responsive behavior and design updates | Same upstream/adapters work as A, plus compression/loader compatibility and larger files |

Unsupported in every candidate: direct manual fonts/emphasis/colors/borders, themes/named styles, alignment/wrapping, merging, links, PNG export and style copying. Existing semantic roles/conditional formatting remain accessible through the fallback editor. No new formatting schema or import feature was added for this experiment.

The extraction changes three upstream files: Toolbar (+29/−27 lines), Menu (+1 line), FormatMenu (+2/−2 lines). Changes gate unsupported commands/custom/long-date formats, block disabled parent menu triggers, label the format menu, add directional keyboard-accessible overflow buttons and observe resize. Exact anchors fail closed on upstream drift. Real tint helpers avoid starting WASM for formatting.

Licences: pinned IronCalc is reused under MIT. Collected runtime dependency/attribution closure has ten MIT/ISC packages (including declared Babel helpers that may be prebundled); full texts accompany samples. The native prototype distributes static Lucide icons with their own complete notice. No paid component is used. `npm audit --prefix tools/ribbon-assessment --omit=dev` reported zero known vulnerabilities at assessment time; that is not a timeless security guarantee.

## Verification and remaining boundary

- 3 focused adapter/helper tests, 116 existing Data unit tests and both existing standard/offline ribbon browser regressions pass. Both formatting checks pass.
- 11 functional/failure browser cases cover the six distributions, menu keyboard/focus, formatting/history, grid-line computed borders, conditional dialog, scenario recalculation, save/reopen, blocked/corrupt/offline/missing-decoder loads, retry and preservation of a failed calculation's attempted input in a saved copy. Offline variants issue zero requests.
- Screenshots/overflow checks at 320/768/1024/1440px cover both visual implementations. Directional overflow buttons activate from the keyboard. Default grid viewport layout is reused after experimental toolbar height changes.
- Independent review found misleading offline-CDN labelling, a grid-line selector missing the hydrated cells and ambiguous overflow labels. All three were corrected and browser-verified. The reviewer found no further material blocker in the experimental integration.

Browser claims are limited to the tested Chromium runtime. Missing `DecompressionStream` is feature-tested and has a fallback check; Safari/Firefox/mobile memory and CPU behavior remain unverified here. Broader release certification stays with the paused release tasks. The source-coupled command bridge and the bounded native visual prototype are experiments, not finished public interfaces.

The next action is the user's choice among A, B and C, including any decision to change C's budget treatment. No default replacement, production CDN release, import resumption or final architecture decision is authorised by completing this report.
