#!/usr/bin/env bash
# Builds the three files that docs/MANUAL-CHECKS.md opens, into dist/latest/ (ignored by git),
# from the current checkout. Needs `npm ci` and `npm ci --prefix packages/data|text --ignore-scripts`.
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/latest
mkdir -p "$out"
node packages/text/tools/build.mjs packages/text/fixtures/valid/example.html "$out/text-example.html"
node packages/data/tools/build.mjs --input packages/data/fixtures/pnl.json --output "$out/data-pnl.html"
cp plugin/skills/html-slides/examples/catalogue.html "$out/slides-catalogue.html"
ls -l "$out"
