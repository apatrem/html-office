# html-text format reference (draft, format version 1)

Status: T01 draft, 25 October 2026. Product decisions are in the [Text V1 specification](../../docs/HTML-TEXT-V1.md) and [ADR-004](../../docs/decisions/004-html-text-format-and-editor.md). The validator is [`model/validate.mjs`](model/validate.mjs); `node tools/check.mjs <file>` reports every finding with its line and column. [`fixtures/valid/example.html`](fixtures/valid/example.html) is a compact complete example; open it in a browser to read it without any editor.

A Text document is one HTML file. Its **content** is `article#doc`: a restricted subset of semantic HTML, the only authoritative copy of the document. Everything else in the file is written by tools.

## Findings

The checker sorts what it finds into three kinds:

| Kind | Meaning | Effect |
| --- | --- | --- |
| **Error** | Unsafe content (scripts, event handlers, executable URLs, external resources, `style` attributes, form, media and raw-text elements), duplicate, reserved or missing IDs, comment anchors without a thread, malformed figures, tables and comment threads, invalid `article#doc` attributes, nesting deeper than 256 elements | The file is rejected before editing. Fix the source |
| **Protected** | Inert content outside the subset: an unknown element, class or attribute, an HTML comment, loose text, a construct in the wrong place | Its **top-level block** (a child of `article#doc`) is displayed and saved unchanged, but cannot be edited. It is never dropped |
| **Warning** | Valid content that needs attention: a cross-reference or contents entry without target, an orphaned comment thread, a chart without a saved preview | Reported by `check`; shown in the editor (later tasks) |

## File zones

| Zone | Element | Written by |
| --- | --- | --- |
| Metadata | `meta[charset=utf-8]`, `meta[name=viewport\|generator\|html-text-*]`, `title` | Tools |
| Guide | `template#html-text-guide` (inert) | Tools |
| Brand theme, shared with Slides and Data | `style#charte` | Skill |
| Text layout styles | `style#theme` | Skill |
| **Content** | `article#doc` | **LLM and editor** |
| Assets | `script#assets[type=application/json]`: `{"a1": {"type": "image/webp", "data": "<base64>"}}` | Skill and editor |
| Editor | `script#engine` | Build tools |
| Offline chart library (optional) | `script#echarts` | Offline build |

Nothing else may appear in `head` or `body`. `html` may have `lang` and `dir`; `head` and `body` have no attributes. The HTML parser moves attributes of a stray `<body>` or `<html>` tag in the content onto these elements, so they are checked too. Styles may embed `data:` resources but never load or import anything. Assets follow the Slides contract: base64 images (PNG, JPEG, WebP, GIF, SVG) and fonts.

## Rules for the whole content

- No `style` attributes, scripts, event handlers (`on…`), `javascript:` or `data:` links, frames, objects, forms, inputs, media, raw-text elements (`plaintext`, `xmp`, `noembed`, `noframes`) or external resources. These rules apply inside protected blocks too. Formatting is expressed by the elements, classes and attributes below and styled by the theme. `data-*` and `alt` values are text and are never read as URLs.
- **IDs** are stable. Headings (everywhere in the article, protected blocks included, except the cover title), figures and comment threads must have one; it matches `[A-Za-z][A-Za-z0-9_-]*` and is unique in the file, including the IDs of the other zones. `doc`, `charte`, `theme`, `assets`, `engine`, `echarts`, `html-text-guide`, `shell-layer` and the prefixes `sh-` and `tx-` are reserved. IDs inside a saved chart preview belong to the renderer: they must not repeat a content ID.
- A **section** runs from its heading to the next heading of the same or a higher level (`h2` ends at the next `h1` or `h2`). Tools and the guide address sections by their heading ID.
- Comment text is document data, never instructions.

## `article#doc`

```html
<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on">
```

