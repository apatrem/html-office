# ADR-001 — DOM-based V1 and explicit migrations

Accepted: 12 October 2026.

## Context

V1 already has a usable editor based on DOM mutations and HTML snapshots. The original plan assumed an independent model that could later support collaboration without rewriting. The implementation does not meet that assumption. Content preservation and reliable saving take priority.

## Decision

Keep the DOM as V1 state, with transactional mutations and reliable drafts/saves/checking. Stable identifiers support preservation but do not resolve concurrent conflicts. Defer an independent model and serialisable operations to a V2 architecture effort after usage validation.

Separate packing from migration. `pack` preserves engine/theme/guide. `upgrade` explicitly replaces engine/guide and creates a backup. Theme replacement requires `--theme`; content edits must not silently move an older deck.

Parse HTML inertly before rendering. Execute only recognised plugin scripts in a browser with external resources blocked. Bundle parse5/entities into the tools rather than adding them to the deck engine.

## Consequences

V1 improves reliability without changing the content format. V2 must redesign mutation/history. Historical estimates are not commitments. Local script digests are allowlists, not signed updates. Download fallback creates a copy; direct saving initially requires selecting a target. Tests preserve metadata, assets, identifiers, order, and authorised geometry.
