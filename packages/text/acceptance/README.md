# Fictional acceptance report (T19)

A 17-page **business review and next-year plan** for an invented bakery co-operative, written through the html-text skill to prove the authoring and recipient workflow end to end ([plan T19](../../../docs/HTML-TEXT-PLAN.md#t19--publish-the-fictional-acceptance-report)). The co-operative, its sites, people, figures and comments are fictional; nothing comes from a client or a private file. The images are original drawings ([`images/SOURCES.md`](images/SOURCES.md), CC0).

## What it covers

| Requirement | Where |
| --- | --- |
| Cover, executive summary, generated contents | Cover with subtitle and two lines; contents to depth 2; *1 Executive summary* with a lead paragraph and a key-message callout |
| Numbered sections, lead and callouts | Five numbered chapters on new pages, 13 numbered subsections; a lead paragraph per chapter; note, warning and key callouts |
| Two charts with saved SVGs | *Figure 1* revenue by quarter (column), *Figure 5* operating-profit bridge (waterfall, full width); previews drawn by the tools in the brand's colours |
| Three tables, one with merged headers and a total row | *Table 1* revenue by channel (*Year* and *Change* spanning two columns each, *Channel* two rows, total row, emphasis column); *Table 2* costs (compact, two total rows); *Table 3* 2027 budget |
| Wrapped images with captions | Mill Lane shopfront (right, 40%), delivery loop (left, 40%), and the oven line at text width |
| Endnotes and cross-references | Notes in five sections, printed as endnotes; 23 cross-references to sections, figures and tables, labels generated |
| One open and one resolved comment thread | Made by a reviewer in the editor: a question on the revenue figure (open), and one on the Riverside dates with a reply (resolved) |
| Appendix | Appendices A (definitions and sources), B (sites) and C (members' questions), unnumbered, each on a new page |
| Companion Slides deck | Five slides with the same brand charte ([`brand.css`](brand.css)) and the same two charts |

## How it is generated

The generated files are not committed. `node packages/text/acceptance/generate.mjs [--out DIR]` writes them into `output/` (ignored by git), repeating the whole chain:

1. The plugin is copied and the html-text skill packaged afresh, as `tools/release.sh` does; every step below uses that skill's `tools/document.mjs`.
2. **Outline pass:** `new` builds the document from [`outline.md`](outline.md) (every heading and figure with its ID) and [`payloads.json`](payloads.json) (the figures' data, captions and image files), with `--charte brand.css`, the cover lines, contents, heading numbers and the running header.
3. **Section passes:** each file of [`sections/`](sections/) is converted (`convert`, Markdown with `[[block: …]]` placeholders that resolve to the figures already in the document) and replaced (`replace`); `check` then reports no error and no warning.
4. **Review:** in Chromium, a reviewer opens the file, comments on two passages in the editor, replies to and resolves the second thread, and saves with File › Save a copy.
5. `pack` writes the standard and offline files from the reviewed copy, `markdown` the Markdown sample, and Chromium prints the PDF from the standard file with every network request refused.
6. The html-slides skill builds the companion deck from [`deck-content.html`](deck-content.html) with the same charte.
7. `output/manifest.json` records the versions and the measured sizes.

`tests/acceptance-browser.mjs` runs the same chain (in CI, in the `text` job), checks every requirement above in the outputs, then edits and extends a section in the editor, saves a copy, reopens it, and extends it again with `show --markdown`, `convert` and `replace`. `tests/acceptance.test.mjs` checks the committed inputs.

## Generated files

Measured on 29 October 2026 on macOS (sizes vary by a few bytes between runs: the comments carry their date and time; Linux Chromium has other fonts, so the PDF's page count may differ by a page or two; the test accepts 15 to 20).

| File | Size |
| --- | --- |
| `output/fictional-business-review.html` (standard: ECharts fetched only to redraw a chart) | 639,853 bytes: application code 577,482, content 49,599, assets 6,758, guide 6,014 |
| `output/fictional-business-review-offline.html` (ECharts embedded) | 1,778,560 bytes: application code 577,483, ECharts 1,138,706 |
| `output/fictional-business-review.pdf` (Chromium, A4, running header and page numbers) | 427,463 bytes, 17 pages |
| `output/fictional-business-review.md` (File › Export Markdown) | 31,974 bytes |
| `output/fictional-business-review-deck.html` (html-slides) | 524,964 bytes |

Versions: html-text 0.1.0 (document format 1), ECharts 6.1.0, html-slides deck engine 0.7.1, plugin `html-slides` 0.7.1 with the html-text skill as on this branch; generated with Node 26.0.0 and Playwright Chromium 151.0.7922.34.