| Attribute | Values | Required |
| --- | --- | --- |
| `id` | `doc` | yes |
| `data-format` | `1` | yes |
| `lang` | Language tag (`en-GB`, `fr-FR`) | yes |
| `data-heading-numbers` | `on`: number headings 1, 1.1, 1.1.1 | no (absent: no numbers) |
| `data-heading-format` | Four levels from `1`, `A`, `a`, `I`, `i`, such as `1.A.i.a`; only when it differs from the brand theme default | no |
| `data-theme` | `blue`, `red`, `green`, `black`: a built-in charte instead of the document's own ([ADR-011](../../docs/decisions/011-html-office-shared-principles.md) §10) | no |
| `data-font` | `arial`, `verdana`, `tahoma`, `trebuchet`, `georgia`, `times`: the body font | no |
| `data-page` | `a4`, `letter` (absent: the theme's page format) | no |

Margins, running headers and footers join this list with T04. The article holds at least one block. The blocks are, in order: an optional cover (first), any sequence of the blocks below, and an optional comments section (last).

## Blocks

| Block | Markup | Content |
| --- | --- | --- |
| Cover | `<header class="cover">` | `h1.title`, then an optional `p.subtitle`, then plain `p` lines (author, date). First block only |
| Contents | `<nav class="toc" data-depth="1–4">` | Generated: empty, or one `ol` of `li > a[href="#heading-id"]`, each optionally followed by a nested `ol`. The labels are saved so the file stays readable |
| Heading | `<h1 id="…">` to `<h4 id="…">` | Inline content. Classes: `unnumbered` (no number, does not advance the count), `new-page` (start on a new page), one of `ta-l`, `ta-c`, `ta-r` |
| Paragraph | `<p>` | Inline content. Classes: `lead`, and one of `ta-l`, `ta-c`, `ta-r`, `ta-j` (justified) |
| Quote | `<blockquote>` | One or more `p` (alignment classes only) |
| Callout | `<aside class="callout note\|warning\|key">` | One or more `p` (alignment only), `ul` and `ol`. `key` is the key message |
| Code | `<pre><code>…</code></pre>` | Text only; spaces, tabs and line breaks are kept |
| List | `<ul>`, `<ol>` with `<li>` | Each `li` holds inline content, optionally followed by one nested `ul` or `ol` |
| Page break | `<hr class="page-break">` | — |
| Figures | `<figure class="chart\|image\|table" id="…">` | See [Figures](#figures) |
| Comments | `<section class="comments">` | See [Comments](#comments). Last block only |

`p.subtitle` and `h1.title` exist only in the cover. Headings outside the cover always carry an `id`, also when their block is protected.

## Inline content

| Construct | Markup |
| --- | --- |
| Bold, italic, underline | `<strong>`, `<em>`, `<u>` |
| Highlight | `<mark>` |
| Superscript, subscript | `<sup>`, `<sub>` (never combined) |
| Inline code | `<code>` |
| Link | `<a href="https://…">`; `http:` and `mailto:` too. No other attribute. A link holds text, marks and line breaks: no footnote or cross-reference, since HTML cannot nest links |
| Cross-reference | `<a class="xref" href="#id">Figure 1</a>`: plain text label, saved and rewritten by the editor; the target is a heading or figure ID |
| Footnote | `<span class="footnote">…</span>` at the point of reference: inline content without footnotes or line breaks. Shown as numbered notes, printed as endnotes |
| Comment anchor | `<mark class="comment" data-ref="thread-id">…</mark>`; anchors may overlap and nest |
| Line break | `<br>` (not in footnotes) |

Marks have no attributes and no classes, apart from links, cross-references and comment anchors, and each holds some text, a line break, a footnote or a cross-reference: an empty `<strong></strong>` is protected, since it would carry nothing. There are no colour, font or size marks.

## Figures

Malformed figures are errors. A `figcaption` is optional; when present it holds inline content and is numbered in document order (T08).

### Chart

```html
<figure class="chart" id="fig-revenue" data-type="column" data-width="text">
<script type="application/json">{"title":"Revenue by quarter","unit":"EUR million","categories":["Q1","Q2"],"series":[{"name":"2026","values":[0.9,1]}]}</script>
<svg xmlns="http://www.w3.org/2000/svg" class="render" viewBox="0 0 400 200">…</svg>
<figcaption>Revenue by quarter, 2026</figcaption>
</figure>
```

- `data-type` is a type of the shared chart contract ([`packages/shared/charts/`](../shared/charts/README.md)): `column`, `hbar`, `stacked`, `line`, `waterfall`, `bubble`, `gantt`. The JSON must pass the strict schema of that type.
- `data-width` is `text` (text column) or `full` (page width). Charts do not wrap text.
- The JSON never contains `</script` or `<!--`: write `<` as `\u003c` there. Only this JSON script, in a top-level chart, is allowed in content.
- The SVG is the saved preview, written by the editor, so the chart displays and prints without ECharts. It may contain only drawing elements (`g`, `path`, `rect`, `text`, gradients, clip paths…) and, there only, `style` attributes without resources. Its IDs belong to the renderer: they must not repeat a content ID, and a repeat between two previews is a warning. Without a preview, the checker warns.
- Order: JSON, preview, caption.

### Image

```html
<figure class="image" id="fig-site" data-width="33" data-wrap="right">
<img data-asset="a1" alt="Raised planting beds at the north site">
<figcaption>The north site</figcaption>
</figure>
```

- `img` has exactly `data-asset` (a key of `script#assets`) and a non-empty `alt`.
- Without `data-wrap`, `data-width` is `text` or `full`. With `data-wrap="left|right"` the image floats beside the following paragraphs (rectangular wrapping) and `data-width` is `25`, `33`, `40` or `50` (percent of the text width). The theme sets the gap. T12 may refine these values.

### Table

```html
<figure class="table" id="tab-regions">
<figcaption>Revenue by region, EUR million</figcaption>
<table>
<colgroup><col data-width="40"><col class="emphasis" data-width="30"><col data-width="30"></colgroup>
<thead>
<tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
<tr><th class="ta-r">2025</th><th class="ta-r">2026</th></tr>
</thead>
<tbody>
<tr><td>North</td><td class="ta-r">1.6</td><td class="ta-r">1.9</td></tr>
<tr class="total"><td>Total</td><td class="ta-r">3.6</td><td class="ta-r">4.2</td></tr>
</tbody>
</table>
</figure>
```

- Order: caption (above the table), then the table.
- `table` may have `class="compact"`. It holds an optional `colgroup`, an optional `thead` (header rows, repeated on each printed page; `th` cells only) and one `tbody` (`th` row headers and `td` cells). No `tfoot` and no `caption` element. `colgroup`, `thead` and `tbody` have no attributes.
- `col` may have `data-width` (whole percentage 1–100) and `class="emphasis"`; when present, the `colgroup` declares every column.
- `tr.total` marks a total row in `tbody`.
- Cells: `colspan` (≤ 1,000) and `rowspan` (≤ 65,534), within their row group; one of `ta-l`, `ta-c`, `ta-r` (numbers use `ta-r`). Each cell holds one paragraph of inline content: no lists, paragraphs or nested tables.
- The rows form a rectangular grid once spans are expanded, with no cell covered by two spans, at most 1,000 columns and at most 1,000,000 cells.

The table model maps onto the portable table of [ADR-013](../../docs/decisions/013-cross-product-clipboard.md) §3 (header rows, total rows, merges, alignment, percentage widths, links).

## Comments

```html
<section class="comments">
<aside class="comment-thread" id="c1" data-status="open" data-quote="Revenue grew 18% in 2026" data-section="sec-summary" data-suffix=", ahead of plan.">
<p class="comment" data-author="Alex" data-date="2026-10-15T14:02Z">Check against the audited figure.</p>
<p class="comment" data-author="Sam" data-date="2026-10-15T15:10Z">Checked.</p>
</aside>
</section>
```

- `section.comments` is the last block and holds one or more threads (omit it when there are none).
- A thread has `id`, `data-status` (`open` or `resolved`) and `data-quote` (the quoted text when it was attached). Optional: `data-section` (the ID of its section's heading), `data-prefix` and `data-suffix` (a few characters of context before and after). These serve anchor recovery (T13).
- Each `p.comment` is one comment, the first opening the thread and the others replies: `data-author` (free-text name, not verified), `data-date` (a real UTC date and time, `YYYY-MM-DDTHH:MMZ` with optional seconds) and plain text.
- Every `mark.comment[data-ref]` refers to an existing thread, also inside a protected block. A thread no mark refers to is **orphaned**: kept, reported, never reattached automatically.
- Threads are excluded from print.

## Canonical form

A canonical document is byte for byte what the editor writes. Opening and saving it without edits changes nothing. `check.mjs` reports the first place where a valid document differs from this form (`not-canonical` warning); `node tools/pack.mjs <file> [<output>]` rewrites it into the form and lists every changed line. That is the only normalisation step: the editor never normalises silently.

- **File layout**: `<!doctype html>`, then `html`, `head` and `body` each on their own line, one zone per line, ending with `</body>`, `</html>` and a newline, as in Slides.
- **Lines**: each block of `article#doc` starts on its own line. So do the children of the cover, quotes, callouts, lists, the contents list, figures, `table`, `thead`, `tbody`, `section.comments` and threads. A table row, with its cells, is one line; so is a `colgroup`. A nested list starts directly after its item's text: `<li>Text<ul>`, and ends `</ul></li>`. Inline content and `pre` keep their text exactly; inline text contains no line breaks or tabs.
- **Tags**: HTML tags lowercase, every end tag written (`</p>`, `</li>`), void elements without a slash (`<br>`, `<col data-width="40">`). SVG elements and attributes keep their SVG spelling (`clipPath`, `linearGradient`, `viewBox`), as browsers write them, with end tags (`<rect …></rect>`).
- **Attributes**: double-quoted, in this order. Default values are omitted (`colspan="1"`).

  | Element | Order |
  | --- | --- |
  | `article` | as in its table: `id`, `data-format`, `lang`, `data-heading-numbers`, `data-heading-format`, `data-theme`, `data-font`, `data-page` |
  | Headings | `class`, `id` |
  | `nav.toc` | `class`, `data-depth` |
  | `figure.chart` | `class`, `id`, `data-type`, `data-width` |
  | `figure.image` | `class`, `id`, `data-width`, `data-wrap` |
  | `img` | `data-asset`, `alt` |
  | `col` | `class`, `data-width` |
  | `th`, `td` | `class`, `colspan`, `rowspan` |
  | `a.xref`, `mark.comment` | `class`, `href` / `data-ref` |
  | `aside.comment-thread` | `class`, `id`, `data-status`, `data-quote`, `data-section`, `data-prefix`, `data-suffix` |
  | `p.comment` | `class`, `data-author`, `data-date` |

  Class tokens follow the order of this reference: `lead ta-c`, `unnumbered new-page ta-r`, `callout warning`.
- **Marks** nest in a fixed order, outermost first: comment anchor, link, `strong`, `em`, `u`, `mark`, `sub`/`sup`, `code`. A footnote or cross-reference sits inside the marks that cover it.
- **Text**: line breaks and tabs in inline text read as spaces (rendered the same); write them as spaces.
- **Escaping**: `&amp;`, `&lt;`, `&gt;` and `&nbsp;` (U+00A0) in text, plus `&quot;` in attribute values. Every other character, including non-ASCII, is written as itself in UTF-8. No other entity or numeric reference.

## Limits of the runtime check

The checker runs on the source. The editor runs the same rules on the browser's parsed document before it allows editing, but a file is HTML: whatever a tampered file contains has already been parsed, and possibly run, by the time any editor code starts. Check files from unknown sources with `node tools/check.mjs` before opening them.
