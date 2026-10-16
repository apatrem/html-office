# ADR-004 — HTML Text format and editor

Status: accepted product direction on 15 October 2026. Text is not implemented; editor size, round-trip fidelity and print behaviour remain release gates in the [Text specification](../HTML-TEXT-V1.md).

## Context

Text is the html-office alternative to Word for draft-and-deliver business writing. It inherits the Office drivers: an unfamiliar LLM must read and edit the file from the HTML alone, and recipients need only a browser. Markdown was proposed as the authoritative content for its compactness and LLM familiarity. A separate grilling session proposed Markdown prose with a stored rendered HTML view and an editable Markdown source view. Unlike slide text boxes, a document body is one continuous editable flow whose structure changes through typing.

## Decision

Make a restricted subset of semantic HTML the only authoritative content, as in Slides. The browser renders it directly; there is no stored second copy. Report features (footnotes, comments, captions, cross-references, merged table cells) use elements, classes and data attributes defined by the format reference, not Markdown extensions. Provide a read-only Markdown view and a lossy Markdown export as projections.

Build the editor on ProseMirror with a schema that mirrors the subset. Untouched documents round-trip byte-identically; out-of-schema content is rejected or protected, never dropped. Numbers, the table of contents and cross-reference labels derive from IDs and document order; labels are saved back so the source remains readable. Footnotes are inline at the point of reference.

Edit continuously at the page text width and paginate only for print with CSS paged media. Share the brand theme and the chart contract with Slides and Data through shared modules; keep the Text model, layout styles and runtime build separate.

## Alternatives considered

- Markdown as the only source: most compact, but report features need Pandoc-style extensions that LLMs know less well, the editor would need a custom serialiser to avoid reformatting untouched text, and nothing would display without a parser.
- Markdown plus a stored rendered HTML view: displays without JavaScript, but duplicates content and needs fingerprints and stale-view handling after every LLM edit. An editable Markdown view adds lossless two-way conversion as a prerequisite. Scored lowest.
- `contenteditable` with `execCommand`, as in Slides: acceptable when the browser edits only one small text box, but in a continuous document it produces inconsistent markup on block splits and merges, cannot keep comment anchors correct, and does not scale snapshot undo. Replicating the missing parts amounts to rewriting ProseMirror.
- TipTap: adds weight, and useful extensions are paid, which conflicts with the no-paid-component rule. Lexical: its own JSON model would make the canonical HTML a translation layer.
- Live paginated editing: familiar to Word users, but needs a pagination engine with high size and performance cost. Deferred to the roadmap with page-foot footnotes.

## Consequences and validation

HTML costs more tokens than Markdown, roughly 1.3–2× depending on tables and lists (estimate, not measured), and diffs are noisier. Section tooling and section-level guidance in the embedded guide limit how much an LLM must read or rewrite. The document displays without JavaScript, but the editor, generated numbering and saved-label refresh need the engine.

Footnotes print as endnotes, and the table of contents prints without page numbers, until a pagination engine is added: Chrome supports page margin boxes but not `target-counter()`. Merged cells, wrapped images and repeated table headers must be verified in Chrome/Edge print. The ProseMirror packages and their licences must fit the 500,000-byte code budget and pass the dependency audit. The canonical-in/canonical-out property is tested, not assumed.
