# Manual checks

Checks that the automated suites cannot settle: real browsers on a real desktop, other applications (Excel, Google Sheets, Word, Google Docs), file pickers, print previews, and how things look. CI runs Chromium, plus Firefox and WebKit for the clipboard and Text engine jobs. It never runs desktop Safari, Edge, a native file dialog or another office application.

Use the three files in `dist/latest/`, rebuilt from `main`:

| File | Product |
| --- | --- |
| `dist/latest/text-example.html` | html-text |
| `dist/latest/data-pnl.html` | html-data |
| `dist/latest/slides-catalogue.html` | html-slides |

Work on a copy of each file, because saving rewrites it. Record each result in the **Log** at the end: date, browser, result, and a note for anything wrong. The Slides release checks in [VALIDATION-V1.md](VALIDATION-V1.md) › *Manual checks pending* still apply and are not repeated here.

Browsers: **Chrome** first, then **Safari** and **Firefox**. Edge behaves like Chrome; one pass over saving is enough there.

## 1. Text (`text-example.html`)

### 1.1 Look and page (T04)

1. Open the file. The page is a fixed-width column, as wide as the printed text.
2. Print preview (File › Print / PDF): lines break at the same words as on screen, and the page is A4 with 25 mm margins.
3. **Theme & page** (settings bar), or File › Document settings…: try each theme (blue, red, green, black), two fonts, Letter, and the narrow and wide margins.
   - Each change applies immediately, and Undo reverts one change at a time.
   - With Letter and wide margins, print preview shows a Letter page with the wider margins, and lines still break as on screen.
4. Save, close, and reopen: the theme, font, page and margins are kept.

### 1.2 Saving and recovery (T05)

1. **Chrome / Edge**
   - The first Save asks where to save. Later saves write to the same file without asking.
   - The title bar shows the saved or unsaved state.
   - Close and reopen the file: the edits are there.
2. **Safari / Firefox**
   - The primary button is **Save a copy**, also in the File menu and on ⌘S / Ctrl+S.
   - It downloads a file. Open the download: the edits are there.
3. **Recovery**
   - Edit some text, wait a second, and close the tab without saving. Reopen the same file: a recovery dialog appears, and Escape does not close it.
   - **Restore** brings the edits back, and Undo does not go back past the restore. This is expected: the restore starts a new history.
   - Repeat, then choose **Discard**. Reopen: no dialog this time.
4. **Draft from another version**
   - Edit file A without saving, and close the tab.
   - Replace A on disk with a different saved version, for example a copy saved from another tab.
   - Reopen A: the draft is offered *as a copy*, and Save asks for a new file instead of overwriting A.
5. Do the same in a private window. Drafts may not survive closing the window; the editor must not show an error.

### 1.3 Editing (T06)

1. **Paragraph style**: try each style on a paragraph (Body, Lead, Title, Subtitle, Heading 1–4, Quote, Note, Warning, Key message, Code, Caption).
   - Title on the first block makes a cover; restyling the title removes the cover.
   - Caption on the paragraph after a figure moves it into the figure.
2. **Lists**
   - Bulleted list and Numbered list toggle the list.
   - The increase and decrease list level buttons change the level.
   - Enter on an empty item leaves that level.
   - Backspace at the start of an item joins it to the item above.
3. **Inline formatting**: bold, italic, underline, highlight, superscript, subscript and inline code. Help › Keyboard shortcuts lists the shortcuts; check that each one works.
4. **Links** (Link…)
   - `https://…` and `mailto:…` are accepted.
   - `javascript:alert(1)` and plain text are refused with a message.
   - Remove link removes the link and keeps the text.
5. **Pages**: Page break and Start on a new page each show a new page in print preview.
6. **Narrow window**
   - Below 720 px wide, the menus fold into ☰ and everything above stays reachable.
   - At phone width (375 px), the page scrolls without overlapping the toolbar.
7. **Reopen**
   - Save, then reopen: every change is kept.
   - Run `node packages/text/tools/check.mjs <saved file>`: it reports no errors.

## 2. Data (`data-pnl.html`)

### 2.1 PNG download (F06)

1. Select a block with formatting, borders, wrapped text and a conditional highlight. Use File › Download selection as PNG, or the cell menu › Download as PNG.
   - The PNG looks like the grid: same colours, fonts, borders, alignment and line breaks.
   - It has no row or column headers.
