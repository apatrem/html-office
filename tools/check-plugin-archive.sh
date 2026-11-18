#!/usr/bin/env bash
# Usage: bash tools/check-plugin-archive.sh ARCHIVE
# The plugin archive ships the html-slides skill only, with its manifest, licence, README and notices.
# html-data and html-text stay in plugin/skills and join it after their blind tests (Data T22, Text T20).
set -e
ENTRIES=$(unzip -Z1 "$1")
OTHER=$(printf '%s\n' "$ENTRIES" | grep -E '^skills/.+' | grep -v '^skills/html-slides/' || true)
MISSING=
for f in .claude-plugin/plugin.json skills/html-slides/SKILL.md; do
  printf '%s\n' "$ENTRIES" | grep -Fqx "$f" || MISSING="$MISSING $f"
done
if [ -n "$OTHER$MISSING" ]; then
  echo "$1 must hold the html-slides skill only, with its manifest." >&2
  if [ -n "$MISSING" ]; then echo "Missing:$MISSING" >&2; fi
  if [ -n "$OTHER" ]; then echo "Other skill entries:" >&2; printf '%s\n' "$OTHER" | head -5 >&2; fi
  exit 1
fi
