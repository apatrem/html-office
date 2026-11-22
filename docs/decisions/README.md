# Decision records

Durable decisions of html-office, one ADR each. A record keeps the reasoning it was written with; its status line says what has happened since. Statuses below are as of 22 November 2026; the state of the work itself is in [STATUS.md](../STATUS.md).

| ADR | Decision | Product | Status |
| --- | --- | --- | --- |
| [001](001-v1-dom-and-migrations.md) | DOM-based V1 and explicit migrations | Slides, all | Accepted |
| [002](002-embedded-guide.md) | Embedded format guide in every file | All | Accepted; the unfamiliar-LLM validation is the blind tests ([T20, T22](../blind-tests/README.md)) |
| [003](003-html-office-and-data-runtime.md) | html-office and the Data runtime (IronCalc, worker, JSON workbook) | Data | Accepted; implemented. Its Data code ceiling is raised by ADR-010 |
| [004](004-html-text-format-and-editor.md) | html-text: restricted semantic HTML, ProseMirror editor | Text | Accepted; implemented |
| [005](005-data-storage.md) | Hybrid JSON workbook storage, every populated result saved | Data | Accepted; implemented |
| [006](006-formula-compatibility-patches.md) | Formula compatibility fixes in the one IronCalc engine | Data | Accepted; implemented |
| [007](007-scenario-inputs-and-dropdown-bindings.md) | Scenario inputs and dropdown bindings | Data | Implemented |
| [008](008-conditional-format-rules.md) | Conditional format rules and data bars | Data | Implemented |
| [009](009-familiar-ribbon-without-react-runtime.md) | Tabbed native ribbon | Data | **Superseded** by ADR-010, then by ADR-011 §7 (shared shell) |
| [010](010-manual-formatting-and-ironcalc-toolbar.md) | Manual formatting and an IronCalc toolbar | Data | **Partly superseded**: formatting, cell styles, theme and toolbar content by ADR-012, the toolbar by ADR-011 §7. Still in force: layering, sheet-level links, the 750,000-byte Data code ceiling |
| [011](011-html-office-shared-principles.md) | Shared principles: one file, charte, charts, shell, ceilings, appearance | All | Accepted; implemented. The Text code ceiling is now 600,000 bytes (§6 note) |
| [012](012-data-formatting-vocabulary.md) | Closed formatting vocabulary for Data | Data | Accepted; supersedes parts of ADR-010 |
| [013](013-cross-product-clipboard.md) | Cross-product clipboard | All | Accepted; implemented except X02d and X02f (Data chart pairs) |
| [014](014-data-pivot-tables.md) | Basic editable pivot tables | Data | Implemented |
| [015](015-data-xlsx-reader.md) | XLSX reader (SheetJS Community Edition) | Data | Accepted; implemented |
