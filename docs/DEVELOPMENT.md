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

`npm run release` rebuilds assets, regenerates both HTML/PDF examples, checks their geometry, runs the regression suite and browser editor tests, and creates `dist/html-slides.plugin`.

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
| `docs/` | [Office V1 specification](HTML-OFFICE-V1.md), [Data implementation plan](HTML-DATA-PLAN.md), [Text V1 specification](HTML-TEXT-V1.md), [Text implementation plan](HTML-TEXT-PLAN.md), [engine stress test](ENGINE-STRESS-TEST.md), [Slides V1 plan](PLAN.md), decisions, and [Slides validation status](VALIDATION-V1.md) |

Add a chart in `packages/shared/charts/types/<type>.mjs` with `label`, `validate`, `table`, and `toOption`; register it in `packages/shared/charts/index.mjs`, document it in `references/CHARTS.md`, and test invalid inputs. To customise branding, copy `src/theme/default.css` and pass `--charte your-theme.css`. Do not use `--x`, `--y`, `--w`, or `--h` as theme variable names: they store element geometry.

Distribution links are versioned in `src/distribution.json`; documentation and downloads must point to a compatible release. Format versioning is independent of engine versioning. Generated assets are committed so the downloaded skill can run without a build step.

## V1 limits

- Direct file saving uses Chrome/Edge's file picker; Safari/Firefox download a copy. The first direct save requires choosing the target file.
- Drafts include content, deck metadata, and assets. Edits made during a save remain dirty; cancelled or failed saves retain the draft. The download fallback (Safari/Firefox) leaves the opened file unchanged, so its draft is kept. A draft recognises the opened file and the content actually written by a successful save, including Save As and edits made during writing. After an unrelated version replaces the file at the same path, restoring is offered with an explicit warning. Restored drafts are stripped of code and external resources. Large drafts may exceed browser storage capacity.
- The V1 model uses DOM operations and HTML snapshots. Collaboration requires a new mutation model in V2.
- No attached connectors, rotation, merged table cells, arbitrary fonts/colours, or PPTX export. Outline-only shapes work on rectangles, rounded rectangles, and ellipses.
- Cross-device manual tests, five real-use comparisons, and the context-free LLM test are still pending. See the validation log; automated checks do not establish these outcomes.
