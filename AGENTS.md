# Agent guide

Instructions for coding agents (Codex, Claude Code and others) working in this repository. Read [README.md](README.md) for what the project is and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for installation, commands and the folder map; this file adds only how work is done and reviewed here.

## Project in one paragraph

html-office produces single-file HTML documents that carry their content, a browser editor and a format guide: **Slides** (`src/`, `plugin/skills/html-slides/`), **Data** (`packages/data/`, skill in `plugin/skills/html-data/`) and **Text** (`packages/text/`, skill in `plugin/skills/html-text/`). Charts are shared in `packages/shared/charts/`. Durable decisions are ADRs in [docs/decisions/](docs/decisions/); task plans and their status are in `docs/HTML-*-PLAN.md` and `docs/HTML-DATA-PROGRESS.md`.

## Before starting a task

- Current state per product (released, merged, open, next step): [docs/STATUS.md](docs/STATUS.md). Update it in a PR that changes any of these, and fix a status sentence that contradicts `main`.
- Several sessions and worktrees work on this repository at the same time. Run `gh pr list --state open` and `git branch -r` and look for the task ID (F01, T15, …) first. If a PR or branch already covers it, extend or review that work instead of starting again.
- Branch from an up-to-date `main`; never commit to `main` directly.
- **Scope is frozen until the Slides go/stop gate gives its outcome** ([ADR-016](docs/decisions/016-slides-go-stop-gate.md), 27 November 2026). Data and Text take defect fixes only; Slides takes release 0.7.3, the measurement kit and defect fixes. Do not start another feature, and do not fill a result of that measurement that a run did not produce.
- A new product, a cross-product feature or a raised code-size ceiling needs a written decision of the owner that cites measured usage. Ask; do not anticipate it.

## Build and test

```bash
npm ci && npx playwright install chromium
npm test                 # Slides and shared code (builds first)
npm run test:data        # packages/data, unit + browser
npm run test:text        # packages/text, unit + browser
npm --prefix packages/data run format:check
npm --prefix packages/text run format:check
```

- Install `packages/data` and `packages/text` with `npm ci --prefix <package> --ignore-scripts`.
- Generated assets are committed, and CI fails on a stale copy. After changing the Slides engine, theme, guide or bundled tools, run `npm run build`; after changing the Data or Text runtime, tools or shared charts, run `node packages/data/tools/skill.mjs` and `node packages/text/tools/skill.mjs` (`--check` verifies the committed copy).
- A browser script takes its engines from `engineList()` in `tests/helpers/engines.mjs`, never from `process.env` directly, and a new test file must be named in a package script or in the workflow: `tests/ci.test.mjs` checks both.
- `tools/engine-assessment/` is a development-only measurement harness (its `gpt-tokenizer` counts are a proxy); nothing in it ships.

## Review

Pull requests written by one model family get an independent review from the other ("cross-lineage") when they touch what a mistake would damage: a document format, saving and drafts, the clipboard, security and the checkers, and the tools shipped in a skill. For a pull request that changes only documentation, CI or tests, the review is optional: say in the pull request whether it was run. When in doubt, run it. For PRs authored by Claude, the reviewer is the Codex CLI (≥ 0.163) with `gpt-6.1-sol`, read-only:

```bash
codex exec -s read-only -m gpt-6.1-sol \
  -c model_reasoning_effort='"xhigh"' \
  -C <repo> -o <review.md> "<prompt>" < /dev/null
```

- `< /dev/null` is required: without it Codex waits on stdin and never runs in a background task.
- Quota rules:
  - `xhigh` for a PR's first review only; re-verification rounds use `high`;
  - give the reviewer only the PR's own commits (for a stacked PR, `git diff <previous branch>...HEAD`), never the whole stack;
  - point it at the PR's files, not the whole repository;
  - at most one re-verification round per PR; fix anything left with a regression test and report it.
- Generate diffs with plain git (`/usr/bin/git`) if a shell wrapper rewrites `git diff` output.
- Turn each confirmed finding into a fix with a regression test, and record review-driven test cases next to the code they cover.

## CI and merging

- The Tests workflow runs only for pull requests targeting `main` and pushes to `main`. Stacked PRs get no CI; retargeting a PR to `main` does not start it either — push again or close and reopen the PR. (GitHub's `edited` trigger cannot be limited to base changes: it would also run on every title or description edit, and its skipped jobs would replace the real results.)
- A new push to a pull request cancels that pull request's previous run; a push to `main` always keeps its run. The jobs and what each one gates are listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#continuous-integration).
- A human merges. The repository has auto-merge disabled, so `gh pr merge --auto` merges **immediately**: never use it. Merge manually after the checks are green; merges use merge commits.
- When several approved PRs conflict with each other, merge them in the approved order into one `integration/…` branch, resolve once, run every suite locally, then open and merge one integration PR. After resolving `.github/workflows/test.yml`, run `node --test tests/ci.test.mjs`: it fails if a gate left its job, if an engines job lost its job-level `env:` or its last step (which fails when a script ran without Firefox or WebKit), or if an action is no longer pinned. Then regenerate the Slides assets and the Data and Text skills (see Build and test); CI refuses stale copies.

## Writing

- Documentation, commit messages and code comments are in English; match the surrounding density and style.
- Example documents use clearly labelled fictional data.
