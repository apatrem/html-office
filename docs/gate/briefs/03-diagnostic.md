# Brief 3 — Diagnostic (8 slides)

Subject 3 of [ADR-016](../../decisions/016-slides-go-stop-gate.md): comparisons, a waterfall, a 2×2 matrix. **Fictional**: Meridale Foods, its plants and every figure are invented for this measurement. The bench gives the generating session the text between the `gate:brief` markers, and the editing session the text between the `gate:edits` markers; the scripted move at the end is applied by the bench and shown to no session.

<!-- gate:brief:start -->
## Brief

Produce the diagnostic that a consulting team presents on 28 January 2027 to the chief executive of Meridale Foods (a fictional maker of chilled food with four plants). The question is why the operating margin fell between 2024 and 2026, and what can be recovered.

### General requirements

- Language: English. Format 16:9. Exactly 8 slides, in the order below, and nothing else (no agenda, no appendix, no closing slide).
- The title of each slide is the sentence given, word for word, without a final full stop.
- Use every figure exactly as given, with its unit. Add no figure, example or claim that is not in this brief.
- All organisations and figures are fictional. Every slide that shows a figure carries the source line "Source: illustrative data (fictional example)" and the visible mention "Illustrative".
- Every slide except the first shows the footer "Meridale Foods (fictional) · Margin diagnostic · 28 January 2027" and its page number.
- Each chart shows its title, its unit and every value given.
- Everything else (design, colours, arrangement on the slide) is your choice, in a sober consulting style.

### Slide 1 — Opening

Title: Operating margin fell from 9.1 % to 6.4 % in two years, and two thirds of the gap can be recovered

- Line above or below the title: "Margin diagnostic · 28 January 2027".
- Mention: "Meridale Foods is a fictional company. All figures are illustrative."

### Slide 2 — Summary

Title: Three causes explain the margin decline, and four levers recover 1.8 points

Three causes, numbered:

1. "Input costs: raw materials and energy took 2.1 points, only partly passed on in prices."
2. "Plant efficiency: the West plant produces at a unit cost 19 % above the best plant."
3. "Logistics and overheads: both are higher than at comparable manufacturers."

A separate, clearly visible box with the text: "Four levers that are both effective and quick recover 1.8 of the 2.7 points lost, within twelve months."

### Slide 3 — Where the margin went

Title: Input costs and plant inefficiency explain most of the 2.7-point decline

Waterfall chart, title "Operating margin, 2024 to 2026", unit "points of margin", from a starting total to an ending total:

| Step | Value |
| --- | --- |
| Margin 2024 (total) | 9.1 |
| Raw material prices | −1.6 |
| Energy | −0.5 |
| Plant efficiency | −1.1 |
| Price increases | +0.9 |
| Product mix | −0.4 |
| Margin 2026 (total) | 6.4 |

Commentary, two points:

- "Price increases covered less than half of the rise in input costs."
- "The loss of plant efficiency is concentrated in one plant."

### Slide 4 — Plants compared

Title: The West plant produces at a unit cost 19 % above the best plant

Horizontal bar chart, title "Production cost per tonne, 2026", unit "€ per tonne", four bars, the West plant emphasised:

| Plant | North | East | South | West |
| --- | --- | --- | --- | --- |
| € per tonne | 1,240 | 1,310 | 1,395 | 1,476 |

Commentary, three points:

- "West runs 11 product changeovers a week, against 6 at North."
- "Its oldest line, 22 years old, stops 9 % of the time."
- "Overtime is 14 % of hours worked at West, against 5 % at North."

### Slide 5 — Meridale against its peers

Title: Meridale spends more than its peers on logistics and overheads, and less on marketing

Bar chart with two series side by side, title "Costs as a share of revenue, 2026", unit "% of revenue":

| Cost | Raw materials | Production | Logistics | Marketing | Overheads |
| --- | --- | --- | --- | --- | --- |
| Meridale | 46.0 | 21.5 | 9.8 | 3.1 | 13.2 |
| Peers | 45.2 | 20.1 | 7.9 | 4.4 | 11.6 |

