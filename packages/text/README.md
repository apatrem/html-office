# html-text

The html-office alternative to Word, in progress: [specification](../../docs/HTML-TEXT-V1.md), [plan](../../docs/HTML-TEXT-PLAN.md), [ADR-004](../../docs/decisions/004-html-text-format-and-editor.md). Not part of the plugin yet.

| Path | Contents |
| --- | --- |
| [`FORMAT.md`](FORMAT.md) | Format reference: the canonical HTML subset, element by element (T01) |
| `model/html.mjs` | Plain HTML tree shared by Node and the browser, and its fixed serialiser |
| `model/parse.mjs` | Node only: parse5 into that tree, with line and column |
| `model/format.mjs` | Vocabulary of the subset |
| `model/validate.mjs` | Validator: errors, protected blocks and warnings |
| `model/file.mjs` | File layout of the canonical form: one zone per line, article#doc from the editor |
| `editor/schema/` | ProseMirror schema of the subset, parser (tree to document), serialiser (document to canonical HTML), `document.mjs` (validated open, save, read-back check) and `guard.mjs` (keeps links off footnotes and cross-references while editing) (T02) |
| `runtime/` | The editor (T03): bootstrap (`main.mjs`), variant A shell (`shell.mjs`, shared components), saving through `packages/shared/persistence.mjs` (`saving.mjs`), editor-only CSS |
| `tools/build.mjs` | `node tools/build.mjs <document.html> [<output.html>] [--json]`: builds the editor with its notices into `script#engine` and reports bytes by zone |
| `tools/check.mjs` | `node tools/check.mjs <document.html> [--json]`; also reports a valid document that is not in canonical form |
| `tools/pack.mjs` | `node tools/pack.mjs <document.html> [<output.html>]`: rewrites into canonical form and lists changed lines |
| `tools/measure.mjs` | Code budget by component (`--write` updates `bench/code-size.json`) |
| `fixtures/valid/` | One fixture per construct; `example.html` is a compact complete document |
| `fixtures/invalid/` | One fixture per rejection; `expected.json` lists each error and its location |
| `tests/generate.mjs` | Seeded random documents for the round-trip properties |

The validator reuses the Slides safety rules (`src/format.js`) and the strict chart schemas (`packages/shared/charts/schema.mjs`). Fixtures are fictional.

```bash
npm ci --prefix packages/text
npm run test:text
node packages/text/tools/build.mjs packages/text/fixtures/valid/example.html
```

The built file (`dist/text/example.html`) opens from `file://`: type, undo and redo, Save (Chrome and Edge, File System Access API) or Save a copy. Save writes only an empty file or the file as opened, in canonical form; nothing is normalised silently.
