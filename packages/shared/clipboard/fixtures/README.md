# Clipboard HTML fixtures

Fictional data. Each file reproduces the structure of the `text/html` flavour that an application writes when a table is copied: the markup, attributes, class rules, comments and white space each application is known to emit. They were written by hand from those applications' documented clipboard output, **not captured** from the applications themselves; capturing real clipboards stays part of ADR-013's manual matrix.

| File | Source | What it exercises |
| --- | --- | --- |
| `excel-macos.html` | Microsoft Excel 16 for macOS | Full document with `<head>`, `file://` links, `<style>` class rules (`.xl65` bold), `<!--StartFragment-->`, `colspan` title, `x:num` hints, `align=right`, padded `1,235 ` and `(5,000)` displays, `<br>` line break, link, leading-zero text |
| `sheets-fr.html` | Google Sheets, French locale | `<google-sheets-html-origin>`, inline `font-weight:bold`, `data-sheets-*` hints, narrow no-break space grouping `1 234,50`, `12 %`, `dd/mm/yyyy` dates, in-cell link |
| `word-macos.html` | Microsoft Word 16 for macOS | `MsoTableGrid`, `<p class=MsoNormal>` cells, `<o:p>`, conditional comments, `span.Strong` class rule (mixed bold), two paragraphs in a cell, a `javascript:` link, two links in one cell, trailing empty paragraph |
| `docs.html` | Google Docs | `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper, span-level `font-weight:700` and `font-style:italic`, `colspan` header and `rowspan`, ISO date, link |
