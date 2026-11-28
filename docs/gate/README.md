# Measurement kit for the Slides go/stop gate

The kit that [ADR-016](../decisions/016-slides-go-stop-gate.md) orders: five briefs with their edits, a defect list, a bench, and the token cost of an edit on the example decks. The ADR holds the protocol, the thresholds and the three outcomes; nothing here changes them. Results go in [VALIDATION-V1.md](../VALIDATION-V1.md).

The bench is a development tool: nothing in it ships, and it adds no package to any `package.json` of this repository.

| Part | Where | What it is |
| --- | --- | --- |
| Briefs | [briefs/](briefs/) | Five fictional subjects. Each file fixes every slide's title, content and figures, then the three later edits, then the scripted move. The same text goes to both formats. |
| Defect list | [DEFECTS.md](DEFECTS.md) | Nine codes, one class each (blocking or minor), the counting rules, and the instructions given to the counter. |
| Bench | [`tools/gate-bench/`](../../tools/gate-bench/) | Plain Node: sessions, scripted move, rendering, count, sample, grid. |
| Token cost of an edit | [EDIT-TOKEN-COST.md](EDIT-TOKEN-COST.md) | Generated table for the two example decks. |

## What a run is

For one subject, one format and one run number, the bench does this, with no human step:

1. **Usage check.** A session that does nothing shows the login in use and the subscription's usage windows. The run does not start above the ceiling given [below](#failed-runs-and-void-runs).
2. **Generation.** A new headless Claude Code session (`claude -p`, model `claude-opus-5-5`, effort `high`) receives the brief and one skill: `html-slides` from `plugin/skills/html-slides/` of this repository, or the assistant's own `pptx` skill. It writes `deck.html` or `deck.pptx`. The bench records wall time and the session's own usage report.
3. **Scripted move.** The bench shifts the elements that the brief names by 2 % of the slide's width and height, up and to the left, on a copy of the file.
4. **Three edits.** A second new session receives the moved file, the three edits and the same skill, and nothing of the first session. Time and usage are recorded the same way.
5. **The final file.** The bench runs the format's own check on it (`check.mjs` for html-slides, the skill's `validate.py` for `.pptx`), compares the position of each moved element with where the move left it, and renders the file to a PDF and to page images.

The count (one Codex call per result), the owner's sample and the grid come after the runs.

### What a session is given

- The prompt: one sentence that names the format and the skill, three working rules (where to save, nobody answers questions, no installation and no network), then the brief or the edits. Only the first sentence and the file name differ between formats ([`lib/session.mjs`](../../tools/gate-bench/lib/session.mjs)).
- One skill, in a plugin folder staged for that session alone (`--plugin-dir`).
- The tools `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill` and `Task`, without prompts. No network tool; `npm install`, `pip install`, `brew`, `curl` and `wget` are refused.
- Nothing of the operator's setup: `--setting-sources ""` leaves out user and project settings, `CLAUDE.md`, user skills, user plugins and hooks; `--strict-mcp-config` leaves out MCP servers; auto-memory and the claude.ai connectors are switched off; the session is not saved; the variables of a surrounding Claude session are removed. The session's working folder is new and outside any Git repository.
- Claude Code's built-in skills and plugins stay (they cannot be removed without removing the staged skill too). They are the same for both formats; each record lists the skills offered and the skills invoked.

### Failed runs and void runs

Fixed before the pilot, the same for both formats (ADR-016 §3).

**Time limits**, in wall-clock time:

- Generation: 45 minutes.
- The three edits: 30 minutes.

At its limit a session is ended by the bench.

**A run has failed** when one of these happens. It still counts: its time and tokens, up to the failure or the limit, enter the totals, and it is not usable.

- A session reaches its time limit.
- A session ends with an error that comes from the work itself.
- The generation ends without `deck.html` or `deck.pptx` in its folder, or the edits end with that file gone.

A failed generation ends the run: no move, no edits. A failed run has no final result: no check, no count, and "no result" in its slot when the owner judges the subject. For a session that was cut off, input and cache tokens are those of the model calls that had started; its output tokens are only those announced when each answer began, so they are slightly under-counted.

