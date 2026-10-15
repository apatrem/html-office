# html-slides plugin in html-office

The currently released plugin contains the `html-slides` skill. Data and Text skills are not included yet; see the [Office V1 specification](https://github.com/apatrem/html-office/blob/main/docs/HTML-OFFICE-V1.md). The plugin identifier and archive filename remain `html-slides` for compatibility.

A skill for creating and editing a presentation in one HTML file. The file includes semantic slides, theme variables, JSON chart data, cached SVGs, a browser editor, and a self-contained editing guide.

## Get started

Download `html-slides.plugin` from the [0.7.1 release](https://github.com/apatrem/html-office/releases/tag/v0.7.1). It is a ZIP archive containing `.claude-plugin/plugin.json` and `skills/html-slides/`. For an agent that supports skill folders, extract it and use `skills/html-slides/SKILL.md` as the entry point. The agent needs access to the whole skill directory, including assets and tools.

Ask your agent: “Create an html-slides presentation about organising a community garden.” It prepares the storyline, builds the HTML/PDF, checks the slides, and reviews the screenshots.

Open the HTML in Chrome or Edge. Click **Edit**, use the top toolbar to insert elements, the context toolbar to format them, and the left thumbnails to navigate or reorder. **Cmd/Ctrl+S** saves; **?** opens keyboard shortcuts and the **File format** guide. The generated file works without the plugin.

## Agent-side requirements

Node.js 18+ and Playwright 1.62.1 with Chromium. From a repository checkout, use `npm ci` and `npx playwright install chromium`. For a standalone skill folder, install Playwright with `npm install -g playwright@1.62.1 && npx playwright install chromium`. The inert HTML parser is bundled. Recipients need only a browser.

## Behaviour and limitations

The guide, catalogue, chart schemas, and compatible download links are embedded in each new HTML. They survive saving. `upgrade` explicitly updates the engine and guide with a backup; `pack` preserves them. Theme changes require `--theme` or `--charte`.

Drafts preserve content, footer metadata, and assets. Edits made while saving remain unsaved; write failures and picker cancellation retain the draft. The first direct save requires selecting a file. Safari/Firefox download a copy.

The checker rejects active content and unknown engines before rendering. `check --since before.html` detects unrequested deletions, reordering, layout, and geometry changes. `--allow e12,e13` permits specified elements; `--allow s04` permits a whole slide.

ECharts 6.1.0 is fetched from jsDelivr on opening decks with charts unless embedded. SRI SHA-384 and anonymous CORS verify the response before execution. Cached SVGs remain readable if loading fails. `pack --offline` embeds ECharts for offline chart editing. Skill installation and updates never happen automatically.

V1 uses DOM snapshots; real-time collaboration and signed updates remain future work. Examples contain fictional, non-client data only.

## Contents

- `skills/html-slides/SKILL.md`: creation/editing workflow and writing rules.
- `references/`: HTML format, visual catalogue, and charts.
- `assets/`: engine, theme, default branding, template, embedded guide, and ECharts.
- `tools/`: `deck.mjs`, `check.mjs`, and the bundled inert parser.
- `examples/`: community garden presentation and visual catalogue.

MIT licence. Dependencies retain their licences: Moveable/Selecto (MIT), ECharts (Apache-2.0), and the tool parser. See `THIRD_PARTY_NOTICES.md`.
