# Brief 5 — Free-composition diagrams (5 slides)

Subject 5 of [ADR-016](../../decisions/016-slides-go-stop-gate.md): shapes placed by hand, then edits by the assistant. **Fictional**: Tavelin Energy, its organisation and every figure are invented for this measurement. The bench gives the generating session the text between the `gate:brief` markers, and the editing session the text between the `gate:edits` markers; the scripted move at the end is applied by the bench and shown to no session.

<!-- gate:brief:start -->
## Brief

Produce five diagram slides that the head of customer service of Tavelin Energy (a fictional energy supplier) uses on 9 February 2027 to explain a new way of handling customer complaints. Each slide is one diagram drawn with shapes (boxes, arrows, connectors), not a list of bullets.

### General requirements

- Language: English. Format 16:9. Exactly 5 slides, in the order below, and nothing else (no agenda, no appendix, no closing slide).
- The title of each slide is the sentence given, word for word, without a final full stop.
- Use every figure exactly as given, with its unit. Add no figure, example or claim that is not in this brief.
- All organisations and figures are fictional. Every slide that shows a figure carries the source line "Source: illustrative data (fictional example)" and the visible mention "Illustrative".
- Every slide except the first shows the footer "Tavelin Energy (fictional) · Complaint handling · 9 February 2027" and its page number.
- Each chart shows its title, its unit and every value given.
- Everything else (design, colours, arrangement on the slide) is your choice, in a sober consulting style.

Each label quoted below is the text of one shape, word for word.

### Slide 1 — The process

Title: The complaint process moves from seven hand-offs to four steps with one owner

- Mention, small: "Tavelin Energy is a fictional company. All figures are illustrative."
- Four steps in a row, left to right, drawn as a chain of arrow-shaped steps: "1 Receive", "2 Qualify", "3 Resolve", "4 Confirm".
- Under each step, a box with who does it and the target time:
  - under "1 Receive": "Contact centre · same day";
  - under "2 Qualify": "Case owner · 1 day";
  - under "3 Resolve": "Case owner with the expert desk · 5 days";
  - under "4 Confirm": "Case owner · 1 day".
- A wide band under steps 2 to 4 only, with the text: "One case owner from qualification to confirmation".

### Slide 2 — The organisation

Title: The new organisation groups three teams under one head of customer resolution

An organisation chart with connecting lines:

- top box: "Head of customer resolution";
- three boxes below it, side by side: "Front line (42 FTE)", "Case owners (18 FTE)", "Expert desk (9 FTE)";
- two smaller boxes under "Expert desk (9 FTE)": "Billing experts (5)", "Metering experts (4)".

A separate note box, to one side: "Total 69 FTE, against 81 today".

### Slide 3 — Who handles which complaint

Title: A complaint goes to the expert desk only when it is both complex and above €500

A decision flow with arrows, each arrow from a question labelled "Yes" or "No":

- start, a rounded or oval shape: "Complaint received";
- first question, a diamond: "Complex case?"
  - "No" leads to a box: "Front line resolves · target: same day";
  - "Yes" leads to the second question;
- second question, a diamond: "Amount above €500?"
  - "No" leads to a box: "Case owner resolves · target: 5 days";
  - "Yes" leads to a box: "Expert desk and case owner resolve · target: 8 days";
- end, a rounded or oval shape that the three boxes lead to: "Customer confirmation".

### Slide 4 — The systems

Title: Three systems feed one case file, which replaces five separate screens

Three columns linked by arrows from left to right:

- left, three boxes stacked: "Billing system", "Metering system", "Contact history";
- centre, one larger box: "Single case file";
- right, three boxes stacked: "Front line view", "Case owner view", "Management dashboard".

A band across the bottom of the diagram: "Data refreshed every 15 minutes".

### Slide 5 — The roadmap

Title: The change is delivered in three waves between March and October 2027

A horizontal time axis from March to October 2027 with the months marked, three wave blocks placed on it over their months, and three milestones drawn as diamonds at their dates:

- wave block over March and April: "Wave 1 · Case owners appointed, new process live for billing complaints";
- wave block over May, June and July: "Wave 2 · Single case file live, metering complaints added";
- wave block over September and October: "Wave 3 · Expert desk at full strength, old screens switched off";
- milestones: "Go decision: 26 February" (at the left end, before the axis starts), "Review: 30 July", "Close: 29 October".
<!-- gate:brief:end -->

<!-- gate:edits:start -->
## Three later edits

Slide numbers are those of the deck before these changes.

1. **A fifth step on slide 1.** Add a step "5 Learn" after "4 Confirm", in the same chain and the same style, with the box under it: "Head of customer resolution · monthly review". The four existing steps and their boxes may be resized to make room, but keep their order and texts. The title becomes: "The complaint process moves from seven hand-offs to five steps with one owner".
2. **Updated figures on slide 2.** Two posts move from the front line to the case owners: the boxes become "Front line (40 FTE)" and "Case owners (20 FTE)". The total does not change.
3. **A new slide after slide 3.** Title: "Four indicators show each week whether the new process holds". A diagram of four boxes of equal size arranged two by two, each with a large figure and a label: "90 %" — "Cases closed within target"; "65 %" — "Resolved at first contact"; "8 %" — "Repeat complaints, at most"; "95 %" — "Customer confirmation obtained". In the centre, between the four boxes, a round shape with the text: "Weekly review". The slide carries the source line, the mention "Illustrative", the footer and its page number like the others; the slides after it are renumbered.
<!-- gate:edits:end -->

## Scripted move (bench only)

Applied to the generated file before the edits. `dx` and `dy` are fractions of the slide's width and height; negative is left and up. This subject moves five shapes, one per slide, because hand placement is what it exercises.

```json
{
  "dx": -0.02,
  "dy": -0.02,
  "targets": [
    { "slide": 1, "kind": "text", "contains": "One case owner from qualification to confirmation", "label": "the wide band \"One case owner from qualification to confirmation\"" },
    { "slide": 2, "kind": "text", "contains": "against 81 today", "label": "the note box \"Total 69 FTE, against 81 today\"" },
    { "slide": 3, "kind": "text", "contains": "Customer confirmation", "label": "the end shape \"Customer confirmation\"" },
    { "slide": 4, "kind": "text", "contains": "Single case file", "label": "the centre box \"Single case file\"" },
    { "slide": 5, "kind": "text", "contains": "Review: 30 July", "label": "the milestone \"Review: 30 July\"" }
  ]
}
```

The band of slide 1 sits on a slide that gains a step (edit 1); the note of slide 2 sits on a slide whose figures change (edit 2); the shapes of slides 4 and 5 sit after the inserted slide (edit 3); the shape of slide 3 is on a slide no edit touches.
