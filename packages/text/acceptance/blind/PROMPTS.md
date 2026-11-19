# T20 blind-test prompts (html-text)

The exact prompts of the [T20 protocol](../../../../docs/blind-tests/TEXT-T20.md). `prepare.mjs` copies each track into the kit as `prompts-A.md` and `prompts-B.md`. Paste the text block of each task as one message, in order, in the same session, and wait for the assistant to finish before the next. Do not add hints. If the assistant asks a question, answer it with the reply given under the task, or else "Use your judgement", and record the exchange.

## Track A: HTML only

Session A sees only the folder `A/`, which holds `fictional-business-review.html`; the agent is started there, with no html-office skill installed, and writes its files there.

### A1 Explain the structure

```text
I was sent fictional-business-review.html, a report from the board of a co-operative. You have only this file: do not search the web or use any other file. Explain to me how the file is organised: what it holds besides the text, how the content is marked up, and what I must be careful about if I edit it. Then list the chapters and sections with their IDs and numbers, the figures and tables with their IDs, how many footnotes there are, and the comment threads (ID, status and what each one asks). Also write this answer to answers.md.
```

### A2 Rewrite a section

```text
Rewrite the section "People" (2.3) for the members' newsletter: warmer in tone and about a third shorter, with the same facts and figures and the footnote kept. Change nothing else in the document. Keep fictional-business-review.html as it is and save the result as edited.html.
```

### A3 Add a table with a cross-reference

```text
In edited.html, in the section "Milestones and governance", add this table after the paragraph that introduces the milestones, keeping the bullet list, and add a sentence just before the table that refers to it with a cross-reference like the other ones in the document. Give the table the ID tab-milestones. Save edited.html.

Caption: Milestones for 2027

| Quarter | Milestone | Owner |
| --- | --- | --- |
| Q1 | Second salesperson joins; Westgate lunch test starts | Sales |
| Q2 | Decision on Westgate at the general meeting | Board |
| Q3 | Riverside bakehouse and shop open | Operations |
| Q4 | Results for 2027 and plan for 2028 | Board |
```

### A4 Reply to a comment

```text
Sam Okafor left a comment in the same section. Reply to it in the file in one or two sentences that answer his question from what the report says, signed "Board secretary" with today's date and time. Do not resolve the thread. Save edited.html, then tell me everything you changed in the file since the original, and anything in the file I should know about.
```

## Track B: with the html-text skill

Session B runs in the folder `B/` with the html-text skill installed and nothing else; the inputs are in `B/inputs/`.

### B1 Create a report from a brief

```text
Using the html-text skill, write the annual report described in inputs/library-brief.md and save it as library-report.html in this folder.
```

If asked about anything the brief leaves open: "Use your judgement and tell me what you assumed."

### B2 Edit an existing report

```text
inputs/fictional-business-review.html is our board's report. Using inputs/cash-update.md, update the section "Cash and investment" (3.3) with the year-end figures: rewrite what has changed, add the quarterly closing-cash chart described there (ID fig-cash) with its source as a footnote, and add one sentence to the executive summary that points to the new chart with a cross-reference. Leave everything else as it is, comments included. Save the result as review-edited.html.
```

### B3 Edit a 100-page document

```text
inputs/report-100.html is a long report. In chapter 3, at the end of the subsection "Volunteers: risks" (before its first sub-subsection), add a paragraph of two or three sentences saying that the volunteer shortfall is largest where grants are smallest, which refers to the table "Grants by region, thousands" with a cross-reference, and ends with this footnote: "Source: fictional volunteer survey, October 2026." Change nothing else. Save the result as report-100-edited.html.
```

### B4 Import a Markdown draft and export it

```text
inputs/colleague-draft.md is a proposal a colleague wrote in Markdown. Turn it into an html-text document, delivery-proposal.html, that also works without a network connection, with a contents list and numbered headings; keep the colleague's text as written. Then save a Markdown reading copy of it as delivery-proposal.md.
```
