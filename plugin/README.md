# html-slides plugin in html-office

The plugin contains two skills: `html-slides` (presentations) and, from the release after 0.7.1, `html-data` (spreadsheet workbooks). Text is not included yet; the roadmap is in the [html-office repository](https://github.com/apatrem/html-office) under `docs/HTML-OFFICE-V1.md`. The plugin identifier and archive filename remain `html-slides` for compatibility.

A skill for creating and editing a presentation in one HTML file. The file includes semantic slides, theme variables, JSON chart data, cached SVGs, a browser editor, and a self-contained editing guide.

## Get started

Download `html-slides.plugin` from the [0.7.1 release](https://github.com/apatrem/html-office/releases/tag/v0.7.1). It is a ZIP archive containing `.claude-plugin/plugin.json` and `skills/html-slides/`. For an agent that supports skill folders, extract it and use `skills/html-slides/SKILL.md` as the entry point. The agent needs access to the whole skill directory, including assets and tools.

Ask your agent: “Create an html-slides presentation about organising a community garden.” In an environment with the required tools, it prepares the storyline, builds the HTML/PDF, checks the slides, and reviews the screenshots.

Open the HTML in Chrome or Edge. Click **Edit**, use the top toolbar to insert elements, the context toolbar to format them, and the left thumbnails to navigate or reorder. **Cmd/Ctrl+S** saves; **?** opens keyboard shortcuts and the **File format** guide. The generated file works without the plugin.

## Do I need to install developer tools?

**To open, edit or share a finished presentation: no.** You need only the HTML file and a browser.

**To have the assistant generate and check a presentation:** the current scripts need Node.js 18+ in the assistant's execution environment. Rendering charts, exporting PDF, taking screenshots and running the checker also need Playwright 1.62.1 with Chromium. npm handles dependency installation and global package lookup; it is not part of editing the finished file. Existing local dependencies can be reused.

Claude Desktop and ChatGPT Desktop are the intended experience for nontechnical users. Their built-in browsers can support visual inspection, but the current scripts launch their own browser through Playwright. Installing the skill alone does not configure those dependencies, and the complete workflow in either desktop app is not yet validated. If the assistant cannot run the tools, it should explain the missing capability rather than present an unchecked file as verified.

Runtime setup and terminal commands are in the [developer guide](https://github.com/apatrem/html-office/blob/main/docs/DEVELOPMENT.md). They are for maintainers or whoever configures the assistant's environment.

## Behaviour and limitations

The guide, catalogue, chart schemas, and compatible download links are embedded in each new HTML. They survive saving. `upgrade` explicitly updates the engine and guide with a backup; `pack` preserves them. Theme changes require `--theme` or `--charte`.

Drafts preserve content, footer metadata, and assets. Edits made while saving remain unsaved; write failures and picker cancellation retain the draft. The first direct save requires selecting a file. Safari/Firefox download a copy.

The checker rejects active content and unknown engines before rendering. `check --since before.html` detects unrequested deletions, reordering, layout, and geometry changes. `--allow e12,e13` permits specified elements; `--allow s04` permits a whole slide.

ECharts 6.1.0 is fetched from jsDelivr on opening decks with charts unless embedded. SRI SHA-384 and anonymous CORS verify the response before execution. Cached SVGs remain readable if loading fails. `pack --offline` embeds ECharts for offline chart editing. Skill installation and updates never happen automatically.

V1 uses DOM snapshots; real-time collaboration and signed updates remain future work. Examples contain fictional, non-client data only.

## html-data: workbooks in one HTML file

`skills/html-data/SKILL.md` creates and edits workbooks: one HTML file holding a readable JSON workbook (typed inputs, formulas with their saved results, formats, scenarios, dropdowns, conditional formatting, pivot tables and charts) and an editor that calculates with IronCalc. Ask your agent: “Create an html-data budget for a small event with a Base and a Busy scenario.”

The assistant needs only Node.js 18+ in its execution environment: `skills/html-data/tools/workbook.mjs` is self-contained (bundled; no npm install, no browser) and creates, inspects, patches, recalculates and validates workbooks. Every patch is validated before it is applied, and the tool refuses any change outside it. Recipients need only the HTML file and a browser; Chrome or Edge to save in place. Standard files load the pinned, digest-checked IronCalc engine on the first calculation-changing edit; `--offline` files embed it.

## Contents

- `skills/html-slides/SKILL.md`: creation/editing workflow and writing rules.
- `references/`: HTML format, visual catalogue, and charts.
- `assets/`: engine, theme, default branding, template, embedded guide, and ECharts.
- `tools/`: `deck.mjs`, `check.mjs`, and the bundled inert parser.
- `examples/`: community garden presentation and visual catalogue.
- `skills/html-data/`: `SKILL.md`, `tools/workbook.mjs`, `references/FORMAT.md` (format, tools and patches), `examples/` (valid and invalid workbooks and patches, also the test fixtures), the precompiled editor (`assets/runtime.json`), ECharts, the pinned IronCalc engine (`engine/`) and the pinned SheetJS reader that offline workbooks embed for XLSX import (`vendor/xlsx/`).

MIT licence. Dependencies retain their licences: Moveable/Selecto (MIT), ECharts (Apache-2.0), IronCalc with its Rust dependencies and SheetJS CE (Apache-2.0), both in html-data, and the tool parser. See `THIRD_PARTY_NOTICES.md` and `skills/html-data/assets/THIRD-PARTY-NOTICES.txt`.
