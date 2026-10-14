#!/usr/bin/env bash
# Reconstruit le moteur puis le deck d'exemple, son PDF et ses captures.
set -e
cd "$(dirname "$0")/.."
T=plugin/skills/html-slides/tools
node tools/build.mjs
node $T/deck.mjs new decks/community-garden.html --title "Example — community garden" \
  --footer "html-slides example · Fictional data" --content decks/community-garden-content.html --force
node $T/deck.mjs pack decks/community-garden.html --pdf decks/community-garden.pdf
node $T/check.mjs decks/community-garden.html --shots "${SHOTS:-decks/community-garden.shots}"
