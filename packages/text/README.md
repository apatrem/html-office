# html-text

The html-office alternative to Word, in progress: [specification](../../docs/HTML-TEXT-V1.md), [plan](../../docs/HTML-TEXT-PLAN.md), [ADR-004](../../docs/decisions/004-html-text-format-and-editor.md). The html-text skill ([`plugin/skills/html-text/`](../../plugin/skills/html-text/SKILL.md), T18) ships in the html-slides plugin beside html-slides and html-data.

| Path | Contents |
| --- | --- |
| [`FORMAT.md`](FORMAT.md) | Format reference: the canonical HTML subset, element by element (T01) |
| `model/html.mjs` | Plain HTML tree shared by Node and the browser, and its fixed serialiser |
| `model/parse.mjs` | Node only: parse5 into that tree, with line and column |
| `model/format.mjs` | Vocabulary of the subset |
| `model/validate.mjs` | Validator: errors, protected blocks and warnings |
| `model/file.mjs` | File layout of the canonical form: one zone per line, article#doc from the editor |
| `editor/schema/` | ProseMirror schema of the subset, parser (tree to document), serialiser (document to canonical HTML), `document.mjs` (validated open, save, read-back check) and `guard.mjs` (keeps links off footnotes and cross-references while editing) (T02) |
| `editor/commands.mjs` | Editing commands (T06): paragraph styles, lists, marks, links, alignment, page breaks, stable heading IDs |
| `editor/tables.mjs` | Report tables (T10) on prosemirror-tables: cell selection, rows and columns, merge and split, Tab, header and total rows, row headers, widths, emphasis, density, caption, and the table-shape guard |
| `editor/clipboard/` | Paste and import (T07): `html.mjs` maps pasted HTML (Word, Docs, Excel, Sheets, web pages, Text) onto the subset and counts what it cannot hold; `markdown.mjs` turns CommonMark with tables into HTML for the same mapping; `table.mjs` converts Text tables and ADR-013 portable tables both ways; `entities.mjs` lets the browser decode Markdown character references |
| `editor/markdown.mjs` | Markdown projection (T15): the read-only Markdown view and Markdown export, lossy and one-way (FORMAT.md › Markdown view and export) |
| `runtime/` | The editor (T03): bootstrap (`main.mjs`), variant A shell (`shell.mjs`, shared components, document settings), theme, font, page and margins (`look.mjs`, T04), saving and draft recovery through `packages/shared/persistence.mjs` (`saving.mjs`, T05), clipboard (`clipboard.mjs`, T07: paste, drop, copy, Markdown import), Markdown view and export (`markdown.mjs`, T15), editor-only CSS |
| `theme/` | Default look (T04): `layout.css` is the default `style#theme` (page format, margins, type scale, blocks, tables); `index.mjs` gives it and the default charte to tools and tests |
| `tools/build.mjs` | `node tools/build.mjs <document.html> [<output.html>] [--json]`: builds the editor with its notices into `script#engine` and reports bytes by zone |
| `tools/check.mjs` | `node tools/check.mjs <document.html> [--section <id>] [--json]`; also reports a valid document that is not in canonical form, names each finding's section and what it checked (IDs, cross-references, assets, comment anchors) |
| `tools/pack.mjs` | `node tools/pack.mjs <document.html> [<output.html>]`: rewrites into canonical form and lists changed lines |
| `tools/markdown.mjs` | `node tools/markdown.mjs <document.html> [<output.md>]`: the Markdown export, as the editor writes it (T15) |
| `tools/sections.mjs` | Section tooling (T16): `outline`, `show <id>` and `replace <id> <file>` (FORMAT.md › Section tools); `model/sections.mjs` finds the sections in a source |
| `tools/document.mjs` | The html-text skill's command line (T18): `new`, `pack`, `add-image`, `convert` and `show --markdown` (FORMAT.md › Document tools), with `outline`, `show`, `replace`, `check` and `markdown`. `convert.mjs` (Markdown with block placeholders to the subset), `section-markdown.mjs` (a section as editable Markdown), `previews.mjs` (chart previews drawn in Node), `guide.mjs` (the embedded guide), `node-dom.mjs` (the small DOM they need in Node) |
| `tools/skill.mjs` | Packages the skill into `plugin/skills/html-text/` (bundled `tools/document.mjs`, `assets/engine.json`, ECharts and its notices, default charte and layout, `references/FORMAT.md`, `examples/`); `--check` compares with the committed copy. `tools/release.sh` runs it before zipping; `tests/skill.test.mjs` packages afresh, zips, extracts and runs the workflow with Node alone |
| `examples/` | The skill's examples, also test fixtures: `valid/` (a report in Markdown, its payload map, a section rewrite), `invalid/` (one Markdown file per refusal, `expected.json`) |
| `tools/measure.mjs` | Code budget by component (T17): the built file's application code split by what it embeds, rows adding up to the total (`--write` updates `bench/code-size.json`) |
| `fixtures/valid/` | One fixture per construct; `example.html` is a compact complete document |
| `fixtures/invalid/` | One fixture per rejection; `expected.json` lists each error and its location |
| `fixtures/markdown/` | The Markdown projection of each valid fixture, and `reimport.json`: what importing it back through T07 changes (T15) |
| `fixtures/clipboard/` | Clipboard HTML in the shape Word, Google Docs and web pages write it, and a Markdown report (hand-written, fictional; see FORMAT.md › Paste and Markdown import) |
| `bench/long-document.mjs` | The long fixtures (T16, T17): `bench/fixtures/report-100.html`, about 50,000 words and 50 figures, and `report-50.html` (`--pages 50`), generated deterministically |
| `bench/browser.mjs` | Size and responsiveness benchmark (T17) from `file://`: open, keystroke-to-paint, editing tasks, save, print preview, PDF, memory; `--check` gates the medians (CI, every PR). Results and method: [`bench/RESULTS.md`](bench/RESULTS.md) |
| `tests/generate.mjs` | Seeded random documents for the round-trip properties |

The validator reuses the Slides safety rules (`src/format.js`) and the strict chart schemas (`packages/shared/charts/schema.mjs`). Fixtures are fictional.

```bash
npm ci --prefix packages/text
npm run test:text
node packages/text/tools/build.mjs packages/text/fixtures/valid/example.html
```

The built file (`dist/text/example.html`) opens from `file://`: type, undo and redo, choose the theme, font, page format and margins (Theme & page), Save (Chrome and Edge, File System Access API) or Save a copy (every browser; the only save in Safari and Firefox). Save writes only an empty file or the file as opened, in canonical form; nothing is normalised silently. Unsaved changes are kept as a draft in the browser and offered when the file is reopened.

`TEXT_ENGINES=chromium,firefox,webkit node packages/text/tests/saving-browser.mjs` runs the saving tests in other engines (CI runs Firefox and WebKit); so do `editing-browser.mjs` and `clipboard-browser.mjs`. `node packages/text/tests/print-firefox.mjs` prints to PDF in an installed Firefox over WebDriver BiDi (`FIREFOX=` its path when it is not `/Applications/Firefox.app` or on `PATH`), which Playwright's Firefox cannot do.
