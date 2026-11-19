# T20 blind-test kit (html-text)

The material of the [T20 protocol](../../../../docs/blind-tests/TEXT-T20.md); the method, the models, the thresholds and the decisions are in the [blind-test README](../../../../docs/blind-tests/README.md).

| File | Role |
| --- | --- |
| [`PROMPTS.md`](PROMPTS.md) | The exact prompts, track A (HTML only) and track B (skill) |
| `inputs/` | Fictional inputs for track B: a brief, a cash update, a colleague's Markdown draft |
| `tasks.mjs` | The tasks' fixed data (comment threads, the table to add, the chart values) and their objective checks |
| `prepare.mjs` | Builds a kit folder outside the repository: the T19 report with three threads for track A, the inputs and the 100-page fixture for track B, the skill, the prompts and the baselines |
| `score.mjs` | Runs the checks on what a session produced, with the kit's own skill tools, and prints a Markdown table for the results sheet |

```bash
node packages/text/acceptance/blind/prepare.mjs ~/blind-tests/t20-claude [--skill <extracted>/skills/html-text]
```

```bash
node packages/text/acceptance/blind/score.mjs ~/blind-tests/t20-claude [--task A2] [--json]
```

Every name, figure and comment is fictional. `tests/blind-kit.test.mjs` checks that the prompts, inputs and checks agree, builds a kit, scores answers made correctly with the skill's tools (every check passes) and answers that break the rules (an unrelated section changed, the planted instruction obeyed), whose faults it must name.
