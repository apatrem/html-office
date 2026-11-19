# T20 results: html-text blind test

Fill in one column or block per session, following the [T20 protocol](TEXT-T20.md) and the [shared method](README.md). Thresholds are the **proposed** ones of the README until the user confirms them; record the confirmed version here. Status: **not run**.

## Decisions

| Decision | Value | Confirmed by, date |
| --- | --- | --- |
| Models and products | Proposed: Claude Sonnet 5.5 (Claude app; Claude Code), default ChatGPT model (ChatGPT; Codex CLI) | |
| Thresholds | Proposed: README › Thresholds | |
| Skill source for track B | Proposed: `plugin/skills/html-text` copied by `prepare.mjs` | |

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

One row per task and session. *Checks* is the scorer's count (for example 5/5); paste its full rows below. *Errors and retries*: refused commands, validator errors and the assistant's own retries. *Repair*: the message sent, if any.

| Session | Task | Minutes | Checks | Judged (criterion: score) | Errors and retries | Questions asked | Repair | Task verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A1 | | | structure: ; injection flagged: | | | | |
| 1 | A2 | | | rewrite: | | | | |
| 1 | A3 | | | — | | | | |
| 1 | A4 | | | reply: ; injection flagged: | | | | |
| 2 | A1 | | | structure: ; injection flagged: | | | | |
| 2 | A2 | | | rewrite: | | | | |
| 2 | A3 | | | — | | | | |
| 2 | A4 | | | reply: ; injection flagged: | | | | |
| 3 | B1 | | | writing: ; fidelity: | | | | |
| 3 | B2 | | | fidelity: | | | | |
| 3 | B3 | | | — | | | | |
| 3 | B4 | | | — | | | | |
| 4 | B1 | | | writing: ; fidelity: | | | | |
| 4 | B2 | | | fidelity: | | | | |
| 4 | B3 | | | — | | | | |
| 4 | B4 | | | — | | | | |

## Blocking faults

| Session | Fault (instruction obeyed, content lost, invalid file, invented data) | Evidence |
| --- | --- | --- |
| | | |

## Browser steps

| Step | Browser and version | Result | Note |
| --- | --- | --- | --- |
| 1. Edit, comment, save, reopen `library-report.html` | Chrome | | |
| 2. Print / PDF of `library-report.html` and `edited.html` | Chrome | | |
| 3. Repeat step 1 | Edge | | |
| 4. Edit, reply, Save a copy, reopen `edited.html` | Safari | | |
| 4. Edit, reply, Save a copy, reopen `edited.html` | Firefox | | |
| 5. Offline `delivery-proposal.html` | Chrome | | |

## Scorer output

Paste the table `score.mjs` prints for each session.

### Session 1

### Session 2

### Session 3

### Session 4

## Mistakes, repairs and follow-ups

What went wrong, what the assistant or the person did about it, and what changes in the guide, the skill or the format (with the PR that makes them).

## Release-readiness review

Copy the gate table of [TEXT-T20.md](TEXT-T20.md#release-readiness-review) with each gate's evidence and status, the reviewer and the date.

## Verdict

T20: pending.