**A run is void** when a cause outside the format cut it off. It is recorded with its reason, set aside (`run-K.void-N`), enters no total, and is run again under the same number.

- The subscription's usage limit was reached, or the login was lost.
- The service or the network failed (an API error, a connection error).
- The session stopped without a report before its time limit: the bench was interrupted, or the machine slept. The bench holds the machine awake during a session (`caffeinate`), which does not cover a closed lid.
- The bench itself could not apply the scripted move because of an error of its own.

The bench recognises the first three from the session's events and the fourth from its own error. A person who knows of another outside cause declares it with `gate.mjs void … --reason "…"`.

**Usage ceiling.** A run is not started when the usage check shows more than 80 % of the five-hour window or 95 % of the seven-day window in use, or an account that is using overage. `pilot` and `campaign` stop there and say when the window resets; the same command resumes them. This avoids discovering the limit in the middle of a run.

**A run that finished can still be unusable** (ADR-016 §6): its final file does not open, fails its format's own check, has a blocking defect, or lost the scripted moves.

### The scripted move

It stands for a person's manual positioning (ADR-016 §3) and is the same on both sides: the same elements, named by the brief, moved by the same fraction of the slide.

- **html-slides:** a real drag in the deck's own editor, in Chromium, with Alt held (a free move, without snapping). The editor detaches the slide and writes the positional `style` geometry (`--x`, `--y`, `--w`, `--h`) as it does for a person; the file is what Save writes. No engine logic is reimplemented in the bench. A table is grabbed by the middle of a cell, because the border between two columns resizes the column.
- **`.pptx`:** the offsets (`a:off`) of the shapes in the slide XML. A placeholder that inherits its position from the layout gets its own geometry, as PowerPoint writes it when the shape is dragged. Only the offsets change; the rest of the package is untouched.
- **Which element.** A chart is the slide's chart; a table is the slide's table; a text target is the smallest element that contains the quoted words. In html-slides the unit is a direct child of the slide (what a person can grab in the editor). In a `.pptx`, where a box is often a text shape on a backing rectangle, the backing shape and what sits on it move with the text.
- **Kept.** After the edits, each moved element is found again (by its identifier; else by kind and text; else, for a chart or a table, as the only one on the most similar slide) and its top-left corner must be within 1.5 px on a 1,280 px slide of where the move left it. This is the tolerance of the html-slides checker, applied to both formats. An element whose size changed keeps its place if its corner did.
- A target that cannot be found in a generated file is reported and not guessed; the others are moved and judged. If none can be applied, "moves kept" is undecided and the grid refuses to compute until a person has looked.

### Rendering

One path for both formats, as ADR-016 §5 requires: PDF, then page images.

| Step | Tool | Note |
| --- | --- | --- |
| html-slides → PDF | The skill's own export (`deck.mjs pdf`), Chromium through Playwright | Already a dependency of this repository |
| `.pptx` → PDF | Microsoft PowerPoint, driven by AppleScript | What a recipient's PowerPoint shows. About 30 seconds per file |
| PDF → PNG, 1,600 px wide | The system's PDFKit (`osascript -l JavaScript`) | The same for both formats |

This settles the point that ADR-016 left to the pilot ("PowerPoint or LibreOffice") for the bench's own rendering: PowerPoint, because it is the program a client opens the file with. The bench is therefore macOS only. LibreOffice is installed too, but for another purpose: the PowerPoint skill uses it for its own visual check during a session ([below](#the-powerpoint-skills-environment)).

"The final file opens" means: this conversion gives a PDF of at least one page.

PowerPoint is one application for the whole machine: conversions run one at a time, the bench opens a copy of the deck under a random name and closes only that copy. Do not work in PowerPoint during a campaign. A deck that makes PowerPoint show a repair prompt does not convert: the run is recorded as "does not open", and the prompt has to be dismissed by hand before the next conversion.

## Before the first run

On the measuring Mac:

