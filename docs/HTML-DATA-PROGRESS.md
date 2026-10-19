# HTML Data implementation progress

The user authorised autonomous continuation of all remaining [planned tasks](HTML-DATA-PLAN.md) on 19 October 2026. Keep the existing requirements, data contract, code budget and verification gates. Work is isolated from unrelated local documentation changes. This ledger records evidence rather than treating planned features as complete.

| Task | Status | Evidence / next gate |
| --- | --- | --- |
| T01–T05b | Merged | PR #11; hybrid 0.2 document, all populated results, single IronCalc worker |
| T06 | Implemented locally | Missing/stale/engine-version snapshot checks, monotonic calculation revisions, explicit recalculation; 49 unit tests and existing + snapshot browser flows pass |
| T07 | In progress | Durable Save, copy, recovery, external-change and concurrent-save tests |
| T08–T11 | Pending | Grid/navigation, clipboard/fill, reference-aware structural commands, sheet groups/theme |
| T12–T19 | Pending | Complete formula conformance, scenarios, conditional rules, import/refresh, pivot/charts and report outputs |
| T20–T22 | Pending | Usable skill/tooling, fictional acceptance workbook, clean-install/blind/browser release checks |

An initial risk probe exercised every function in the agreed formula list against the pinned engine. All returned a result; this does not replace T12's fixed scalar/range/error/reference conformance cases. No paid component or second evaluator has been introduced. Text implementation and plugin identity/folder migration remain outside this continuation.
