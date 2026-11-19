# T22 blind-test kit (html-data)

The material of the [T22 protocol](../../../../docs/blind-tests/DATA-T22.md); the method, the models, the thresholds and the decisions are in the [blind-test README](../../../../docs/blind-tests/README.md).

| File | Role |
| --- | --- |
| [`PROMPTS.md`](PROMPTS.md) | The exact prompts, track A (HTML only) and track B (skill) |
| `inputs/` | Fictional inputs for track B: a solar-roof brief, 60 orders and 40 members as CSV (invented names, codes and amounts) |
| `tasks.mjs` | The tasks' fixed data, the expected values computed from the inputs (independently of any workbook), the reference answers and the objective checks |
| `prepare.mjs` | Builds a kit folder outside the repository: the T21 workbook with a planted instruction for track A, the inputs and the plain workbook for track B, the skill, the prompts and the baselines |
| `score.mjs` | Runs the checks on what a session produced, with the kit's own skill tools (recalculating a copy first), and prints a Markdown table for the results sheet |

```bash
node packages/data/acceptance/blind/prepare.mjs ~/blind-tests/t22-claude [--skill <extracted>/skills/html-data]
```

```bash
node packages/data/acceptance/blind/score.mjs ~/blind-tests/t22-claude [--task B3] [--json]
```

Every name and figure is fictional. `tests/blind-kit.test.mjs` checks that the prompts, inputs and checks agree, builds a kit, scores answers made correctly with the skill's tools (every check passes) and answers that break the rules (the planted instruction obeyed, a value typed where a formula was asked, a change outside the request), whose faults it must name.
