# Development and agent runtime

This guide is for maintainers and people configuring an assistant's execution environment. Users who open, edit or share a finished HTML file need only a browser.

## What actually requires an installation?

| Operation | Node.js | Playwright + Chromium | npm |
| --- | --- | --- | --- |
| Open, edit, save or present a finished HTML | No | No | No |
| Create HTML, extract/inject content, upgrade, add images | Yes | No | Only if an optional dependency needs installation or global lookup |
| Pack charts, export PDF with the tools, run the checker or capture screenshots | Yes | Yes | Installation and global package lookup when local packages are unavailable |
| Develop, test or package a release | Yes | Yes | Yes, for the documented repository workflow |

The scripts use Node.js 18+; browser operations load exactly Playwright 1.62.1 and launch its Chromium. The HTML parser and built assets are bundled, so an extracted skill does not need the repository build. With Playwright resolved locally and its Chromium already installed, normal rendering does not invoke npm. The global-package fallback calls `npm root -g`. Image resizing can also look up an optional package globally.

These are requirements of the assistant's execution environment, which may be separate from the user's computer. Reuse installed dependencies first. A missing runtime is a setup limitation; do not send nontechnical users a terminal installation checklist as the default onboarding.

## Desktop browsers and compatibility

[ChatGPT's built-in browser](https://learn.chatgpt.com/docs/browser) supports page inspection and screenshots. [Claude Cowork](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork) also provides browser interaction. Those capabilities can support visual review when the generated file is accessible to the app.

The current tools do not connect to either app's browser: `openDeck()` in `plugin/skills/html-slides/tools/lib.mjs` launches Chromium through Playwright, and `pack`, `pdf` and `check` call it. Merely having a built-in browser does not satisfy that dependency. Native visual inspection alone also does not run the checker's preservation, geometry and inert HTML checks.

The intended desktop experience is to add the skill, describe the document and receive a finished file without manual developer setup. That complete workflow still needs validation in Claude Desktop and ChatGPT Desktop. Replacing Playwright requires a supported browser execution path that preserves the existing checks, chart caching and PDF output; documentation changes alone do not provide one.

## Repository naming

The repository was renamed from `html-slides` to `html-office`. The existing skill/plugin identifier, slide format, commands, and released `html-slides.plugin` filename are retained. The existing folders remain in place; moving them and changing the plugin identifier require compatibility work. For a checkout using the previous remote, run `git remote set-url origin https://github.com/apatrem/html-office.git`.

## Use the skill or the tools

The release archive contains the `html-slides` skill, references, rendering tools, built assets, and examples. It can be used as a Claude plugin or as a skill folder by an agent that supports `SKILL.md`. See [plugin/README.md](../plugin/README.md). Rendering tools require Node.js 18+ and Playwright **1.62.1** with Chromium; the HTML parser is bundled.

```bash
npm ci
npx playwright install chromium
T=plugin/skills/html-slides/tools
node $T/deck.mjs new deck.html --title "My presentation" --footer "Discussion draft" --content content.html
node $T/deck.mjs pack deck.html --pdf deck.pdf
node $T/check.mjs deck.html --shots work/shots
node $T/deck.mjs extract deck.html --out work/extracted
node $T/deck.mjs inject deck.html work/extracted/content.html
node $T/check.mjs deck.html --since before.html --allow e12
```

`pack` preserves the engine, theme, and guide. `upgrade deck.html` updates the engine and its guide explicitly, creates a `.bak` backup, and keeps the theme unless `--theme` is requested. Review before/after screenshots when changing a theme. Failed validation or rendering leaves existing pack outputs intact.

For a standalone extracted skill, configure its execution environment with Playwright 1.62.1 and Chromium. If global installation is appropriate for that environment, the existing fallback supports `npm install -g playwright@1.62.1` followed by `npx playwright install chromium`. This is an environment setup option, not a required action for the person using the presentation.

The checker parses inert HTML before running it and accepts only recognised engine scripts. CSS resource checks decode escapes and inspect every image candidate; dynamic URL substitution is rejected. `--since` detects unrequested deletions, reordering, layout, position, and geometry changes. `--allow e12,e13` permits specific elements; `--allow s04` permits recomposing a slide. It does not verify the provenance of figures or replace visual review.

### html-data

The `html-data` skill needs only Node.js 18+: `plugin/skills/html-data/tools/workbook.mjs` is bundled and carries no dependency.

```bash
T=plugin/skills/html-data/tools
node $T/workbook.mjs new budget.html --model plugin/skills/html-data/examples/valid/budget.json
node $T/workbook.mjs inspect budget.html --range "Budget!A1:D4"
node $T/workbook.mjs apply budget.html patch.json --out budget-2.html
node $T/workbook.mjs validate budget-2.html --since budget.html --allow "Inputs!B4"
```

The skill is generated from `packages/data` by `node packages/data/tools/skill.mjs` (also run by `npm run release`); `--check` reports whether the committed copy still matches its sources. `packages/data/tests/skill.test.mjs` packages the skill afresh, zips the plugin and tests the extracted archive, so other Data changes never fail on a stale committed copy. Only `SKILL.md` is written by hand; regenerate the rest before a release (release.sh does it).

### html-text

The `html-text` skill likewise needs only Node.js 18+: `plugin/skills/html-text/tools/document.mjs` is bundled. See its [SKILL.md](../plugin/skills/html-text/SKILL.md) for the passes.

```bash
T=plugin/skills/html-text/tools
node $T/document.mjs new report.html --markdown body.md --payloads payloads.json --title "Report" --contents 2 --numbers
node $T/document.mjs outline report.html
node $T/document.mjs show report.html sec-regions --markdown > section.md
node $T/document.mjs convert report.html sec-regions section.md --out section.html
node $T/document.mjs replace report.html sec-regions section.html --output edited.html
node $T/document.mjs check edited.html
```

`pack` and `add-image` are described in the skill. The skill is generated from `packages/text` by `node packages/text/tools/skill.mjs` (`--check` compares it with the committed copy); regenerate it after changing the Text tools, runtime or shared charts.

### Manual checks

`bash tools/manual-check-files.sh` builds the files that [MANUAL-CHECKS.md](MANUAL-CHECKS.md) opens into `dist/latest/`.

## Network and offline use

Cached chart SVGs remain readable offline. Without an embedded library, a deck with charts requests **ECharts 6.1.0 from jsDelivr** when opened. The browser checks the pinned SHA-384 SRI digest using anonymous CORS before executing it. A rejected or unavailable response leaves cached SVGs visible; chart recalculation then requires the library.

Use `deck.mjs pack deck.html --offline` to embed ECharts and edit charts offline (about 1.1 MB extra). Opening the HTML never installs or updates the skill automatically. Embedded links are optional to follow.

## Develop

```bash
npm ci
npx playwright install chromium
npm run build
npm test
npm run release
```

`npm run release` rebuilds assets, regenerates both HTML/PDF examples, checks their geometry, runs the regression suite and browser editor tests, and creates `dist/html-slides.plugin`. The archive holds the `html-slides` skill only; it also regenerates the `html-data` and `html-text` skills in `plugin/skills/`, which join the archive after their blind tests, and fails if the archive holds any other skill.

The checker trusts the engines listed in `src/released-engines.json` plus the engine of the current build. After publishing a version, run `npm run record-release` and commit `src/released-engines.json` so that later versions keep accepting decks made with it. Recording refuses a version that was already published with a different engine.

| Folder | Purpose |
| --- | --- |
| `src/engine/` | DOM operations, history, serialisation, editor and thumbnails |
| `packages/shared/charts/` | Chart contract shared by Slides, Data and Text: type registry, validation, ECharts options, the pinned ECharts loader and SVG preview capture |
| `src/theme/` | Layouts and CSS theme variables |
| `src/guide.md`, `src/format.js` | Embedded guide and shared format contract |
| `packages/shared/charts/echarts.mjs` | Approved ECharts version, URL, and SRI digest |
| `src/distribution.json` | HTTPS links to a compatible release |
| `src/released-engines.json` | Digests of published engines accepted by the checker |
| `tools/` | Build, documentation generation, validation, and packaging |
| `tests/` | Chart, preservation, persistence, thumbnails, guide, SRI, and editor checks |
| `plugin/` | Distributable skill/plugin with built assets and the generated examples |
| `decks/` | Source content of the fictional examples; `npm run release` generates their HTML, PDF and screenshots here (not tracked) |
| `packages/data/` | html-data: model, runtime, tools, engine, acceptance workbook; skill generated into `plugin/skills/html-data/` ([README](../packages/data/README.md)) |
| `packages/text/` | html-text: format, editor, tools, acceptance report; skill generated into `plugin/skills/html-text/` ([README](../packages/text/README.md)) |
| `docs/` | [Status per product](STATUS.md), [decisions and their index](decisions/README.md), [blind tests](blind-tests/README.md), [manual checks](MANUAL-CHECKS.md), [Office V1 specification](HTML-OFFICE-V1.md), [Data implementation plan](HTML-DATA-PLAN.md), [Text V1 specification](HTML-TEXT-V1.md), [Text implementation plan](HTML-TEXT-PLAN.md), [engine stress test](ENGINE-STRESS-TEST.md), [Slides V1 plan](PLAN.md), decisions, and [Slides validation status](VALIDATION-V1.md) |

Add a chart in `packages/shared/charts/types/<type>.mjs` with `label`, `validate`, `table`, and `toOption`; register it in `packages/shared/charts/index.mjs`, document it in `references/CHARTS.md`, and test invalid inputs. To customise branding, copy `src/theme/default.css` and pass `--charte your-theme.css`. Do not use `--x`, `--y`, `--w`, or `--h` as theme variable names: they store element geometry.

Distribution links are versioned in `src/distribution.json`; documentation and downloads must point to a compatible release. Format versioning is independent of engine versioning. Generated assets are committed so the downloaded skill can run without a build step.

## Continuous integration

One workflow, [`.github/workflows/test.yml`](../.github/workflows/test.yml), runs on pull requests to `main`, on pushes to `main` and on demand. A new push to a pull request cancels its previous run; a push to `main` always keeps its own. Its seven jobs run side by side:

| Job | What it gates | Locally |
| --- | --- | --- |
| `test` | Slides and shared code in Chromium; `npm audit`; the committed Slides assets match a fresh build; the distributed examples pass the checker; the pinned engine assessment (on pull requests, only when `tools/engine-assessment/` or the workflow changes) | `npm run build && git status --short plugin/skills/html-slides`, `npm test` |
| `data-phase-a` | Data unit and browser suites in Chromium; `npm audit` (also for the engine toolchain and the storage assessment); formatting; the committed `html-data` skill matches its sources | `npm run test:data`, `node packages/data/tools/skill.mjs --check` |
| `data-bench` | The P&L and 50k/100k-row workloads against their limits | `npm --prefix packages/data run bench` |
| `text` | Text unit and browser suites in Chromium; `npm audit`; formatting; the committed `html-text` skill matches its sources; the 50- and 100-page benchmark | `npm run test:text`, `node packages/text/tools/skill.mjs --check` |
| `blind-kits` | Each blind-test kit is built and scores good and faulty answers (Data T22, Text T20); Node only, nothing installed | `node --test packages/data/tests/blind-kit.test.mjs packages/text/tests/blind-kit.test.mjs` |
| `clipboard-engines` | The shared clipboard in Chromium, Firefox and WebKit; the Slides clipboard, table and save scripts and Data's save script in Firefox and WebKit (their Chromium run is in `test` and `data-phase-a`); the Data acceptance workbook in the three engines | `CLIPBOARD_ENGINES=… node tests/slides-clipboard.mjs`, and so on |
| `text-engines` | Text's browser scripts and benchmark in Firefox and WebKit; print to PDF in the runner's Firefox | `TEXT_ENGINES=firefox,webkit node packages/text/tests/saving-browser.mjs`, and so on |

Three rules keep a check from disappearing unnoticed; `tests/ci.test.mjs` (part of `npm test`) reads the workflow and enforces them:

- **Engines.** Browser scripts take their engines from a variable and default to Chromium, so a step without its variable would still pass. The engines jobs set the variables once, for the whole job; every script gets its list from `engineList()` in [`tests/helpers/engines.mjs`](../tests/helpers/engines.mjs), which records it in CI; and the last step of each job (`node tests/helpers/engines.mjs firefox webkit`) fails if a script ran without one of them. A new script that calls `engineList()` must be added to its engines job.
- **Test files.** Every `tests/*.test.mjs` and `*-browser.mjs` is named in a package script or in the workflow, and every gate in the table above is still in its job.
- **Generated files and the version.** A stale Slides asset or generated skill fails its job. `tests/tools.test.mjs` checks that `package.json`, `package-lock.json`, `plugin/.claude-plugin/plugin.json` and the two URLs of `src/distribution.json` carry one version, and that `src/released-engines.json` records it or, while a release is being prepared, the version just before it.

The blind-kit score tests are about 90 short tool calls per kit. They are part of `npm run test:data` and `npm run test:text` everywhere except in the `data-phase-a` and `text` jobs, which set `BLIND_KIT=own-job` and leave them to `blind-kits`.

Binaryen (for `packages/data/engine/rebuild.sh`) and the tokenizer of the storage assessment are pinned in lock files of their own (`packages/data/engine/toolchain/`, `packages/data/bench/storage/`) and are installed only to rebuild the engine or repeat the assessment; `npm ci --prefix packages/data --ignore-scripts` installs about 16 MB.

## V1 limits

- Direct file saving uses Chrome/Edge's file picker; Safari/Firefox download a copy. The first direct save requires choosing the target file; choosing the opened file remembers it, and later saves (also after reopening it) reuse it only while it still holds the opened document.
- Drafts include content, deck metadata, and assets. Edits made during a save remain dirty; cancelled or failed saves retain the draft. The download fallback (Safari/Firefox) leaves the opened file unchanged, so its draft is kept. A draft recognises the opened file and the content actually written by a successful save, including Save As and edits made during writing. After an unrelated version replaces the file at the same path, restoring is offered with an explicit warning. Restored drafts are stripped of code and external resources. Large drafts may exceed browser storage capacity.
- The V1 model uses DOM operations and HTML snapshots. Collaboration requires a new mutation model in V2.
- No attached connectors, rotation, arbitrary fonts/colours, or PPTX export. Merged table cells arrive by pasting a table and can be unmerged; the editor has no merge command. Outline-only shapes work on rectangles, rounded rectangles, and ellipses.
- Cross-device manual tests, five real-use comparisons, and the context-free LLM test are still pending. See the validation log; automated checks do not establish these outcomes.
