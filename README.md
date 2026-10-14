# html-slides

Create presentations with an LLM, edit them in your browser, and share a single HTML file. Slides contain readable HTML, chart data, a theme, an editor, and a built-in format guide. Export to PDF when needed.

**[Download the plugin](https://github.com/apatrem/html-slides/releases/download/v0.7.0/html-slides.plugin)** · **[Skill instructions](plugin/skills/html-slides/SKILL.md)** · **[Format reference](plugin/skills/html-slides/references/FORMAT.md)**

Open [the community garden example](https://github.com/apatrem/html-slides/releases/download/v0.7.0/community-garden.html) or [the visual catalogue](https://github.com/apatrem/html-slides/releases/download/v0.7.0/catalogue.html) by downloading the HTML file and opening it in Chrome or Edge. Click **Edit**, double-click text to change it, drag elements to move them, and press **Cmd/Ctrl+S** to save. No plugin is needed to open or edit a generated deck.

All examples use fictional, clearly labelled data. They contain no client material. The project is licensed under MIT; bundled dependencies retain their own licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## What it does

- Insert, duplicate, delete, and reorder slides; add text, shapes, images, tables, and charts.
- Use named layouts and theme colours; align, distribute, resize, and format elements.
- Edit seven chart types: columns, horizontal bars, stacked bars, lines, waterfall, bubbles, and Gantt.
- Save one HTML file, present it full screen, and export a PDF.
- Preserve content, assets, identifiers, order, and manual placement when an LLM makes targeted edits.
- Read the editing contract directly from the HTML or from **Help → File format**. Compatible repository, documentation, and skill download links are included.

New decks use English UI, templates, and documentation. The HTML format remains version 1. Existing content is preserved by the explicit `upgrade` command.

## Use the skill or the tools

The release archive contains the `html-slides` skill, references, rendering tools, built assets, and examples. It can be used as a Claude plugin or as a skill folder by an agent that supports `SKILL.md`. See [plugin/README.md](plugin/README.md). Rendering tools require Node.js 18+ and Playwright **1.62.1** with Chromium; the HTML parser is bundled.

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

The checker parses inert HTML before running it and accepts only recognised engine scripts. `--since` detects unrequested deletions, reordering, layout, position, and geometry changes. `--allow e12,e13` permits specific elements; `--allow s04` permits recomposing a slide. It does not verify the provenance of figures or replace visual review.

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

| Folder | Purpose |
| --- | --- |
| `src/engine/` | DOM operations, history, serialisation, editor, thumbnails, and chart rendering |
| `src/charts/` | One module per chart type |
| `src/theme/` | Layouts and CSS theme variables |
| `src/guide.md`, `src/format.js` | Embedded guide and shared format contract |
| `src/echarts.js` | Approved ECharts version, URL, and SRI digest |
| `src/distribution.json` | HTTPS links to a compatible release |
| `tools/` | Build, documentation generation, validation, and packaging |
| `tests/` | Chart, preservation, persistence, thumbnails, guide, SRI, and editor checks |
| `plugin/` | Distributable skill/plugin with built assets |
| `decks/` | Fictional English examples, their source content, and PDFs |
| `docs/` | [V1 plan](docs/PLAN.md), decisions, and [validation status](docs/VALIDATION-V1.md) |

Add a chart in `src/charts/<type>.js` with `label`, `validate`, `table`, and `toOption`; register it in `src/engine/charts.js`, document it in `references/CHARTS.md`, and test invalid inputs. To customise branding, copy `src/theme/charte-pierre.css` and pass `--charte your-theme.css`. Do not use `--x`, `--y`, `--w`, or `--h` as theme variable names: they store element geometry.

Distribution links are versioned in `src/distribution.json`; documentation and downloads must point to a compatible release. Format versioning is independent of engine versioning. Generated assets are committed so the downloaded skill can run without a build step.

## V1 limits

- Direct file saving uses Chrome/Edge's file picker; Safari/Firefox download a copy. The first direct save requires choosing the target file.
- Drafts include content, deck metadata, and assets. Edits made during a save remain dirty; cancelled or failed saves retain the draft. Large drafts may exceed browser storage capacity.
- The V1 model uses DOM operations and HTML snapshots. Collaboration requires a new mutation model in V2.
- No attached connectors, rotation, merged table cells, arbitrary fonts/colours, or PPTX export. Outline-only shapes work on rectangles, rounded rectangles, and ellipses.
- Cross-device manual tests, five real-use comparisons, and the context-free LLM test are still pending. See the validation log; automated checks do not establish these outcomes.
