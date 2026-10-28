# Shared clipboard module

The cross-product clipboard of html-office, from [ADR-013](../../../docs/decisions/013-cross-product-clipboard.md) (task X02a). Each product bundles it into its own runtime: Data (X02a), Slides (X02b, [`src/engine/clipboard.js`](../../../src/engine/clipboard.js)) and Text (T07, [`packages/text/runtime/clipboard.mjs`](../../text/runtime/clipboard.mjs)). It has no dependencies and no DOM access outside `parseInert`.

| File | Contents |
| --- | --- |
| `envelope.mjs` | `html-office-clip/1`: `SCHEMA`, the carriers (`MIME`, the `data-html-office` `ATTRIBUTE`, Data's read-only `LEGACY_MIME`), `LIMITS`, `decodeEnvelope` / `checkEnvelope` / `encodeEnvelope` |
| `table.mjs` | The portable table model (§3): vocabulary (`TEXT_COLORS`, `FILLS`, `CELL_STYLES`), `validateTable`, and TSV (`toTSV`, `tableText`, and `fromTSV`, which reads Excel's quoting back with a cell bound) |
| `read.mjs` | `readClipboard` (reader precedence), `parseInert` (a detached `<template>`), `findEnvelope`, `readTable` (the HTML table reader), `readTableElement` (one table of a larger fragment, with its cell elements on request), and the style helpers `classRules`, `declarations`, `hidden`, `weight`, `slant` |
| `write.mjs` | `writeClipboard` (every flavour from one `copy` event), `tableHTML` (semantic table with literal charte styles and Excel/Sheets exact-value hints), `figureHTML` (a chart's picture and caption, X02c), `excelFormat` |
| `errors.mjs` | `ClipboardError`, allow-listed field checks, `safeURL` |
| `fixtures/` | Excel, Google Sheets, Word and Google Docs table HTML (see its README) |

## Reading

`readClipboard(dataTransfer, { maxCells })` returns the first usable carrier:

1. `envelope` from `application/x-html-office+json` (`via: "custom"`);
2. `envelope` from the first `[data-html-office]` element of `text/html` (`via: "html"`);
3. `legacy`: Data's bare `html-office-range/1` from before X02a;
4. `table`: the one table of `text/html`, when the fragment holds a single table and no text outside it;
5. `text`: `text/plain`;
6. `none`.

An envelope with another `schema` string is skipped with a message in `notices`. A recognised envelope that is malformed, over a limit or unsafe throws a `ClipboardError`: the paste is aborted, never continued with displayed values. `text/html` over 8 Mi code units is treated as absent; other flavours over their limits throw.

A `rowspan` stops at the end of its row group (`thead`, each `tbody`, `tfoot`), as HTML lays it out; `rowspan="0"` runs to that end.

Text reads a whole pasted fragment, not only a lone table: `readTableElement(table, { rules, sources })` reads one `<table>` of it with the fragment's class rules, and `sources` receives each cell element, so Text maps cell text with its own inline marks while the reader decides the grid.

The table reader keeps displayed text (white space collapsed, `<br>` and blocks as line breaks), `th`/`thead` header rows, `colspan`/`rowspan` (HTML's own limits, and the expanded size checked against `maxCells` before any grid is allocated), bold and italic from tags, inline styles and the fragment's own class rules, cell or paragraph alignment, and `https:`, `http:` and `mailto:` links. Mixed formatting becomes `runs`. Colours, fonts and every other literal style are dropped: pasted content takes the destination's charte. Script, style, template, hidden elements and comments are never text. Exact-value hints (`x:num`, `data-sheets-value`) are not read.

## Writing

`writeClipboard(event.clipboardData, { envelope, table, text, stringify, html })` sets the custom type, `text/html` and `text/plain`. `text/html` is left out above 20,000 cells or 8 Mi code units; the envelope and the text cannot be, so the copy fails with a message instead. `html.css(cell, row, column)` supplies the literal styles resolved from the source's charte (Data reads them from probes styled like its grid cells); without it, only bold, italic and alignment are written.

Data includes the portable `table` in its envelope up to the same 20,000 cells; above that the envelope carries only the `range`, which other products cannot read, and they fall back to `text/plain`.

## Tests

- `tests/clipboard.test.mjs` (root): the module in Node, with parse5 standing in for the browser's parser (`tests/helpers/inert-dom.mjs`).
- `tests/clipboard-engines.mjs` (root, CI job `clipboard-engines`): in Chromium, Firefox and WebKit, the zero-request and no-script check for resource-bearing HTML, the fixtures read as in Node, the envelope through dispatched paste events, and a Data paste of its own `text/html` (formulas relocated) undone in one step. Native pasteboards across documents and browsers stay in ADR-013's manual matrix. `CLIPBOARD_ENGINES=chromium,webkit` limits the engines.
- `packages/data/tests/clipboard.test.mjs` and `clipboard-html-browser.mjs`: Data's mapping and Data ⇄ Data, Data ⇄ other applications in the browser.
- `tests/slides-clipboard.mjs` (root; Chromium in `npm test`, all three engines in the `clipboard-engines` CI job): Slides ⇄ Slides tables in two tabs (`file://` and `localhost`), each carrier alone, hostile clipboards, Excel/Sheets/Word/Docs fixtures, merged cells through the editor's commands and print, and Slides ⇄ Data.
