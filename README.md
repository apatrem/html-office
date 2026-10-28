# html-office

Create presentations, analytical workbooks and written documents with an AI assistant, then edit and share them as a single HTML file. Each file includes its content, browser editor and a format guide for future AI edits.

## Development status

Status as of 22 October 2026. Only Slides is included in the downloadable plugin.

| App | Status | Available / next steps |
| --- | --- | --- |
| **html-slides** — presentations | Available · [v0.7.1](https://github.com/apatrem/html-office/releases/tag/v0.7.1) | Browser editor, seven chart types, themes, presentation mode and PDF export. Cross-device and full desktop-assistant workflows still need validation. [Validation log](docs/VALIDATION-V1.md). |
| **html-data** — analytical workbooks | Skill packaged in the plugin (next release) | Readable JSON workbook with IronCalc formulas in a worker, grid editing, formatting, scenarios and dropdowns, conditional formatting and data bars, pivot tables, charts, CSV export and print/PDF, drafts and saving. The `html-data` skill creates, patches, recalculates and validates workbooks with one self-contained Node tool. Next: import and source refresh (T15–T16), the acceptance workbook and blind test (T21–T22). [Format](packages/data/model/FORMAT.md) · [Plan](docs/HTML-DATA-PLAN.md) · [Progress](docs/HTML-DATA-PROGRESS.md). |
| **html-text** — reports, memos and proposals | Specified · implementation not started | Format and editor decisions documented. Implementation follows the Data editing milestone (Checkpoint B). [Specification](docs/HTML-TEXT-V1.md) · [Plan](docs/HTML-TEXT-PLAN.md). |

## Try Slides

Download the [community garden presentation](https://github.com/apatrem/html-office/releases/download/v0.7.1/community-garden.html) or the [visual catalogue](https://github.com/apatrem/html-office/releases/download/v0.7.1/catalogue.html), then open the HTML in Chrome or Edge.

- Click **Edit**; double-click text to change it, or drag elements to move them.
- Add slides, text, images, shapes, tables and charts from the toolbar.
- Press **Cmd/Ctrl+S** to save, present full screen, or export a PDF.

**No skill, Node.js, npm or Playwright installation is needed to open and edit a finished HTML file.** Chrome/Edge support saving to a chosen file; Safari/Firefox download a copy.

## Create with an AI assistant

Download the [html-slides plugin](https://github.com/apatrem/html-office/releases/download/v0.7.1/html-slides.plugin) and follow the [skill setup guide](plugin/README.md). Then ask, for example:

> Create a 6-slide presentation about organising a community garden, with a timeline and an illustrative budget.

The intended experience is to use Claude Desktop or ChatGPT Desktop without developer setup. **The complete workflow in these apps is not yet validated.** The current generation and checking tools need Node.js and, for rendering, Playwright in the assistant's execution environment. An app's built-in browser does not automatically replace those tools. npm is used for dependency installation and global package lookup; it is not needed to read or edit the finished document.

## Sharing and offline use

Send the HTML file; recipients need only a browser. Saved charts remain visible offline. Recalculating charts needs an internet connection unless the assistant has embedded the chart library for offline use.

Examples use clearly labelled fictional data. The project is [MIT licensed](LICENSE); bundled libraries retain their [own licences](THIRD_PARTY_NOTICES.md).

## Further reading

- [Skill setup and requirements](plugin/README.md)
- [Developer guide: installation, commands, checks and limitations](docs/DEVELOPMENT.md)
- [Slides format reference](plugin/skills/html-slides/references/FORMAT.md)
- [Office specification and roadmap](docs/HTML-OFFICE-V1.md)
