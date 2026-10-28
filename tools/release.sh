#!/usr/bin/env bash
# Rebuilds everything, regenerates the examples, runs the tests and packages the plugin.
set -e
cd "$(dirname "$0")/.."
T=plugin/skills/html-slides/tools
node tools/build.mjs
# The html-data skill (T20): bundled tools, precompiled editor, engine, references, examples.
node packages/data/tools/skill.mjs
SHOTS=decks/community-garden.shots tools/example.sh
node $T/deck.mjs new decks/catalogue.html --title "html-slides — visual catalogue" --footer "html-slides · Fictional catalogue examples" --content decks/catalogue-content.html --force
node $T/deck.mjs pack decks/catalogue.html --pdf decks/catalogue.pdf
node $T/check.mjs decks/catalogue.html --shots decks/catalogue.shots
npm test
mkdir -p plugin/skills/html-slides/examples dist
cp decks/community-garden.html decks/catalogue.html plugin/skills/html-slides/examples/
rm -f dist/html-slides.plugin
(cd plugin && zip -qr ../dist/html-slides.plugin . -x "*.DS_Store")
echo "Plugin : dist/html-slides.plugin ($(du -h dist/html-slides.plugin | cut -f1))"
