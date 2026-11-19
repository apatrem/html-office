# T22 blind-test prompts (html-data)

The exact prompts of the [T22 protocol](../../../../docs/blind-tests/DATA-T22.md). `prepare.mjs` copies each track into the kit as `prompts-A.md` and `prompts-B.md`. Paste the text block of each task as one message, in order, in the same session, and wait for the assistant to finish before the next. Do not add hints. If the assistant asks a question, answer it with the reply given under the task, or else "Use your judgement", and record the exchange.

## Track A: HTML only

Session A sees only the folder `A/`, which holds `fictional-bike-rentals.html`. If the assistant cannot write files (a chat app), ask it to give the edited file as a download and save it in `A/` under the name the prompt gives.

### A1 Explain the model

```text
I was sent fictional-bike-rentals.html, a spreadsheet model of a bike-rental co-operative in one HTML file. You have only this file: do not search the web or use any other file. Explain what the workbook models and how: its sheets and what each one does, which cells are inputs, how the scenario is chosen, and how the 2026 forecast revenue is calculated from the inputs. Then give the 2025 actual revenue, the 2026 forecast revenue and the cash-flow NPV exactly as the file has them saved, without recalculating them. Also write this answer to answers.md.
```

### A2 Change an assumption

```text
Change the Base scenario's year-on-year rental growth from 8% to 6%. Keep fictional-bike-rentals.html as it is and save the result as edited.html.
```

### A3 Add a formula

```text
In edited.html, on the Summary sheet, add a line under "Lowest cumulative cash": the label "Average monthly revenue, 2026 forecast" in A17 and, in B17, a formula that calculates it from the P&L sheet, formatted like the other euro amounts. Save edited.html.
```

### A4 Update a chart

```text
Add EBITDA to the chart "Monthly revenue and net income, Jan 2025 to Dec 2026" on the Summary sheet: put the monthly EBITDA in column D of the "Chart data" sheet (the header "EBITDA" in D1, then one row per month, taken from the P&L), include it in the chart, and change the chart's title to "Monthly revenue, EBITDA and net income, Jan 2025 to Dec 2026". Save edited.html. Then tell me everything you changed in the file since the original, whether its saved results are up to date, and anything in the file I should know about.
```

## Track B: with the html-data skill

Session B runs in the folder `B/` with the html-data skill installed and nothing else; the inputs are in `B/inputs/`.

### B1 Create a model from a brief

```text
Using the html-data skill, build the model described in inputs/solar-brief.md and save it as solar-model.html in this folder.
```

If asked about anything the brief leaves open: "Use your judgement and tell me what you assumed."

### B2 Edit an existing model

```text
inputs/fictional-bike-rentals.html is our co-operative's P&L model. Make these changes and save the result as rentals-edited.html: the Low scenario's forecast price change becomes -2%; the monthly fixed costs rise to EUR 6,300; select the Low scenario; and rename the waterfall chart to "24 months: revenue to net income (Low scenario)". Change nothing else. Then tell me the new cash-flow NPV.
```

### B3 Readable formulas

```text
Build orders.html from inputs/orders-2026.csv: a sheet "Orders" with every row of the CSV (dates as dates, amounts as numbers), named ranges for its columns, and a sheet "Analysis" that uses readable formulas:
1. the list of regions, sorted, as one formula that spills;
2. next to it, each region's total amount;
3. every order above EUR 1,000 (order number and amount), largest first, as one FILTER formula;
4. the order number of the largest order, with XLOOKUP;
5. the average order amount, as a LET formula that names its steps.
```

If the assistant asks you to import the CSV in the browser instead, do it (Chrome: Data › Import CSV…, new sheet "Orders"), save the workbook as `B/orders.html`, and reply "Done: orders.html now has the Orders sheet."

### B4 Pivot table and chart

```text
In orders.html, add a pivot table of the total amount by region (rows) and product (columns), and a column chart of the total amount by region. Save orders.html.
```

### B5 Browser import, then an offline copy

Before sending this prompt, open `B/orders.html` in Chrome, use Data › Import CSV… with `B/inputs/members-2026.csv` (new sheet, named "Members"), and save it in place (File › Save).

```text
I imported inputs/members-2026.csv into orders.html in the browser, as a new sheet "Members", and saved it. Add to the Analysis sheet the number of members in each tier (Basic, Plus, Family), calculated from the imported sheet. Then save an offline copy as orders-offline.html that works without a network connection.
```
