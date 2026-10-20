# Scenario inputs and dropdown bindings

Status: implemented and merged in PRs #29–#31, 20 October 2026.

A scenario is one canonical input cell that selects among visible assumption cells using ordinary IronCalc formulas. Its descriptor references a generic single-cell dropdown validation. Definitions contain typed static choices or stable-sheet-ID A1 source ranges; they do not own another active value, scenario workbook or result cache. This keeps the complete model readable and editable through the embedded JSON.

Validation IDs are unique and targets cannot overlap. A scenario target cannot be a formula; reject whole batches that would make it computed. Generic computed dropdown targets remain read-only. Deletion preserves a #REF! target/source tombstone; the selector becomes inactive and header history restores the original binding on undo. Missing/stale/error sources are distinct from a current value outside the list. Derive these states from typed cells and a verified current snapshot, never persist a validity flag.

Keep menu work bounded: at most 1,000 definitions/static entries, 10,000 expanded range cells and 1,000 distinct options. Larger range references remain readable but report an unavailable menu without partial choices. Membership is typed and case-sensitive; numeric signed zeros compare equal. This is the V1 dropdown contract, not an exhaustive Excel validation-compatibility claim.

Metadata commands replace definitions without evaluating formulas. An already loaded worker accepts an atomic validation-header update so edits can keep using that engine offline. Explicit unchanged-header rejection allows a corrected retry; transport/post-mutation failures retain the normal failed-session behavior. Calculation-changing choices still publish only after the existing engine transaction succeeds. Per-scenario snapshots and duplicated formula models remain outside this implementation.
