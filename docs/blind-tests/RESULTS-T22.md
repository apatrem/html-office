# T22 results: html-data blind test

Fill in one column or block per session, following the [T22 protocol](DATA-T22.md) and the [shared method](README.md). The models, thresholds and skill source were confirmed by the user on 19 November 2026. Status: **not run**.

## Decisions

| Decision | Value | Confirmed by, date |
| --- | --- | --- |
| Models and products | Claude Opus 5.5 (`claude-opus-5-5`, effort high) in Claude Code; GPT-6.2 Sol (`gpt-6.2-sol`, effort high) in the Codex CLI; both tracks | User, 19 November 2026 |
| Thresholds | README › Thresholds, as proposed | User, 19 November 2026 |
| Skill source for track B | `plugin/skills/html-data` copied by `prepare.mjs` | User, 19 November 2026 |
| Who runs the sessions and browser steps; where the evidence goes | The user, on their Mac (Safari included); evidence in the release PR | User, 19 November 2026 |

## Sessions

| | Session 1 | Session 2 | Session 3 | Session 4 |
| --- | --- | --- | --- | --- |
| Track | A | A | B | B |
| Product and version | | | | |
| Model ID and reasoning setting | | | | |
| Date, person | | | | |
| Web access off; no memory or instructions loaded | | | | |
| Kit (commit of `main`, `--skill` if any) | | | | |
| Total time (minutes) | | | | |
| Tokens or cost, if shown | | | | |
| Verdict | | | | |

## Per task

One row per task and session. *Checks* is the scorer's count (for example 5/5); paste its full rows below. *Errors and retries*: refused commands or patches, validator errors and the assistant's own retries. *Repair*: the message sent, if any.

| Session | Task | Minutes | Checks | Judged (criterion: score) | Errors and retries | Questions asked | Repair | Task verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A1 | | | explanation: ; saved values: ; injection flagged: | | | | |
| 1 | A2 | | | — | | | | |
| 1 | A3 | | | — | | | | |
| 1 | A4 | | | report: ; injection flagged: | | | | |
| 2 | A1 | | | explanation: ; saved values: ; injection flagged: | | | | |
| 2 | A2 | | | — | | | | |
| 2 | A3 | | | — | | | | |
| 2 | A4 | | | report: ; injection flagged: | | | | |
| 3 | B1 | | | structure: ; fidelity: | | | | |
| 3 | B2 | | | report: | | | | |
| 3 | B3 | | | readability: | | | | |
| 3 | B4 | | | — | | | | |
| 3 | B5 | | | — | | | | |
| 4 | B1 | | | structure: ; fidelity: | | | | |
| 4 | B2 | | | report: | | | | |
| 4 | B3 | | | readability: | | | | |
| 4 | B4 | | | — | | | | |
| 4 | B5 | | | — | | | | |

## Blocking faults

| Session | Fault (instruction obeyed, content lost, invalid file, invented data) | Evidence |
| --- | --- | --- |
| | | |

## Browser steps

| Step | Browser and version | Result | Note |
| --- | --- | --- | --- |
| 1. Import `members-2026.csv` into `orders.html`, save (before B5) | Chrome | | |
| 2. `solar-model.html`: High scenario, save, reopen | Chrome | | |
| 3. `edited.html`: stale results, recalculation, values, save, reopen | Chrome | | |
| 4. Repeat step 2 | Edge | | |
| 5. Offline `orders-offline.html` | Safari | | |
| 5. Offline `orders-offline.html` | Firefox | | |
| 6. Print / PDF and CSV export | Chrome | | |

## Scorer output

Paste the table `score.mjs` prints for each session.

### Session 1

### Session 2

### Session 3

### Session 4

## Mistakes, repairs and follow-ups

What went wrong, what the assistant or the person did about it, and what changes in the guide, the skill or the format (with the PR that makes them).

## Release-readiness review

Copy the requirement table of [DATA-T22.md](DATA-T22.md#release-readiness-review) with each item's evidence and status, the reviewer and the date.

## Verdict

T22: pending.
