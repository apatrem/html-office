# V1 validation log

Automated checks cover chart validation, safe HTML handling, preservation, complete drafts and save races, thumbnails, embedded documentation, SRI/CORS rejection, offline use, and the browser editor.

The 0.6.1 baseline passed 39 regression tests plus the editor workflow and 27 example/catalogue slides. A live CDN check confirmed bytes matching the pinned package and successful SRI loading. Routine tests serve local approved bytes and do not depend on the network.

Release 0.7.0 replaces all distributed decks with fictional English topics. Local verification passed all 39 regression tests and the complete editor workflow, with zero checker errors on all 27 slides. Screenshots were reviewed and the PDFs contain the expected 9 and 18 pages. The public repository starts with a fresh history: earlier local example decks and historical planning notes are not published.

Release 0.7.1 keeps drafts after the download fallback, flags drafts made from another version of a file, strips restored drafts of code and external resources, rejects more external-resource attributes and CSS fetches in the inert check, and limits trusted engines to published releases plus the current build. CSS resource checks use the pinned CSS tokenizer to decode escapes and inspect every image candidate, including dynamic URL refusal. Draft identity recognises both the opened file and the snapshot actually written, covering edits made during saving and Save As. Local verification passed all 49 regression tests and the complete editor workflow, with zero checker errors on all 27 example slides.

Release 0.7.2 (published on 18 November 2026) moves the Slides editor onto the shared html-office shell, adds a deck theme and body font, table column widths with border dragging, merged cells from pasted tables, copy and paste of tables across decks, Data, Text and other applications and of charts across decks and to other applications, and save in place with a remembered file in Chrome and Edge. The plugin archive ships the html-slides skill only: the html-data and html-text skills stay in the repository until their blind tests, and the release script refuses an archive holding another skill. Local verification: `npm run release` passed end to end, with all 101 regression tests, the Chromium editor and shell workflows, and the Slides clipboard, chart clipboard, save-in-place and table-width checks; zero checker errors on all 27 example slides, and the PDFs contain 9 and 18 pages.

File System Access is tested with a simulated writable target; actual Chromium downloads/reopening are tested too. Direct saving on another workstation remains a manual check.

## Five task comparisons

Choose five representative tasks with fixed briefs and three later edits. Include text, charts, and free compositions. Measure all active time: planning, generation, visual correction, manual editing, LLM revision, sharing, and reopening. Track blocked/waiting time separately. Compare with the same tasks in PowerPoint.

| Task | Brief and edits | PowerPoint minutes | html-slides minutes | Net gain | Defects/evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | To define | — | — | — | — | Pending |
| 2 | To define | — | — | — | — | Pending |
| 3 | To define | — | — | — | — | Pending |
| 4 | To define | — | — | — | — | Pending |
| 5 | To define | — | — | — | — | Pending |

Net gain = PowerPoint time − html-slides time. Include failures and rework, not just initial generation.

## Manual checks pending

- Context-free LLM test: only HTML supplied; targeted text edit, new slide, chart edit, then preservation and rendering review.
- Three LLM edits after manual positioning, checked with `--since` and screenshots.
- Chrome/Edge direct save, close, and reopen with images, charts, and footer.
- Independent recipient on another workstation repeats the workflow without assistance.
- Safari/Firefox download/reopen if used.
- Offline reading and chart editing with `--offline`.
- PDF comparison: fonts, sources, images, pagination.
- Real sharing through the intended channel, documenting opening restrictions.
- Large-deck interaction and draft storage capacity.
- Five comparisons completed and a continue/stop decision recorded.
