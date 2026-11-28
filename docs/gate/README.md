# Measurement kit for the Slides go/stop gate

The kit that [ADR-016](../decisions/016-slides-go-stop-gate.md) orders: five briefs with their edits, a defect list, a bench, and the token cost of an edit on the example decks. The ADR holds the protocol, the thresholds and the three outcomes; nothing here changes them. Results go in [VALIDATION-V1.md](../VALIDATION-V1.md).

The bench is a development tool: nothing in it ships, and it adds no package to any `package.json`.

| Part | Where | What it is |
| --- | --- | --- |
| Briefs | [briefs/](briefs/) | Five fictional subjects. Each file fixes every slide's title, content and figures, then the three later edits, then the scripted move. The same text goes to both formats. |
| Defect list | [DEFECTS.md](DEFECTS.md) | Nine codes, one class each (blocking or minor), the counting rules, what a usable run is, and the instructions given to the counter. |
| Bench | [`tools/gate-bench/`](../../tools/gate-bench/) | Plain Node: sessions, scripted move, rendering, count, sample, grid. |
| Token cost of an edit | [EDIT-TOKEN-COST.md](EDIT-TOKEN-COST.md) | Generated table for the two example decks. |

## What a run is

For one subject, one format and one run number, the bench does this, with no human step:

1. **Generation.** A new headless Claude Code session (`claude -p`, model `claude-opus-5-5`, effort `high`) receives the brief and one skill: `html-slides` from `plugin/skills/html-slides/` of this repository, or the assistant's own `pptx` skill. It writes `deck.html` or `deck.pptx`. The bench records wall time and the session's own usage report.
2. **Scripted move.** The bench shifts the elements that the brief names by 2 % of the slide's width and height, up and to the left, on a copy of the file.
3. **Three edits.** A second new session receives the moved file, the three edits and the same skill, and nothing of the first session. Time and usage are recorded the same way.
4. **Moves kept?** The bench compares the position of each moved element with where the move left it.
5. **Rendering.** The final file becomes a PDF, and the PDF becomes page images.

The count (a Codex call per result), the owner's sample and the grid come after the runs.

### What a session is given

- The prompt: one sentence that names the format and the skill, three working rules (where to save, nobody answers questions, no installation and no network), then the brief or the edits. Only the first sentence and the file name differ between formats ([`lib/session.mjs`](../../tools/gate-bench/lib/session.mjs)).
- One skill, in a plugin folder staged for that session alone (`--plugin-dir`).
- The tools `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill` and `Task`, without prompts. No network tool; `npm install`, `pip install`, `brew`, `curl` and `wget` are refused.
- Nothing of the operator's setup: `--setting-sources ""` leaves out user and project settings, `CLAUDE.md`, user skills, user plugins and hooks; `--strict-mcp-config` leaves out MCP servers; auto-memory and the claude.ai connectors are switched off; the session is not saved. The session's working folder is new and outside any Git repository.
- Claude Code's built-in skills and plugins stay (they cannot be removed without removing the staged skill too). They are the same for both formats; each record lists the skills offered and the skills invoked.

### The scripted move

It stands for a person's manual positioning (ADR-016 §3) and is the same on both sides: the same elements, named by the brief, moved by the same fraction of the slide.

- **html-slides:** a real drag in the deck's own editor, in Chromium, with Alt held (a free move, without snapping). The editor detaches the slide and writes the positional `style` geometry (`--x`, `--y`, `--w`, `--h`) as it does for a person; the file is what Save writes. No engine logic is reimplemented in the bench.
- **`.pptx`:** the offsets (`a:off`) of the shapes in the slide XML. A placeholder that inherits its position from the layout gets its own geometry, as PowerPoint writes it when the shape is dragged. Only the offsets change; the rest of the package is untouched.
- **Which element.** A chart is the slide's chart; a table is the slide's table; a text target is the smallest element that contains the quoted words. In html-slides the unit is a direct child of the slide (what a person can grab in the editor). In a `.pptx`, where a box is often a text shape on a backing rectangle, the backing shape and what sits on it move with the text.
- **Kept.** After the edits, each moved element is found again (by its identifier; else by kind and text; else, for a chart or a table, as the only one on the most similar slide) and its top-left corner must be within 1.5 px on a 1,280 px slide of where the move left it. This is the tolerance of the html-slides checker, applied to both formats.
- A target that cannot be found in a generated file is reported and not guessed. If none can be applied, the run's "moves kept" is undecided and the grid refuses to compute until a person has looked.

