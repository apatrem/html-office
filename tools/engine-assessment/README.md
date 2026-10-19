# Reproduce the engine assessment

Development-only tooling. None of these dependencies or fixtures enters the
Slides plugin or a generated document. Requires Node.js 22+ and npm.

From the repository root:

```sh
npm ci --prefix tools/engine-assessment --ignore-scripts
npm --prefix tools/engine-assessment test
npm --prefix tools/engine-assessment run measure -- --check
```

`npm --prefix tools/engine-assessment run measure` prints fresh JSON without
changing files. After reviewing an intentional input/dependency change, use
`npm --prefix tools/engine-assessment run measure -- --write` to update the
committed [results.json](results.json). Review that diff before committing.

The package manifest pins direct versions; the lockfile pins the complete
dependency graph and npm integrity digests. The result includes installed
versions, exact bundle entry sources/options, fixture/script/lockfile hashes,
UTF-8 byte counts, SHA-256, local gzip level 9 and Brotli quality 11, and
`gpt-tokenizer/encoding/o200k_base` counts. These are local compression results,
not measured CDN transfers. Node/zlib/platform are recorded. Compression sizes
may vary with Node/zlib, so `--check` compares inputs, package versions, raw bundle
bytes/hashes and tokens, while treating environment/compression as advisory.

The ProseMirror full entry retains every export of each selected package in a
separate namespace. Individual entries retain every export of one package,
including its dependencies. This is a reproducible conservative library probe,
not a finished editor or the smallest possible application bundle. Legal comments
are removed for this comparison; shipped builds must include required notices
in their application-code budget. The full
ECharts asset is measured as shipped; the custom entry is built from its core.
Formula.js is bundled but not tested for spreadsheet semantics. IronCalc assets
are measured, not instantiated or benchmarked.

## Inputs and limitations

- `fixtures/report.md` and `report.html` express the same fictional narrative,
  list, table, footnote and link. The HTML adds IDs, cross-reference/footnote
  semantics and a total-row class which plain Markdown does not fully preserve.
  These are snippets, not complete valid documents or a lossless-conversion test.
- `fixtures/raw-data.json` declares 1,000 rows, eight columns and fictional
  categories. `measure.mjs` deterministically generates IDs `R-1`…`R-1000`,
  cycling region/programme/month and computing visits/price/revenue/cost. No
  random seed, clock, private data or network source influences the fixture.
- Both raw-data serializations include the header row. JSON stores addressed
  `{value: …}` cells; CSV omits cell addresses and needs an external typing
  policy. Neither includes the full workbook, styles or saved formula results.
  The measured ratio is specific to this representation and sample.

The original 16 October samples/entry points were not retained. The committed
fixtures establish a new 18 October baseline rather than pretending to recreate
the old figures. Neither a token ratio nor an engine-only size establishes the
finished application's readability, performance, code budget or Excel fidelity.
