# ADR-015 — XLSX reader for Data import

Status: **accepted**, 28 October 2026. The user chose SheetJS Community Edition 0.20.3.

## Context

T15 asks Data to import supported XLSX content:
- typed values, supported formulas and several sheets;
- honest diagnostics for what Data cannot hold;
- active and external content restricted;
- a pinned component loaded only for an import request, with integrity, licence notices through `packages/shared/notices.mjs` and an offline build path.

Data's standard application code must stay under 750,000 bytes (466,401 with CSV import and refresh), and import code loads on demand. No source data may leave the browser.

An XLSX file is a ZIP of XML parts. For each sheet, Data needs:
- cell values and their types;
- formulas, including shared formulas, which store one formula for a block of cells;
- cached results;
- number formats, to tell dates from numbers;
- shared strings, defined names and the 1904 date system;
- the presence of what it cannot hold, for the diagnostics: merges, comments, hyperlinks, data validation, conditional formats, charts, pivots, macros, external links and OLE objects.

## Options

| | SheetJS CE 0.20.3 (`xlsx.mini`) | ExcelJS 4.4.0 | read-excel-file 9.3.13 | Own reader on fflate 0.8.3 |
| --- | --- | --- | --- | --- |
| Licence | Apache-2.0 | MIT | MIT | MIT (fflate) + ours |
| Size, minified / gzip | 279.5 kB / 86 kB (full build 952 kB) | 948 kB / 256 kB | 48 kB / 14 kB | fflate unzip 5.5 kB, reader estimated 15–25 kB |
| Formulas | yes, shared formulas expanded | yes, shared formulas as references to translate | **no** (values only) | ours: shared formulas translated with Data's existing reference relocation |
| Maintenance | one vendor; current builds come only from cdn.sheetjs.com, and the npm registry stops at 0.18.5, which has known advisories (prototype pollution, ReDoS) fixed in later builds | last release October 2023 | active | fflate active (July 2026); the reader is ours to maintain |
| Surface | many formats (XLSX, XLSB, XLS, ODS, CSV…) in one parser | XLSX writer and reader, streams, polyfills | XLSX only | XLSX only; XML through the browser's `DOMParser` (no DTD or external entity loading) |
| Delivery | CDN with SRI in standard mode (cdn.sheetjs.com), embedded in offline builds | too large to embed; CDN only | bundled in the import chunk | bundled in the import chunk |
| Already in the repo | yes, as a dev dependency for the Phase A assessment converter | no | no | no |

ExcelJS is ruled out by size and maintenance, and read-excel-file because it cannot read formulas.

The trade-off was between two candidates:
- **SheetJS:** the most complete and battle-tested reader. Its costs are 280 kB from one vendor's own CDN, outside the npm registry, and a large multi-format parser for files that cannot be trusted.
- **Our own reader on fflate:** about a tenth of the size, but we would have to establish its fidelity on unusual files ourselves and maintain it.

## Decision

Use **SheetJS CE 0.20.3**, the `xlsx.mini.min.js` build. The user chose it for its coverage, the most complete of the candidates.

- **Pinned.**
  - The exact file is vendored in `packages/data/vendor/xlsx/` with its `LICENSE` and `package.json`. It is byte-identical to the file cdn.sheetjs.com serves and to the npm tarball that `packages/data` already installs from that CDN.
  - Its SHA-384 (`XLSX_INTEGRITY` in `runtime/xlsx-reader.mjs`) is checked by `tools/xlsx-library.mjs` at every build and by a unit test. Changing the version or digest is a deliberate change of both.
  - The npm registry package (0.18.5) is never used: it lacks the advisory fixes.
- **Loaded only for an XLSX import.**
  - Standard builds fetch `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js` when an XLSX file is picked, never at load or for a CSV import. The fetch is anonymous CORS with no credentials or referrer and the `integrity` option set.
  - Offline builds embed the same bytes as inert base64 text (`script#xlsx-source`). The file contains `"<!--"`, which inline script text cannot carry byte for byte.
  - In both cases the page recomputes the SHA-384 of the bytes before anything runs.
- **Contained.**
  - The library runs only in a dedicated worker whose `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts` and nested workers are removed before it is defined. It never runs in the page.
  - The worker receives a copy of the file's bytes and returns plain data (`model/xlsx.mjs` › `summarise`); the page maps that data to Data cells. Cancelling terminates the worker.
  - Macros are not read (`bookVBA: false`). Styles and HTML are not parsed. Password-protected and `.xls` files are refused before parsing.
- **Notices.** `xlsxPackage()` adds the vendored package to the notices of every build through `packageEntries`. Its Apache-2.0 text is grouped with the identical copies already listed.
- **No CSP or host allow-list change.** Data documents carry no Content-Security-Policy, and no shared loader restricts hosts. The only new host is the one exact URL above, used only by `runtime/xlsx-reader.mjs`.

## Consequences

- **Size.**
  - Standard P&L application code grows from 466,401 to 489,543 bytes, mostly the import chunk, which grows from 30,340 to 50,851 bytes.
  - The 279,523-byte reader is not in the standard file. Offline builds grow by 372,700 bytes (base64).
- **Availability.** A standard document needs cdn.sheetjs.com to import XLSX. If it cannot load the reader, it says so and suggests an offline build; CSV import is unaffected.
- **Fidelity is bounded and stated.** A formula Data cannot run keeps its saved value with a reason: external links, table references, 3D ranges, sheets not imported or array formulas. Results that differ after recalculation are reported, and unsupported content is listed before import.
- **Updating** SheetJS means vendoring the new file, checking it against the CDN copy, and updating the version, digest and this ADR.
