# V1 validation log

Automated checks cover chart validation, safe HTML handling, preservation, complete drafts and save races, thumbnails, embedded documentation, SRI/CORS rejection, offline use, and the browser editor.

The 0.6.1 baseline passed 39 regression tests plus the editor workflow and 27 example/catalogue slides. A live CDN check confirmed bytes matching the pinned package and successful SRI loading. Routine tests serve local approved bytes and do not depend on the network.

Release 0.7.0 replaces all distributed decks with fictional English topics. Local verification passed all 39 regression tests and the complete editor workflow, with zero checker errors on all 27 slides. Screenshots were reviewed and the PDFs contain the expected 9 and 18 pages. The public repository starts with a fresh history: earlier local example decks and historical planning notes are not published.

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