1. `npm ci && npx playwright install chromium` in this repository (the html-slides skill needs Playwright 1.62.1; the bench links it for the sessions).
2. Claude Code's command line, logged in: `claude`, then `/login`. The desktop application's login does not serve headless sessions.
3. The Codex CLI, logged in, for the count ([AGENTS.md](../../AGENTS.md), "Review").
4. Microsoft PowerPoint.
5. The assistant's PowerPoint skill on disk. Claude Desktop installs it under `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/…/skills/pptx`; the bench finds the most recent copy, or takes the folder named by `GATE_PPTX_SKILL`. It is not copied into this repository.
6. A **bench folder outside any Git repository**, for example `~/gate-bench-runs`. It holds what the PowerPoint skill lists as preinstalled (next section) and, below it, one runs folder per pilot or campaign: `~/gate-bench-runs/<name>`. The bench refuses a folder inside a repository, so that a session finds no project around it.

```bash
node tools/gate-bench/gate.mjs doctor --runs ~/gate-bench-runs/<name>   # what is installed, with versions
node tools/gate-bench/gate.mjs usage --runs ~/gate-bench-runs/<name>    # the login in use and the usage windows
```

`run`, `pilot` and `campaign` refuse to start when something is missing.

### The PowerPoint skill's environment

Each skill runs with what its own instructions list as available, already installed; installing is not part of what is measured, and the sessions may not install anything. For html-slides this is Node and Playwright 1.62.1 with Chromium, which the repository already has. The PowerPoint skill's `SKILL.md` lists `pptxgenjs`, four Python libraries, LibreOffice (`soffice`) and `pdftoppm` for its own checks, and four packages for icons. The owner chose on 27 November 2026 to install them as they are, with no substitute:

```bash
brew install --cask libreoffice
brew install poppler
npm install --prefix ~/gate-bench-runs pptxgenjs@4.0.1 react@19.3.1 react-dom@19.3.1 react-icons@5.7.0 sharp@0.35.5
python3 -m venv ~/gate-bench-runs/pyenv
~/gate-bench-runs/pyenv/bin/pip install python-pptx Pillow lxml defusedxml
```

The npm packages and the Python environment live in the bench folder, outside this repository. A session finds them through its `PATH` (`pyenv/bin` first, which gives `python`) and through Node's lookup of `node_modules` in the folders above its own.

The measuring machine's setup, for the pilot of 28 November 2026:

| Item | Version | Source |
| --- | --- | --- |
| Machine | Apple silicon, 10 cores, 24 GB, macOS 27.2.1 | |
| Node | 26.0.0 | Homebrew |
| Claude Code (command line) | 2.1.332, logged in with a claude.ai subscription | |
| Codex CLI | 0.171.0 | |
| Microsoft PowerPoint | 16.115.2 | |
| html-slides skill | 0.7.2, `plugin/skills/html-slides` at commit `2870721` | This repository |
| Playwright, Chromium | 1.62.1, build 1234 | `npm ci` in this repository |
| PowerPoint skill | `pptx` of the `anthropic-skills` plugin, updated 16 November 2026; SHA-256 of its `SKILL.md` `c01efd47…` | Claude Desktop |
| LibreOffice, poppler, the npm packages, the Python environment | Not installed yet at this commit; versions are recorded here when they are | The commands above |

`doctor` prints these values; each run's record keeps the skill version it used.

## Running

Sessions run one after the other. `pilot` and `campaign` are resumable: a run that already has its `record.json` is skipped, and the command stops at a void run or a full usage window.

```bash
# The pilot: one subject, one run per format, then the count and a provisional grid.
node tools/gate-bench/gate.mjs pilot --runs ~/gate-bench-runs/pilot --subject 3

# The campaign: 30 generations and 30 series of edits, in a shuffled order that is recorded.
node tools/gate-bench/gate.mjs campaign --runs ~/gate-bench-runs/campaign
node tools/gate-bench/gate.mjs count --runs ~/gate-bench-runs/campaign          # one Codex call per result
node tools/gate-bench/gate.mjs sample --runs ~/gate-bench-runs/campaign         # about twenty pages for the owner
node tools/gate-bench/gate.mjs sample-compare --runs ~/gate-bench-runs/campaign # after the owner has filled the form
node tools/gate-bench/gate.mjs grid --runs ~/gate-bench-runs/campaign           # reads judgement.json if present

# One run alone; --resume continues after a generation that is already recorded.
node tools/gate-bench/gate.mjs run --runs ~/gate-bench-runs/campaign --subject 2 --format pptx --run 3
# A run that an outside cause cut off, when the bench did not see it by itself.
node tools/gate-bench/gate.mjs void --runs ~/gate-bench-runs/campaign --subject 2 --format pptx --run 3 --reason "the lid was closed"
```

