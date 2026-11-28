# Brief 1 — Progress update for a steering committee (8 slides)

Subject 1 of [ADR-016](../../decisions/016-slides-go-stop-gate.md): many charts, updated figures. **Fictional**: Halvern Logistics, its programme and every figure are invented for this measurement. The bench gives the generating session the text between the `gate:brief` markers, and the editing session the text between the `gate:edits` markers; the scripted move at the end is applied by the bench and shown to no session.

<!-- gate:brief:start -->
## Brief

Produce the progress update that the programme director of Halvern Logistics (a fictional company) presents to the steering committee of Programme Meridian on 14 January 2027. Programme Meridian replaces the warehouse management system at the company's 12 sites. Figures are as at 31 December 2026.

### General requirements

- Language: English. Format 16:9. Exactly 8 slides, in the order below, and nothing else (no agenda, no appendix, no closing slide).
- The title of each slide is the sentence given, word for word, without a final full stop.
- Use every figure exactly as given, with its unit. Add no figure, example or claim that is not in this brief.
- All organisations and figures are fictional. Every slide that shows a figure carries the source line "Source: illustrative data (fictional example)" and the visible mention "Illustrative".
- Every slide except the first shows the footer "Halvern Logistics (fictional) · Programme Meridian · Steering committee no. 4" and its page number.
- Each chart shows its title, its unit and every value given.
- Everything else (design, colours, arrangement on the slide) is your choice, in a sober consulting style.

### Slide 1 — Opening

Title: The rollout is on schedule at 7 of 12 sites, and the budget needs a decision on €0.4 million

- Line above or below the title: "Programme Meridian · Steering committee no. 4 · 14 January 2027".
- Mention: "Halvern Logistics is a fictional company. All figures are illustrative."

### Slide 2 — Summary

Title: Three messages for the committee: schedule held, quality improving, one budget decision

Three numbered messages:

1. "Schedule: 7 sites are live at the end of December, against 6 planned."
2. "Quality: picking errors fall below the 0.5 % target three months after each go-live."
3. "Budget: spending is €0.3 million above the plan to date, and the larger sites need more training."

A separate, clearly visible box with the text: "Decision requested: release €0.4 million from the contingency reserve for additional training at the five remaining sites."

### Slide 3 — Schedule

Title: Seven sites are live, one more than planned at the end of December

Column chart, title "Sites live, cumulative", unit "sites", two series over six months of 2026:

| Month | Jul | Aug | Sep | Oct | Nov | Dec |
| --- | --- | --- | --- | --- | --- | --- |
| Plan | 1 | 2 | 3 | 4 | 5 | 6 |
| Actual | 1 | 2 | 2 | 4 | 6 | 7 |

Commentary beside the chart, two points:

- "September: one go-live postponed by four weeks after a failed data migration test."
- "November: two sites went live together, which recovered the delay."

### Slide 4 — Budget

Title: Spending stands at €6.9 million, €0.3 million above the plan to date

Column chart, title "Programme spending per quarter, 2026", unit "€ million", two series:

| Quarter | Q1 | Q2 | Q3 | Q4 |
| --- | --- | --- | --- | --- |
| Plan | 1.2 | 1.6 | 1.9 | 1.9 |
| Actual | 1.1 | 1.7 | 2.0 | 2.1 |

Commentary beside the chart, three points:

- "Plan to date: €6.6 million. Actual: €6.9 million."
- "Total budget: €9.8 million, plus a contingency reserve of €0.8 million, untouched so far."
- "The overrun comes from external integration work in the third and fourth quarters."

### Slide 5 — Quality

Title: Picking errors fall below the 0.5 % target three months after each go-live

Line chart, title "Order-picking error rate after go-live", unit "% of order lines", two series by month after go-live (wave 2 has no data yet for months 4 and 5):

| Month after go-live | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Wave 1 (3 sites) | 1.4 | 1.1 | 0.8 | 0.4 | 0.4 | 0.3 |
| Wave 2 (4 sites) | 1.6 | 1.0 | 0.7 | 0.4 | | |

