#!/usr/bin/env bash
# Rebuilds everything, regenerates the examples, runs the tests and packages the plugin.
set -e
cd "$(dirname "$0")/.."
T=plugin/skills/html-slides/tools
node tools/build.mjs
# The html-data skill (T20): bundled tools, precompiled editor, engine, references, examples.
node packages/data/tools/skill.mjs
# The html-text skill (T18): bundled document tools, built editor, ECharts, references, examples.
node packages/text/tools/skill.mjs
SHOTS=decks/community-garden.shots tools/example.sh
node $T/deck.mjs new decks/catalogue.html --title "html-slides — visual catalogue" --footer "html-slides · Fictional catalogue examples" --content decks/catalogue-content.html --force
node $T/deck.mjs pack decks/catalogue.html --pdf decks/catalogue.pdf
node $T/check.mjs decks/catalogue.html --shots decks/catalogue.shots
npm test
mkdir -p plugin/skills/html-slides/examples dist
cp decks/community-garden.html decks/catalogue.html plugin/skills/html-slides/examples/
rm -f dist/html-slides.plugin
# The archive ships the html-slides skill only. html-data and html-text stay packaged in plugin/skills
# (their tests use them there) and join the archive after their blind tests (Data T22, Text T20).
(cd plugin && zip -qr ../dist/html-slides.plugin .claude-plugin LICENSE README.md THIRD_PARTY_NOTICES.md skills/html-slides -x "*.DS_Store")
# Refuse (and delete) an archive holding another skill or missing the Slides skill.
bash tools/check-plugin-archive.sh dist/html-slides.plugin || { rm -f dist/html-slides.plugin; exit 1; }
echo "Plugin : dist/html-slides.plugin ($(du -h dist/html-slides.plugin | cut -f1))"