The pilot's two runs are extra: they have their own runs folder and do not enter the campaign's results (ADR-016 §8).

What a runs folder holds:

| Path | Content |
| --- | --- |
| `environment.json` | What `doctor` found when the pilot or campaign started |
| `campaign-order.json` | The seed and the order of the 30 runs |
| `subject-N/<format>/run-K/record.json` | The run's record: skill version, usage windows before and after, both sessions (time, tokens per model, turns, skills offered and invoked, machine load), the move, the final check, moves kept, rendering, totals |
| `…/gen/`, `…/edit/` | The working folder of each session, as it left it; `gen.log.jsonl` and `edit.log.jsonl` are the sessions' event streams |
| `…/moved/` | The file after the scripted move, and its page images (evidence of what the move did before any edit) |
| `…/render/deck.pdf`, `…/render/pages/` | The final PDF and its page images: what is counted and what the owner judges |
| `subject-N/<format>/run-K.void-N/` | A void run, with its reason in `record.json` |
| `count/deck-xxxxx/` | What one counter sees: the pages of one result under a random name, the expected content, the instructions |
| `count-key.json`, `counts.json` | Which result each random name is; the counter's answers and totals |
| `sample/`, `sample-key.json` | The owner's sample, its form, and which pages were drawn |
| `results.json`, `grid.json`, `grid.md` | One line per run as the grid reads it; the grid's reading |

After a campaign, copy `results.json`, `counts.json`, `count-key.json`, `campaign-order.json`, `environment.json`, `judgement.json` and `grid.md` into `docs/gate/results/<date>/` and commit them; the folders of the runs stay outside the repository.

### The count

`count` gives each rendered result a random name, in a shuffled order, and calls the counter once per result with the command of [AGENTS.md](../../AGENTS.md) (`codex exec -s read-only -m gpt-6.1-sol`, reasoning effort `high`; `--effort` changes it), the page images attached. The counter is given the instructions and the expected content, and is not told the format ([DEFECTS.md](DEFECTS.md)). An answer that skips a page, names an unknown code or is not JSON is refused and reported; `count` run again retries it. Page order inside a result is kept, because missing or misplaced slides are defects.

### Timing

Each record gives the wall time of the two sessions and the time Claude Code itself reports (`durationMs`, `durationApiMs`). The grid uses wall time, generation plus edits. The machine's load average is recorded before and after each session: on a machine busy with other work, the tool-running part of a session is slower, for both formats. Run the campaign with the machine otherwise idle if possible, and look at the recorded load before comparing two runs.

## What stays manual

