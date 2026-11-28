# Defect list for the Slides go/stop gate

Written before any run, as [ADR-016 §5](../decisions/016-slides-go-stop-gate.md) requires. It fixes what is counted on the page images of a result, what is not, and which class each defect has. The counter (a model of the other family) and the owner (on a sample of about twenty pages) both count with this text. If their counts differ clearly, this list is made more precise and the count is redone; a change to it after runs exist is dated in the [history](#history) below.

The six kinds of ADR-016 are kept. Two of them (text, overlap) and "missing content" are split by a visible criterion, so that every code has one class and nobody has to judge severity.

## What a counter sees

- The page images of one result, in page order, at 1,600 px wide. A result is one presentation after its three edits. Its file name and its format are not given.
- The expected content: the brief, then the three edits, then the list of elements that were moved on purpose before the edits.
- Nothing else: no file, no checker output, no other result.

## Codes

| Code | Kind (ADR-016 §5) | Class | A defect is counted when |
| --- | --- | --- | --- |
| **B1** | Text cut | Blocking | At least one word or figure of a text cannot be read in full: cut by the edge of its box, of a table cell, of a shape or of the page, or ending in an ellipsis that the expected content does not have. |
| **B2** | Overlap that hides | Blocking | Two elements overlap and at least one word, figure, chart mark or table cell of either cannot be read because of it. |
| **B3** | Chart values differ | Blocking | A chart shows a value, a category, a series or a unit that differs from the expected content, or lacks one of them. A value is read from its label, or from the axis when there is no label; a bar or point visibly at odds with its own label counts too. |
| **B4** | Content missing or different | Blocking | An expected slide, title, chart, table, diagram shape, text or figure is absent, or its figures, names or meaning differ from the expected content. |
| **B5** | Edit not made | Blocking | One of the three edits is absent, partial or wrong on the page: an old value still shown, a new slide missing or misplaced, a wording not replaced. |
| **M1** | Text overflows, still readable | Minor | A text runs past the edge of its box, cell or shape, into the page margin or into the footer, and every word and figure can still be read. |
| **M2** | Overlap, nothing hidden | Minor | Two elements touch or overlap although the composition clearly did not intend it (a border crossing a text box, a label on a line, a source line on the content above), and everything can still be read. |
| **M3** | Visible misalignment | Minor | Elements that form a row, a column or a repeated series do not share the edge, the centre line or the spacing that the others share, by more than about 1 % of the page width (16 px on these images). Also: a title or a footer at a different position on two pages of the same kind. |
| **M4** | Secondary content missing or different | Minor | Absent although expected: a source line, the mention "Illustrative", a unit, a chart title, a legend entry, a footer or a page number. Or: a title or a quoted sentence whose wording differs from the expected content while its figures, names and meaning are the same. Or: a chart of another form than expected that still shows every value. |

Examples, all invented:

- B1: the last column of a table stops at "1,3" where "1,395" is expected; a title's second line disappears under the content.
- B2: a commentary box covers the last two bars of a chart; two labels of a diagram are printed on top of each other and neither can be read.
- B3: the bar for Q4 is labelled 2.1 after the edit asked for 2.3; the series "Plan" is missing; the unit reads "€ thousand" where "€ million" is expected.
- B4: slide 6 has four risks where five are expected; a table shows 146 where 164 is expected, outside any requested edit; a commentary point is replaced by another sentence.
- B5: the new slide exists but sits at the end of the deck; the title was updated and the chart was not.
- M1: the last line of a bullet list runs into the footer, readable.
- M2: the source line touches the bottom border of a table; an arrow crosses the corner of a box.
- M3: the third of four boxes in a row sits 25 px lower than the others; three columns have gaps of 20, 20 and 60 px.
- M4: no "Illustrative" mention on a slide with figures; the title says "above the target" where "above the plan to date" is expected.

## Counting rules

1. **Unit.** One defect per element and per code. The same element with the same defect is counted once, however large. Two elements with the same defect on a page are two defects. A table cell is an element; a chart is one element for B3 (several wrong values in one chart are one defect), and each of its labels is an element for B1, B2 and M1.
2. **Page.** A defect is recorded on the page where it is seen. A missing slide (B4 or B5) is recorded once, on the page that should follow it, or on the last page.
3. **One code per fact.** When two codes describe the same fact, the blocking one is recorded and the minor one is not: a text cut by an overlap is B2; a figure cut off is B1, not B4; an edit that was not made is B5, not B3 or B4.
4. **Elements moved on purpose.** The expected content lists the elements that were moved by hand before the edits. Their position is not a defect, and no M2 or M3 that involves one of them is counted. B1 and B2 are counted on them as on any element.
5. **Not defects.** Colours, fonts, style, density, the choice of arrangement, an empty area, taste. Small rendering differences in line weight or anti-aliasing. Anything that cannot be seen on the page image. A figure written with another valid notation (1,240 and 1 240; 0.5 % and 0.5%). Content added beyond the expected content (an extra closing slide, an added sentence), unless it contradicts an expected figure or takes the place of expected content: the list of ADR-016 counts what is missing or wrong, not what is added.
6. **Doubt.** A defect is counted only if it can be pointed at on the image. When in doubt between two classes, the code's criterion decides (can every word and figure be read?), not the impression.

## A usable run

ADR-016 §6 defines it: the generation and the three edits both finished, and the final file opens, passes its format's own checks, has no blocking defect and kept the scripted moves after the edits. The count establishes one of these conditions; the bench establishes the others ([README.md](README.md), "Failed runs and void runs").

- **No blocking defect.** The count records no B1 to B5 on any page of the result.
- **Finished, opens, passes its own checks, kept the moves.** Established by the bench, without the counter: the sessions' own reports and time limits, the conversion to PDF, `check.mjs` or `validate.py` on the final file, and the coordinates of the moved elements (within 1.5 px on a 1,280 px wide slide of where the move left them).

Only final results are counted: a run that did not finish its generation and its three edits has no count, even if it left a partly edited file, and neither has a void run. The count itself never uses a format's checker (ADR-016 §5): the counter sees page images and the expected content, nothing else.

## Instructions given to the counter

The bench sends the text below, followed by this file's sections "Codes" and "Counting rules" and by the expected content. `{pages}` is the number of images.

> You are counting visible defects on the pages of one business presentation. You are given {pages} page images, in page order (image 1 is page 1), and the content the presentation is expected to have. Do not try to guess which software produced the pages, and do not let style or taste influence the count: only the defects defined below are counted.
>
> Work page by page. For each page, compare every title, text, figure, chart value, table cell and diagram label with the expected content, then look for the layout defects. Read chart values from their labels. Check each of the three edits explicitly. Then check the deck as a whole: number and order of slides.
>
> Record each defect with its code, the page, the element concerned (quote a few of its words) and what you see. Record nothing that you cannot point at on the image. If a page has no defect, say so with an empty list. Do not propose corrections.
>
> Answer with JSON only, in this shape:
> `{"pages": [{"page": 1, "defects": [{"code": "M3", "element": "…", "seen": "…"}]}], "page_count_expected": 9, "page_count_seen": 9}`

## The owner's sample

The bench draws about twenty pages at random over all counted results, copies them under neutral names with the expected content of their slide, and writes a form with one line per page and one column per code. The owner fills it without the counter's figures; the bench then prints, code by code, the owner's total, the counter's total on the same pages, and the pages where they differ. "Differ clearly" is the owner's judgement (ADR-016 §5); the bench reports the figures and decides nothing.

## History

| Date | Change |
| --- | --- |
| 27 November 2026 | First version, written before any run. |
| 28 November 2026 | "A usable run" follows the amended ADR-016 §6 (both sessions finished, the format's own checks). No code, class or counting rule changed. Before any counted run. |