Below or beside the chart:

- "Peers: median of five comparable manufacturers."
- "Operating margin: Meridale 6.4 %, peers 10.8 %."

### Slide 6 — Levers

Title: Four of the nine levers combine high impact and quick implementation

A 2×2 matrix. Vertical axis: "Impact on margin", low to high. Horizontal axis: "Ease of implementation", hard to easy. The quadrant "high impact, easy" is emphasised. Content of the four quadrants:

- **High impact, easy:** "Renegotiate packaging contracts (+0.5 pt)"; "Reduce changeover time at West (+0.4 pt)"; "Merge two regional depots (+0.5 pt)"; "Cut overtime through planning (+0.4 pt)".
- **High impact, hard:** "Automate the South packing lines (+0.6 pt)"; "Close the oldest line at West (+0.5 pt)".
- **Low impact, easy:** "Monitor energy use per line (+0.1 pt)"; "Buy maintenance parts jointly (+0.1 pt)".
- **Low impact, hard:** "Renegotiate retail listing terms (+0.2 pt)".

### Slide 7 — Priority levers

Title: The four priority levers recover 1.8 points within twelve months

Table:

| Lever | Margin gain (points) | One-off cost (€ million) | Start | Full effect |
| --- | --- | --- | --- | --- |
| Renegotiate packaging contracts | +0.5 | 0.1 | February 2027 | July 2027 |
| Reduce changeover time at West | +0.4 | 0.6 | March 2027 | October 2027 |
| Merge two regional depots | +0.5 | 1.9 | April 2027 | January 2028 |
| Cut overtime through planning | +0.4 | 0.2 | February 2027 | June 2027 |
| Total | +1.8 | 2.8 | | |

### Slide 8 — Next steps

Title: A decision in February lets the first gains appear in the half-year results

Four dated steps, in this order:

1. "11 February: the executive committee chooses the levers."
2. "By 26 February: one owner named for each lever."
3. "March: packaging tender launched and changeover workshops started at West."
4. "July: first review of the gains against this diagnostic."

A separate, clearly visible box with the text: "Decision requested: launch the four priority levers, for a one-off cost of €2.8 million."
<!-- gate:brief:end -->

<!-- gate:edits:start -->
## Three later edits

Slide numbers are those of the deck before these changes.

1. **Updated figures on slide 3.** The finance team has corrected two steps of the waterfall: "Raw material prices" is −1.8 instead of −1.6, and "Price increases" is +1.1 instead of +0.9. The two totals do not change. Update the chart. On slide 2, the first cause becomes: "Input costs: raw materials and energy took 2.3 points, only partly passed on in prices."
2. **A new slide after slide 5.** Title: "Logistics costs rose because the average delivery shrank by 14 % while the routes stayed the same". Line chart, title "Average weight delivered per stop", unit "kg", one series by half-year: H1 2024: 412; H2 2024: 401; H1 2025: 389; H2 2025: 372; H1 2026: 361; H2 2026: 354. One sentence of commentary: "The same lorries drive the same routes with less on board." The slide carries the source line, the mention "Illustrative", the footer and its page number like the others; the slides after it are renumbered.
3. **A lever removed on slide 6.** Management has ruled out closing a line. Remove "Close the oldest line at West (+0.5 pt)" from the matrix. The title becomes: "Four of the eight levers combine high impact and quick implementation".
<!-- gate:edits:end -->

## Scripted move (bench only)

Applied to the generated file before the edits. `dx` and `dy` are fractions of the slide's width and height; negative is left and up.

```json
{
  "dx": -0.02,
  "dy": -0.02,
  "targets": [
    { "slide": 2, "kind": "text", "contains": "Four levers that are both effective and quick", "label": "the box that starts with \"Four levers that are both effective and quick\"" },
    { "slide": 4, "kind": "chart", "label": "the chart" },
    { "slide": 7, "kind": "table", "label": "the table" }
  ]
}
```

The box of slide 2 sits on a slide whose text changes (edit 1); the chart of slide 4 is on a slide no edit touches; the table of slide 7 sits after the inserted slide (edit 2).
