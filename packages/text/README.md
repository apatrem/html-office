# html-text

The html-office alternative to Word, in progress: [specification](../../docs/HTML-TEXT-V1.md), [plan](../../docs/HTML-TEXT-PLAN.md), [ADR-004](../../docs/decisions/004-html-text-format-and-editor.md). Not part of the plugin yet.

| Path | Contents |
| --- | --- |
| [`FORMAT.md`](FORMAT.md) | Format reference: the canonical HTML subset, element by element (T01) |
| `model/html.mjs` | Plain HTML tree shared by Node and the browser, and its fixed serialiser |
| `model/parse.mjs` | Node only: parse5 into that tree, with line and column |
| `model/format.mjs` | Vocabulary of the subset |
| `model/validate.mjs` | Validator: errors, protected blocks and warnings |
| `tools/check.mjs` | `node tools/check.mjs <document.html> [--json]` |
| `fixtures/valid/` | One fixture per construct; `example.html` is a compact complete document |
| `fixtures/invalid/` | One fixture per rejection; `expected.json` lists each error and its location |

The validator reuses the Slides safety rules (`src/format.js`) and the strict chart schemas (`packages/shared/charts/schema.mjs`). Fixtures are fictional.

```bash
npm ci --prefix packages/text
npm run test:text
```