Four steps need a person. They are described in [MANUAL-CHECKS.md §9](../MANUAL-CHECKS.md#9-slides-gostop-gate-the-owners-part-adr-016).

| Step | What the bench provides | What the owner writes |
| --- | --- | --- |
| One hour in the desktop applications | Nothing: it does not change the measurement | Notes |
| Sample of the defect count | `sample/` with about twenty pages and `FORM.csv`; `sample-compare` prints both counts side by side | The form. Whether the counts "differ clearly" is the owner's judgement |
| One preference per subject | For each format, three run slots: `subject-N/<format>/run-K/render/deck.pdf` where it exists, "no result" otherwise. To judge without knowing the format, have someone copy the PDFs under neutral names | `judgement.json`, below |
| Sharing check | A generated `deck.html` from any run | `judgement.json`, below |

`judgement.json`, in the runs folder:

```json
{
  "preferences": { "1": "html-slides", "2": "equivalent", "3": "pptx", "4": "equivalent", "5": "html-slides" },
  "sharing": "not-checked"
}
```

`preferences` takes `html-slides`, `pptx` or `equivalent` per subject; a subject for which neither format produced a final PDF is `equivalent` without being asked. `sharing` takes `not-checked`, `passed`, `failed-once` (what blocked is being fixed, and the check will be repeated once) or `failed-twice`. The values above only show the shape.

`grid` then prints the two axes with D and R next to their thresholds, the cell and the outcome. While the sharing check is not passed, a cell of Continue reads "Continue (pending the sharing check)"; after a second failure it reads "Maintain Slides alone". The results are read once: there is no retry.

## Readings fixed by the kit

Where ADR-016 leaves a practical point open, the kit takes the plainest reading, the same for both formats, and says so here. None changes a rule, a threshold, a subject or an outcome.

| Point | Reading |
| --- | --- |
| Tokens of a run | Every token the models read or wrote in the two sessions, as Claude Code reports per model: input, output, cache writes and cache reads, subagents included. The record also keeps each category and the estimated cost at list price, so that another reading can be computed later without a new run. |
| Time of a run | Wall time of the generation session plus the editing session. The usage check, the scripted move, the checks, the rendering and the count are not charged. |
| "Passes its format's own checks" | `check.mjs` of the html-slides skill and `validate.py` of the PowerPoint skill, run by the bench on the final file. |
| The final file "opens" | The bench's rendering gives a PDF of at least one page. |
| A final result | Exists only when both sessions finished. A run that failed shows "no result" to the owner and is not counted. |
| Class of each defect | One class per code; "text" and "overlap" are split by whether something can no longer be read, "missing content" by whether it is content or a secondary mention ([DEFECTS.md](DEFECTS.md)). |
| Content added beyond the brief | Not a defect: the ADR's list counts what is missing or wrong. |
| Defects on moved elements | Their position, and any misalignment or harmless overlap that involves them, are not counted; cut or hidden text is. |
| PPTX without a usable run, html-slides with at least one | Quality is better and cost is cheaper, as §6 writes it, whatever the owner's preferences. |

## Limits

Those ADR-016 lists, which the kit does not remove:

- **The editor is not measured.** Retouching in the browser and in PowerPoint is assumed equivalent, which rather favours html-slides.
- **The count is not truly blind.** A trained eye recognises the format from a page image. The fixed defect list and the owner's sample limit this bias; they do not remove it.
- **The thresholds (25 %, 20 %, 50 %) are judgement**, fixed before measuring.
- **One model.** A result that holds only with the strongest model would be worth knowing; that would be a second campaign.
- **The runtime is not measured.** The runs happen in Claude Code, where the skill works.

And those of the bench itself:

- **The move is small and scripted.** It shows whether an edit keeps hand-placed positions, not how well a person can arrange a slide in either tool.
- **The unit of a move differs.** In html-slides a group of cards is one element; in a `.pptx` each card is its own set of shapes. The briefs choose targets that are one object in both (a chart, a table, a separate box), but a generated file can still build one differently.
- **Two renderers.** The bench shows each format with the program its recipient uses (PowerPoint, Chromium). During its session the PowerPoint skill checks its own work with LibreOffice, as it is written to; a difference between LibreOffice and PowerPoint can therefore leave a defect that the session did not see.
- **Timing depends on the machine and on the service.** Wall time includes the model's response time, which varies with the hour.
- **Claude Code's built-in skills are present** in every session, for both formats.
- **The token table is a proxy** (OpenAI's tokenizer); the sessions' usage reports are the measured figures.

## Tests

```bash
node --test tools/gate-bench/tests/*.test.mjs        # grid, briefs, .pptx move, count, session reading
node tools/gate-bench/tests/html-move.browser.mjs    # the html-slides move, in Chromium
node tools/gate-bench/edit-cost.mjs --check          # the committed token table is current
```

The grid's tests cover every cell, the exact boundaries (0.50, 0.75, 0.80, 1.20, 1.25) and the zero cases, on invented inputs. These suites are not yet part of `npm test` or of the CI workflow.
