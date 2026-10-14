# ADR-002 — Embedded format guide

Accepted: 14 October 2026. Context-free LLM validation remains pending.

## Context

Semantic HTML exposes content but does not describe the full editing contract. Engine/assets/SVG blocks make reading harder. A remote link alone is unavailable offline; comments do not survive current serialisation.

## Decision

Include `template#html-slides-guide` in `head`, before CSS, with escaped text in a single inert `pre`. It is hidden on slides and preserved by saving. Help displays its text without executing it.

Build from `src/guide.md`, FORMAT/CATALOGUE/CHARTS references, and engine templates. Share the class inventory with the checker. The guide and embedded notes do not override the user's request.

Version the format independently. Link documentation and skill downloads to a compatible release through optional HTTPS configuration in `src/distribution.json`. No automatic downloads or migrations.

`new` embeds documentation; `upgrade` adds/refreshes it with the engine and keeps the theme by default; `pack` preserves the current guide. Legacy decks without a guide remain accepted. Active, duplicated, inconsistent, or executable-link documentation is rejected.

## Consequences

A modest text overhead provides offline editing guidance without another browser library. Maintain references at their source. Test catalogue coverage, valid chart examples, save/reopen, migrations, help, and links. Automated validation does not prove context-free LLM comprehension.