2. Select a whole column: the picture stops at the last used row.
3. Select a huge range, for example a whole sheet of a large file: the download is refused with a message suggesting Print / PDF.
4. Edit a cell and download at once: the picture carries a warning band about results not yet recalculated.
5. Change the theme (Document settings…) and download again: the PNG follows the theme.

### 2.2 Charts (T18)

1. Select a block (header row first), then Insert › Chart…. Try a column chart and a line chart.
2. Chart settings… changes the title and type; Duplicate chart and Delete chart work, and Undo reverts each one.
3. Edit a source number: the chart updates.
4. Save and reopen with the network off (Wi-Fi off). The chart shows its saved preview and the file opens without errors. With the network back, Redraw charts redraws it live.
5. Change the theme: the chart colours follow.

### 2.3 Pivot tables (T17)

1. Select a table with a header row, then Insert › Pivot table…. Set one row field, one column field and Sum of a number column.
2. Check one total by hand.
3. Change a source value, then Refresh all pivot tables: the output updates.
4. Add a row at the bottom of the source, then refresh: the new row is included.
5. Save and reopen: the pivot and its definition are kept (Pivot tables… lists it).

### 2.4 Clipboard with other applications (X02a)

This is the outstanding check from #65. Prepare a block with an integer, a decimal with many digits shown with 2 decimals (for example `=1/3`), a percentage, a date, a negative currency amount, a text cell, an empty cell and a bold header.

1. **Data → Excel (desktop)**: paste the block. Each cell keeps its full value, not the rounded one: `=1/3` gives 0.333333…, the percentage stays a percentage, the date stays a date, and the amount stays a number. The header stays bold.
2. **Data → Google Sheets**: the same checks.
3. **Data → Word and Google Docs**: a table appears with the displayed values and the header style.
4. **Excel / Google Sheets → Data**: copy a block with the same kinds of values and paste it. Numbers, percentages and dates arrive typed; an ambiguous value such as `12,5%` opens the paste dialog.
5. **Data → Data**: copy between two Data files in two tabs, and between Chrome and Safari. Values, formats and formulas are kept.
6. **Data → a plain text editor**: tab-separated text with full-precision numbers and ISO dates.

If Excel or Sheets shows a wrong value in step 1 or 2, note the cell and value in the log. The fix is to stop writing the HTML table flavour (`packages/data/runtime/clipboard.mjs`).

### 2.5 General

- Narrow window: the menus fold into ☰, and the grid stays usable.
- Safari and Firefox: open, edit, recalculate, and Save a copy.

## 3. Slides (`slides-catalogue.html`)

1. **Shell (U04)**
   - The file bar, menus (File … Help), toolbar and settings bar all work.
   - Disabled menu items are shown greyed, not hidden.
   - Below 720 px wide, the menus fold into ☰ and the thumbnails become a strip.
   - At 375 px the slide fills the width.
2. **Theme & font (TH02)**
   - Theme & font in the settings bar: each theme recolours the slides, thumbnails and charts.
   - A font change affects body text only, not titles.
   - Undo reverts each change. Save and reopen keeps them.
3. **Present and PDF**: Present runs full screen; PDF output matches the slides.

## 4. All three products

1. **Third-party notices (L01)**: Help › Third-party notices opens collapsed, readable text, with no external link, in each product.
2. **Offline**: with the network off, each file opens and edits. Data and Slides show chart previews.
3. **Keyboard only**: Tab reaches the file bar, the menus and the toolbar. The arrow keys move within the toolbar, and Escape closes menus and dialogs.

## 5. Copy and paste between Slides and Data (X02b, X02c)

