# HTML Data — Phase A prototype

Work authorised through T05b only. Final storage selection is a joint review with the user; T06 and later product features are out of scope for this PR. This package is independent of Slides and is not yet a distributed skill.

The experimental contract uses sparse readable JSON and stores all formula results. Storage alternatives are benchmark candidates, not an adopted format change.

## T01 contract

`model/workbook.mjs` validates `html-data/0.1`. Sheet IDs are stable; formula references use sheet names and Excel A1 syntax. Rows are 1–1,048,576, columns A–XFD. Ranges are bounded A1 rectangles. Missing cells are absent; explicit blanks have `{type:"blank"}`; empty text is `{type:"text",value:""}`. Errors are explicit typed spreadsheet codes. Dates are Excel 1900 serials (including its fictitious leap day); no locale-dependent date text is canonical. Numbers are finite IEEE-754 doubles, preserved without display rounding. Locale is initially en-US and engine timezone UTC; display formats are separate.

A cell has an `input` or `formula`, optional typed formula `result`, semantic `role` and `format`. Unknown structural fields are rejected. Arbitrary JSON metadata remains inert and survives bounded edits. Cell text may contain literal markup but is never HTML. JSON escaping prevents script termination and preserves Unicode. No executable content is accepted in model fields.

The SHA-256 calculation fingerprint includes typed inputs, formulas, sheet identity/order/names, named ranges and the date system. It excludes results, formats and descriptive metadata. Snapshots identify engine, fingerprint and calculation time. Fingerprints detect stale results, not authenticity. Missing/stale snapshots must be visible in the prototype.

Run model tests: `node --test packages/data/tests/model.test.mjs`.