### Rendering

One path for both formats, as ADR-016 §5 requires: PDF, then page images.

| Step | Tool | Note |
| --- | --- | --- |
| html-slides → PDF | The skill's own export (`deck.mjs pdf`), Chromium through Playwright | Already a dependency of this repository |
| `.pptx` → PDF | Microsoft PowerPoint, driven by AppleScript | What a recipient's PowerPoint shows. About 30 seconds per file |
| PDF → PNG, 1,600 px wide | The system's PDFKit (`osascript -l JavaScript`) | The same for both formats |

Nothing is installed for rendering. This settles the point that ADR-016 left to the pilot ("PowerPoint or LibreOffice"): PowerPoint, because it is on the measuring machine and is the program a client opens the file with. The bench is therefore macOS only.

PowerPoint is one application for the whole machine: conversions run one at a time, the bench opens a copy of the deck under a random name and closes only that copy. Do not work in PowerPoint during a campaign. A deck that makes PowerPoint show a repair prompt does not convert: the run is recorded as "does not open", and the prompt has to be dismissed by hand before the next conversion.

## Before the first run

On the measuring Mac:

1. `npm ci && npx playwright install chromium` in this repository (the html-slides skill needs Playwright 1.62.1; the bench links it for the sessions).
2. Claude Code's command line, logged in: `claude`, then `/login`. The desktop application's login does not serve headless sessions.
3. The Codex CLI, logged in, for the count ([AGENTS.md](../../AGENTS.md), "Review").
4. Microsoft PowerPoint.
5. The assistant's PowerPoint skill on disk. Claude Desktop installs it under `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/…/skills/pptx`; the bench finds the most recent copy, or takes the folder named by `GATE_PPTX_SKILL`. It is not copied into this repository.
6. What that skill's `SKILL.md` lists as preinstalled, reachable from a session: see [the PowerPoint skill's environment](#the-powerpoint-skills-environment).
7. A folder for the runs, **outside any Git repository** (the bench refuses otherwise), for example `~/gate-bench-runs/<name>`. One folder per campaign; the pilot has its own.

```bash
node tools/gate-bench/gate.mjs doctor --runs ~/gate-bench-runs/<name>
```

prints what it finds: both skills with their versions, Playwright, the PowerPoint skill's dependencies, PowerPoint, the two command lines. `run`, `pilot` and `campaign` refuse to start when something is missing (`--force` starts anyway and records the environment as it is).

### The PowerPoint skill's environment

PENDING

## Running

Sessions run one after the other. A campaign is resumable: a run that already has its `record.json` is skipped (`--redo` runs it again).

```bash
# The pilot: one subject, one run per format, then the count and a provisional grid.
node tools/gate-bench/gate.mjs pilot --runs ~/gate-bench-runs/pilot --subject 3

# The campaign: 30 generations and 30 series of edits, in a shuffled order that is recorded.
node tools/gate-bench/gate.mjs campaign --runs ~/gate-bench-runs/campaign
node tools/gate-bench/gate.mjs count --runs ~/gate-bench-runs/campaign          # one Codex call per result
node tools/gate-bench/gate.mjs sample --runs ~/gate-bench-runs/campaign         # about twenty pages for the owner
node tools/gate-bench/gate.mjs sample-compare --runs ~/gate-bench-runs/campaign # after the owner has filled the form
node tools/gate-bench/gate.mjs grid --runs ~/gate-bench-runs/campaign           # reads judgement.json if present

# One run alone, for a retry or a check.
node tools/gate-bench/gate.mjs run --runs ~/gate-bench-runs/campaign --subject 2 --format pptx --run 3
```

What the runs folder holds:

| Path | Content |
| --- | --- |
| `environment.json` | What `doctor` found when the pilot or campaign started |
| `campaign-order.json` | The seed and the order of the 30 runs |
| `subject-N/<format>/run-K/record.json` | The run's record: skill version, both sessions (time, tokens per model, turns, skills offered and invoked, machine load before and after), the move, moves kept, rendering, totals |
| `…/gen/`, `…/edit/` | The working folder of each session, as it left it; `gen.log.jsonl` and `edit.log.jsonl` are the sessions' event streams |
| `…/moved/` | The file after the scripted move, and its page images (evidence of what the move did before any edit) |
| `…/render/deck.pdf`, `…/render/pages/` | The final PDF and its page images: what is counted and what the owner judges |
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
| Judgement per subject | `subject-N/<format>/run-K/render/deck.pdf`. To judge without knowing the format, have someone copy the PDFs under neutral names | `judgement.json`, below |
| Sharing check | A generated `deck.html` from any run | `judgement.json`, below |

`judgement.json`, in the runs folder:

```json
{
  "preferences": { "1": "html-slides", "2": "equivalent", "3": "pptx", "4": "equivalent", "5": "html-slides" },
  "sharing": "passed"
}
```

`preferences` takes `html-slides`, `pptx` or `equivalent` per subject; `sharing` takes `passed`, `failed` or `not-checked`. The values above only show the shape.

The one retry of ADR-016 §6 ("a result close to a boundary") is the owner's call: `grid.md` prints the ratios and counts next to their thresholds and does not say what "close" is.

## Readings fixed by the kit

Where ADR-016 leaves a choice open, the kit takes the plainest reading, the same for both formats, and says so here. None changes a rule, a threshold, a subject or an outcome.

| Point | Reading |
| --- | --- |
| Tokens of a run | Every token the models read or wrote in the two sessions, as Claude Code reports per model: input, output, cache writes and cache reads, subagents included. The record also keeps each category and the estimated cost, so that another reading can be computed later without a new run. |
| Time of a run | Wall time of the generation session plus the editing session. The scripted move, the rendering and the count are not charged. |
| Minor defects of a format | The sum over its counted runs. A run that does not open has no count. |
| "25 % fewer" and "25 % more" | A real difference is needed: with no minor defect on either side, neither holds. |
| "The less favourable measure" | The one of time and tokens on which html-slides does worst against PPTX. |
| "The gain reaches 50 %" | On both measures. |
| Sharing check failed while the grid says Continue | The grid reports it and names no outcome: the ADR gives none. |
| No usable run in either format | The cost is undefined and the grid reports that it cannot be read. |
| "A file that passes the format's own checks" | The session is told to work until its skill's checks pass, with no human step. The bench then runs the format's check itself (`check.mjs`, `validate.py`) and records the result for information. It takes no part in usability: ADR-016 §5 keeps the html-slides checker out of the count. A session that ends without a file is a run that does not open. |
| Class of each defect | One class per code; "text" and "overlap" are split by whether something can no longer be read, "missing content" by whether it is content or a secondary mention ([DEFECTS.md](DEFECTS.md)). |
| Content added beyond the brief | Not a defect: the ADR's list counts what is missing or wrong. |
| Defects on moved elements | Their position, and any misalignment or harmless overlap that involves them, are not counted; cut or hidden text is. |

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
- **PowerPoint renders the `.pptx`, Chromium the html-slides.** Each format is shown by the program its recipient uses, so a rendering difference between LibreOffice and PowerPoint is not counted against PPTX.
- **Timing depends on the machine and on the service.** Wall time includes the model's response time, which varies with the hour.
- **Claude Code's built-in skills are present** in every session, for both formats.
- **The token table is a proxy** (OpenAI's tokenizer); the sessions' usage reports are the measured figures.

## Tests

```bash
node --test tools/gate-bench/tests/*.test.mjs        # grid, briefs, .pptx move, count, session reading
node tools/gate-bench/tests/html-move.browser.mjs    # the html-slides move, in Chromium
node tools/gate-bench/edit-cost.mjs --check          # the committed token table is current
```

The grid's tests cover every cell and every boundary on invented inputs. These suites are not yet part of `npm test` or of the CI workflow.