Merged in [#70](https://github.com/apatrem/html-office/pull/70) and [#71](https://github.com/apatrem/html-office/pull/71).

- Copy a table between Slides and Data, both ways, in Chrome and Safari.
- Copy a Slides chart into Data and into another deck.
- Paste a Slides table and a Slides chart into Word, Google Docs, Excel and Google Sheets.

## 6. Text, from T07

Each task adds its checks here, under its own heading (`### T07 — …`), in task order.

### T07 — Paste and import Markdown

Use `text-example.html`. After each paste: the result uses the document's own styles (no foreign fonts, colours or sizes), one Undo removes the whole paste, and Save (or Save a copy) then reopening shows the same content. Put the caret in an empty paragraph first unless a step says otherwise.

1. **Word (desktop, macOS and Windows)**: copy a page with a Title, Heading 1 and 2, bold, italic, underline, a link, a bulleted list with a second level, a numbered list, a footnote, a comment, a picture and a 3 × 3 table with a merged header cell, and paste it.
   - Title and headings become headings; the lists keep their levels and kinds; the table keeps its merged cell.
   - The footnote, the comment and the picture are left out, and the status line says so ("Left out: 1 image, 2 Word footnotes or comments").
2. **Google Docs**: the same kind of content. Headings, bold, italic, links and nested lists arrive; nothing is bold that was not bold in Docs.
3. **Excel and Google Sheets**: copy a block with a bold header row, a merged title and a right-aligned number column. It becomes a table with a header row, the merge and right-aligned numbers. Paste 31 columns: nothing is pasted, and the status line says why.
4. **Web pages**: copy part of a news article (headings, paragraphs, links, an image, a quote) and part of a Wikipedia table.
   - The text, headings, quote and table arrive. Navigation, buttons, images and videos do not.
   - Relative links ("/about") are kept as text and counted in the status line.
   - In the browser's developer tools (Network), the paste loads nothing.
5. **Plain text**: ⌘⇧V / Ctrl+Shift+V (Chrome, Edge, Firefox), or Edit › Paste as plain text (Safari asks for permission with a Paste button), pastes the same copied web page as plain paragraphs.
6. **Where the paste lands**: paste a heading and a list at the end of a paragraph (they stay a heading and a list after it); paste two paragraphs into a table cell (one cell, the lines joined by line breaks); paste into the code block (plain text).
7. **html-office tables**: copy a range in `data-pnl.html` and a table in `slides-catalogue.html` and paste each into Text: a table with its header and total rows, merges and alignment. Repeat across Chrome and Safari (the HTML carrier).
8. **Copying a Text table**: select its cells by dragging from the first to the last (or ⌘-click / Ctrl-click inside it until the whole table is outlined), copy, and paste it into Word, Google Docs, Excel, Google Sheets, `data-pnl.html` and `slides-catalogue.html`.
   - Each gets the table with its header rows, the merged "Revenue" cell (Data: centred across the cells) and the numbers right-aligned; Word and Docs show the header colours of the theme.
   - Pasted back into Text, it becomes a new table (new ID, no caption: the caption stays with the original).
9. **Copying text into other applications**: select from "2027 plan" to the quote and paste into Word and Google Docs: headings, the justified paragraph's text, the list and the quote arrive as headings, a list and a quote.
10. **Markdown**: Insert › Markdown…, paste a README from GitHub (headings, lists, a table, code, an image), Insert. The status line lists what was left out (the image) or adapted. Open a `.md` file with "Or open a file" too.
11. **Drag and drop**: drag a selection from a web page or Word into the document: it is inserted where it is dropped, mapped as a paste.
12. **Safari and Firefox**: repeat steps 1, 4, 5 and 10.
13. **Print**: print preview of a document with pasted tables and lists looks like the document's own tables and lists.
14. **Between Text documents** (with T08–T13): copy a paragraph holding a footnote, a cross-reference, a commented phrase and a picture from `text-example.html`, and paste it into another Text document. The footnote stays; the cross-reference becomes its text unless that document has the target; there is no comment underline and no thread; the picture is left out and reported. Pasted back into `text-example.html` itself, the footnote and cross-reference come back, but not the comment underline (the original keeps it); cutting the whole commented phrase and pasting it elsewhere moves the underline with it.

### T08 — Numbering, contents and cross-references

1. **Open**: the example opens with *Unsaved changes* only if its saved labels were stale; a freshly built example opens with *No unsaved changes*. Headings show 1, 2, 2.1, 3, 3.1; the *Contacts* heading (unnumbered) shows none. Captions read *Figure 1.*, *Figure 2.*, *Table 1.*.
2. **Print preview** (File › Print / PDF), in Chrome, Safari and Firefox: the same heading numbers and caption labels appear, and the contents list shows its numbers. Nothing is underlined in red.
3. **Heading numbers** (Theme & page › Heading numbers): None removes every number and the numbers from the contents; Numbered brings them back; each format (I.A.1, A.1.a, 1.a.i) renumbers headings, contents and *Section …* cross-references at once. Undo reverts one change at a time. Theme default stores nothing (check the saved file's `article` line).
4. **Contents**: put the cursor in a paragraph, Insert › Contents. A list of the headings appears after the paragraph. With it selected, Format › Contents levels › Level 1 keeps only the top headings. Rename a heading: the contents follow as you type.
5. **Cross-reference** (Insert › Cross-reference…): the dialog lists headings and figures in document order with their labels. Insert one to a numbered section, then delete a heading above that section: the label changes to the new number at once. Delete the target heading: the reference stays, underlined with a red wavy line, and its tooltip says it points nowhere.
6. **Stale labels from an LLM**: in a copy of the file, change a cross-reference text to `Figure 9` with a text editor. `node packages/text/tools/check.mjs <file>` reports a `stale-label` warning with its line. Open the file: the label reads correctly, the state is *Unsaved changes*, and Undo is unavailable. Save: only that line changes.
7. **Safari and Firefox**: steps 3–5 behave the same; the cross-reference dialog accepts double-click and Enter.

### T09 — Footnotes

1. **Reading**: the note after *ahead of plan.* shows as a small raised **1**. Hovering it shows the note's text in a box. The **Notes** list at the end of the document (before the comments) lists it.
2. **Insert** (Insert › Footnote, or ⌘⌥F / Ctrl+Alt+F) in the middle of a sentence, then at the very end of a paragraph: the note opens with a tinted box, and what you type goes into it. Escape closes it and the cursor stays right after the number; typing then goes after the note, not into it. The notes renumber in document order, and the list follows as you type.
3. **Open a note**: click its number, or click its line in the Notes list: the note opens with the cursor at its end.
4. **Move**: cut a sentence that holds a note and paste it elsewhere in the same document, or drag it: the note moves with it and the numbers follow. Undo restores the order. Bold a word inside an open note: the Notes list shows it bold.
5. **Screen reader** (VoiceOver in Safari): reading the paragraph reads the note's text where it is written; the Notes list is not read a second time.
6. **Print preview** in Chrome, Safari and Firefox, with a note open: the references print as raised numbers, never as open text, and the Notes list prints at the end with the same numbers.
7. **Safari and Firefox**: steps 2 and 3, including typing at the end of a paragraph after Escape, and a Japanese or Chinese input method right after Escape.
8. Save and reopen: the notes are kept where they were written; the saved file holds no numbers and no Notes list.

### T12 — Images

Use real pictures: a large phone photo (JPEG, 4,000 px wide or more), a PNG screenshot, a PNG logo with a transparent background, an animated GIF and an SVG logo.

1. **Insert** (Insert › Image…) each file in Chrome, Safari and Firefox. The dialog shows a preview; **Insert** stays disabled until the alt text is filled. Choose *Wrap left*, 33%: the picture floats left of the paragraph that held the cursor and of the following ones; the text wraps around a rectangle.
2. **Size and kind**: save, then check the file size grew by a reasonable amount, well under the photo's own size (the photo is reduced to 1,600 px wide; WebP in Chrome and Firefox, JPEG in Safari). In Safari the transparent logo keeps its transparent background (PNG), never a black one. The GIF still animates. The SVG keeps its sharpness at any zoom.
3. **Dialog**: double-click a picture. Change the alt text, then the layout to *Full width*, then *Wrap right* 50%. Undo reverts each change. **Replace image…** swaps the picture and keeps the caption.
4. **Wrapping**: two wrapped images in a row on the same side stack, never overlap; a wrapped image beside a short paragraph lets the next paragraphs wrap too; a heading with *Start on a new page* starts below the image.
5. **Anchoring**: with the cursor in the paragraph after a wrapped image, Format › Move up (Alt+Shift+↑) moves the paragraph and its image together; Move down back.
6. **Delete**: click a picture (the figure is outlined) and press Backspace. Save: `node packages/text/tools/check.mjs <file>` reports no `unused-asset`, and the `script#assets` line no longer holds the deleted picture. Undo, save again: it is back.
7. **Reopen** the saved file in each browser: every picture shows, the state is *No unsaved changes*.
8. **Print preview** in Chrome, Safari and Firefox: pictures print at their width, wrapped text flows as on screen (page breaks around images are checked in T14).

### T11 — Charts

Use the standard build (`text-example.html`) online, then the offline build (`node packages/text/tools/build.mjs packages/text/fixtures/valid/example.html dist/text/example-offline.html --offline`) with the network off.

1. **Previews**: open the example with the network off (standard build). The chart shows with its title and unit; nothing is reported missing. Print preview shows it too.
2. **Edit** (double-click the chart, or Format › Chart…), online: change a value and the unit, Apply. The chart dims briefly, then redraws; save and reopen: the new chart shows at once, with the network off.
3. **Insert › Chart…**: try each type. Waterfall, bubble and Gantt start from a sample; Add/Remove row and series work; JSON accepts an option such as `"decimals":2`. A wrong value (text in a number column) is refused with a message.
4. **Long document**: in a copy with a dozen charts, change the theme (Theme & page): the charts on screen redraw first, the others as you scroll to them; scrolling stays smooth.
5. **Offline build**, network off: insert a chart, edit it: it draws with no network. The file is about 1.1 MB larger.
6. **Blocked library**: in the standard build with the network off, edit a chart: it keeps its old preview, dimmed, with *Chart library unavailable*. Save: the file still opens and prints the old preview.
7. **Copy and paste with Slides**: copy a Slides chart (Edit › Copy) and paste it into Text: a new chart with the Slides data, redrawn in the Text charte. Copy a Text chart and paste it into a slide, and into another Text document: the caption comes with it. Paste a Text chart into Word, Google Docs and PowerPoint: a picture with the title and unit.
8. **Safari and Firefox**: steps 2, 3 and 7.

### T13 — Comments

1. **Panel**: Comments (settings bar) lists the example's threads in document order; their text reads exactly as written. Clicking a thread's quotation selects its text in the page.
2. **Name**: select a phrase, Insert › Comment (⌘⌥M / Ctrl+Alt+M). The first time, the panel asks for your name; reload the file: it is remembered. In a private window it may be asked again; nothing breaks.
3. **Comment**: write a comment containing `<b>tags</b>` and a link `https://example.org`: both show as plain text, nothing is bold, nothing is clickable.
4. **Reply, resolve, delete**: reply, Resolve, Reopen; Undo reverts each. Delete removes the thread and the underline.
5. **Anchors**: type inside the commented phrase (the underline grows), before and after it (it does not), delete part of it (it shrinks). Delete all of it: the thread shows *Orphaned* and stays.
6. **Recovery**: with an orphaned thread whose quotation appears twice (type the phrase again in two places, one in its section), Find the quoted text…: two proposals, the one in its section first, each with context; hovering one highlights it in the page. Cancel: nothing changed (Save shows no change). Search again, type a letter somewhere in the page: the proposals disappear. Search again and Attach here: the underline appears at that place only.
7. **External rewrite**: in a copy, remove a `mark.comment` with a text editor and reopen: the thread is orphaned, never reattached on its own; `check` reports `orphaned-thread`.
8. **Print preview**: no threads, no underline.
9. **Safari and Firefox**: steps 2–6.

### T10 — Edit report tables with merged cells

Use `text-example.html`, in Chrome, then Safari and Firefox. After each step, one Undo reverts it, and Save then reopening shows the same table.

1. **Insert**: Insert › Table below a paragraph. Type in the header, press Tab through the cells (Shift+Tab goes back); Tab in the last cell adds a row. Enter in a cell does nothing.
2. **Select**: drag across cells, and Shift+arrow keys from a cell: the selected cells are highlighted. Bold, italic and Align right apply to every selected cell; Justify is unavailable.
3. **Rows and columns** (Table menu): insert rows above and below (inside the regions table's two header rows the new row joins the header), columns left and right (the merged "Revenue" header widens), delete rows and columns. Deleting every row or column is unavailable; Delete table removes the figure with its caption.
4. **Merge and split**: merge a 2 × 2 block of body cells (their texts stay, one per line), split it again. Merging across the header's last row is unavailable. Select a block that includes merged cells and press Backspace: the cells are emptied, the merges kept.
5. **Styles**: Header rows (on a body row: it and the rows above become the header, repeated on each printed page), Total rows, Row headers, Emphasis column, Compact, Column width… (55 %), Distribute columns evenly, Caption (removes it; again adds an empty caption above the table).
6. **Clipboard**: copy a block of cells and paste it into Excel, Google Sheets, Word, Docs, `data-pnl.html` and another place of the table (it fills from the caret's cell and grows the table). Paste a range from Excel into a cell: the cells fill and the table grows. Paste a word on a selection of cells: each cell gets it, and a merged cell stays merged with its alignment.
7. **Print**: print preview of a long table: the header rows repeat on each page, total rows are bold with their rule, emphasis columns are tinted, compact tables are denser, and nothing of the editing highlight shows.
8. **Narrow window**: the Table menu is reachable through ☰.
9. **Undo steps**: type a character in a cell and at once merge or insert a row: one Undo reverts the table change only, the next the typing.

## 7. Data, from T15

Each task adds its checks here, under its own heading (`### T15 — …`), in task order.

## Log

| Date | Check | Browser / app | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