Commentary, two points:

- "Target: 0.5 % of order lines. Before the programme: 0.9 %."
- "Wave 2 improved faster because the trainers of wave 1 stayed on site for the first two weeks."

### Slide 6 — Risks

Title: Two of the five open risks need action before the next wave

Table with five rows and these columns:

| Risk | Likelihood | Impact | Owner | Action before 1 March |
| --- | --- | --- | --- | --- |
| Too little training time at the larger sites | High | High | Programme director | Release the training budget |
| Integration partner short of testers | High | Medium | IT director | Confirm two testers by 5 February |
| Peak season overlaps the last go-lives | Medium | High | Operations director | None: under watch |
| Legacy scanners incompatible at two sites | Medium | Medium | IT director | None: replacement ordered |
| Key users leaving during the rollout | Low | Medium | Site managers | None: under watch |

The two rows with an action (the first two) are visibly distinguished from the other three.

### Slide 7 — Training

Title: Training hours per site must rise from 310 to 420 for the larger sites

Horizontal bar chart, title "Training hours delivered per live site", unit "hours", seven bars:

| Site | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hours | 280 | 295 | 300 | 310 | 320 | 330 | 335 |

Beside the chart:

- "Average of the seven live sites: 310 hours."
- "Need at each of the five remaining sites, which are larger: 420 hours."
- A highlighted line: "Cost of the extra training: 5 sites × 110 hours × €730 per hour ≈ €0.4 million."

### Slide 8 — Next steps

Title: The next wave starts on 1 March if the training budget is released in January

Four dated steps, in this order:

1. "14 January: decision of the steering committee on the training budget."
2. "5 February: testers confirmed by the integration partner."
3. "1 March: wave 3 starts at sites H and I."
4. "Steering committee no. 5: 15 April 2027."

Closing sentence, visible: "Without the decision, wave 3 moves to May and overlaps the peak season."
<!-- gate:brief:end -->

<!-- gate:edits:start -->
## Three later edits

Slide numbers are those of the deck before these changes.

1. **Updated figures on slide 4.** The actual spending of the fourth quarter is €2.3 million instead of €2.1 million. Update the chart. The commentary's first point becomes "Plan to date: €6.6 million. Actual: €7.1 million." The title becomes: "Spending stands at €7.1 million, €0.5 million above the plan to date". On slide 2, the third message becomes: "Budget: spending is €0.5 million above the plan to date, and the larger sites need more training."
2. **A new slide after slide 5.** Title: "User satisfaction reaches 7.8 out of 10 at the live sites, up from 6.9 before the rollout". Column chart, title "Satisfaction of warehouse staff with the system", unit "score out of 10", one series: Before the rollout 6.9; 1 month after go-live 6.4; 3 months after 7.2; 6 months after 7.8. One sentence of commentary: "Satisfaction dips in the first month, then passes its starting level by the third." The slide carries the source line, the mention "Illustrative", the footer and its page number like the others; the slides after it are renumbered.
3. **A reworded message on slide 8.** The title becomes: "Wave 3 starts on 1 March, provided the training budget is released this month". The closing sentence becomes: "Without the decision, wave 3 moves to May, into the peak season."
<!-- gate:edits:end -->

## Scripted move (bench only)

Applied to the generated file before the edits. `dx` and `dy` are fractions of the slide's width and height; negative is left and up.

```json
{
  "dx": -0.02,
  "dy": -0.02,
  "targets": [
    { "slide": 2, "kind": "text", "contains": "Decision requested", "label": "the box that starts with \"Decision requested\"" },
    { "slide": 4, "kind": "chart", "label": "the chart" },
    { "slide": 7, "kind": "chart", "label": "the chart" }
  ]
}
```

The chart of slide 4 is moved and then edited (edit 1); the box of slide 2 sits on a slide whose text changes (edit 1); the chart of slide 7 sits after the inserted slide (edit 2).
