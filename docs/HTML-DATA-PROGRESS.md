# HTML Data implementation progress

The user authorised autonomous continuation of all remaining [planned tasks](HTML-DATA-PLAN.md) on 19 October 2026. Keep the existing requirements, data contract, code budget and verification gates. Work is isolated from unrelated local documentation changes. This ledger records evidence rather than treating planned features as complete.

| Task | Status | Evidence / next gate |
| --- | --- | --- |
| T01–T05b | Merged | PR #11; hybrid 0.2 document, all populated results, single IronCalc worker |
| T06 | Merged in PR #12 | Missing/stale/engine-version snapshot checks, monotonic calculation revisions, explicit recalculation; 49 unit tests and existing + snapshot browser flows pass |
| T07 | Merged in PR #13 | Explicit file binding and staged-write conflict checks; worker/IndexedDB drafts; source revision protection survives repeated restoration; 56 unit tests + ten save/recovery browser scenarios pass. Independent review reproduced three loss/race issues; regression tests cover failed-edit reconciliation, unresolved startup drafts and queued recovery writes. Five-case benchmark: standard code 252–266 kB, P&L warm max 49 ms, largest 100k×8 warm max 1.40 s with aggregate reuse; sampled browser-tree RSS 3.73 GB. Native picker/dialog coverage remains a later release check. |
| T08 | Grid slice in review; history slice in progress | Viewport grid, rectangular selection and keyboard/form editing pass browser tests; 100k×8 navigation 118 ms with <600 rendered cells and no requests. Review regressions cover Escape draft cancellation, empty-cell text and keyboard focus. Undo/redo follows. |
| T09–T11 | Pending | Clipboard/fill, reference-aware structural commands, sheet groups/theme |
| T12–T19 | Pending | Complete formula conformance, scenarios, conditional rules, import/refresh, pivot/charts and report outputs |
| T20–T22 | Pending | Usable skill/tooling, fictional acceptance workbook, clean-install/blind/browser release checks |

An initial risk probe exercised every function in the agreed formula list against the pinned engine. All returned a result; this does not replace T12's fixed scalar/range/error/reference conformance cases. No paid component or second evaluator has been introduced. Text implementation and plugin identity/folder migration remain outside this continuation.
