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

### T12b — Paste and drop images

Use `text-example.html`, in Chrome, then Safari and Firefox, with the browser's developer tools open on Network. After each step: nothing is requested while pasting, one Undo removes the whole paste, and Save then reopening shows the same pictures with *No unsaved changes*; `node packages/text/tools/check.mjs <file>` reports no `unused-asset`.

1. **Screenshot**: take a screenshot to the clipboard (⇧⌘⌃4 on macOS, Win+Shift+S on Windows) and paste it at the end of a paragraph. The image dialog opens with the picture; **Insert** stays disabled until the alt text is filled. The picture is inserted at text width after that paragraph, reduced to 1,600 px wide (WebP in Chrome and Firefox, PNG in Safari). Paste again and choose **Cancel**: nothing is pasted, and the status line says the image without alt text was left out.
2. **A picture copied from Word**: in Word (macOS and Windows), select only a picture, copy, paste. The dialog asks for alt text and the picture is inserted. Copy text with a picture in it: the text arrives, and the picture is left out and reported (Word's HTML only links it to a file).
3. **A picture copied from Google Docs**: right-click a picture › Copy, paste. Docs links its pictures to its servers: the status line reports the image left out, unless the browser put the picture itself on the clipboard (then the dialog asks for alt text).
4. **A picture copied from a web page**: right-click an image › Copy Image, paste. The picture arrives through the dialog; the page's own copy is never fetched (Network stays empty). Copy part of a page that holds text and images: the text arrives, the images are left out and reported.
5. **`data:` images**: from a page whose pictures are embedded as `data:` URLs (a page saved as one file, or an HTML email opened in the browser), copy text with a picture in the middle, paste. The pictures keep their alt text (no dialog) and their place among the paragraphs.
6. **Dropped file**: drag a PNG, a JPEG, an animated GIF and an SVG from the Finder or Explorer onto a paragraph, one at a time: each is described in the dialog and lands after that paragraph. The GIF still animates, the SVG stays sharp. Drag a PDF: nothing is inserted, and the status line says it is not an image.
7. **Limits**: paste a photo over 50 megapixels (or over 16,384 px a side) and a file over 20 MB: each is left out and reported, and the tab stays responsive (it is refused from the file's header, before the picture is decoded). Copy 21 embedded pictures at once: 20 are pasted, one is reported.
8. **Where only text goes**: paste a screenshot with the caret in a table cell, a caption or the code block: the picture goes after the table or block. Paste text with an embedded picture into a cell: the text goes in the cell, the picture is left out and reported.
9. **Inside the document**: click the example's picture, copy, paste it after another paragraph. Save: `script#assets` holds it once, and both figures use the same `data-asset`.

### T15 — Show and export Markdown

Use `text-example.html`, in Chrome, then Safari and Firefox.

1. **View**: type a word in the first paragraph, then File › Markdown view. The text shows the word, the heading numbers (`# 1 Executive summary`), *Figure 1* and *Table 1* as plain text, the chart's data table, `*(Image: …)*` and the footnote as `[^1]` with its note at the end. Typing, Backspace and Delete change nothing (and do not leave the page); select and copy part of it. Close: the document still says *Unsaved changes*, and Save writes no Markdown.
2. **Copy**: in the view, Copy, then paste into a plain-text editor: the whole Markdown, starting with the `<!-- Markdown export … -->` note.
3. **Export**: File › Export Markdown (.md), and Export .md in the view: each downloads `Business review and 2027 plan.md` with the same text.
4. **Other Markdown editors**: open the exported file in VS Code's Markdown preview, Obsidian, Typora and on GitHub (a gist or a repository file). The note is hidden; headings, lists, quotes, code, tables (the regions table with its empty merged cells and two header rows), links, `<u>`, `<mark>`, `<sup>`, `<sub>` render; footnotes render as notes where the editor supports them (GitHub, Obsidian, Typora) and as `[^1]` otherwise. Nothing claims to be the document.
5. **Back into Text**: Insert › Markdown… › Or open a file, choose the export: the content arrives as ordinary paragraphs, headings, lists, quotes and tables, with the losses FORMAT.md › Markdown view and export lists (no comments, no images or charts, footnotes as text).
6. **Long document**: on a long document (the 100-page fixture of T16, built), File › Markdown view opens in about a second and scrolls smoothly.

## 7. Data, from T15

Each task adds its checks here, under its own heading (`### T15 — …`), in task order.

### T15 — Import CSV

Build a workbook (`node packages/data/tools/build.mjs --input packages/data/fixtures/pnl.json --output dist/data/pnl.html`) and use Data › Import CSV… for each file below. Each import adds one sheet in Raw Data; check the preview first, then the sheet.

1. **Real exports.** Export the same small table (a text column, a code column such as `0012`, an amount with decimals and thousands, a date, a TRUE/FALSE column, a cell with a line break, a cell with a comma and quotes, an accented name) from:
   - Excel for Windows or Mac in French: "CSV (séparateur : point-virgule)" and "CSV UTF-8";
   - Excel in English (US, and UK if available): "CSV (Comma delimited)" and "CSV UTF-8";
   - Google Sheets: File › Download › CSV, with the spreadsheet locale set to France, then to United States.

   For each file:
   - the preview names the right encoding and delimiter, and accents read correctly (Excel's non-UTF-8 French CSV shows the Windows-1252 note; on a Mac, Excel may write Mac OS Roman: if accents look wrong, choose it in Encoding);
   - codes keep their leading zeros, amounts are numbers with the right value, dates show the right day and month in long form, the line break and the quotes survive;
   - no question is asked when the file decides (French: decimal comma and day first; US: decimal point and month first). A file whose only dates are like `03/04/2026` asks for the date order, and Import stays disabled until you choose.
2. **Ambiguity.** Import a file whose only amounts are like `1,234`: the decimal separator is asked; choose Comma and check the preview shows 1.234; choose Point and it shows 1,234.
3. **Undo.** Ctrl/Cmd+Z removes the imported sheet in one step; Ctrl/Cmd+Shift+Z brings it back.
4. **Save and reopen.** Save, close and reopen the file with the network off: the imported sheet is there and editable. In the saved HTML, `sources` names the file without any folder path.
5. **No upload.** With the browser's network panel open, import a file in the offline build: no request at all. In the standard build, only the calculation engine (`ironcalc`) is fetched, and only if it was not loaded yet.
6. **Browsers.** Repeat 1 (one French and one US file), 3 and 4 in Safari and Firefox: the file picker opens from the menu, the dialog fits at 1280 px and at 375 px wide, and the preview scrolls.

### T15 — Import XLSX

Use the same P&L build, then an offline build (`--offline`, output `dist/data/pnl-offline.html`). Prepare real workbooks: one saved by Excel for Windows or Mac with several sheets, formulas reading another sheet, a named range, dates, percentages and amounts in euros, a code column such as `0012` stored as text, a merged title, a comment, a hyperlink, a conditional format, a chart and a hidden sheet; one with an Excel table and a structured reference such as `=SUM(Table1[Montant])`; one saved as `.xlsm` with a macro; one exported from Google Sheets (File › Download › Microsoft Excel); one saved by LibreOffice Calc and one by Numbers.

1. **Preview.** Data › Import XLSX…: the visible sheets are ticked and the hidden one is not; the sheet names, sizes and formula counts are right; switching the preview sheet shows its first rows with formulas on hover. The notes name what is not imported (merged title, comment, hyperlink, conditional format, chart, macro) and the formulas kept as values with their reason (table reference, another workbook).
2. **Values and formulas.** After Import: codes keep their leading zeros, dates show the right day, percentages and euro amounts keep a matching format, formulas reading another sheet give the same results as in Excel, and the named range exists (Formulas reading it work). If a function Data lacks is used, the status names a formula whose result differs.
3. **Name clash.** Import a workbook with a sheet called `Summary` into the P&L (which has one): it becomes `Summary (2)` and formulas reading it still work.
4. **Macros never run.** The `.xlsm` file imports its values; the note says macros are not imported, and nothing else happens.
5. **Refused files.** A password-protected workbook, an old `.xls` file and a CSV renamed `.xlsx` are refused with a clear message; the workbook is unchanged.
6. **Network.** With the network panel open, in the standard build: nothing is requested at load or for a CSV import; picking an XLSX file requests `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js` once (plus the engine if not loaded yet), and the file itself is never sent. In the offline build: no request at all. With the network off in the standard build, XLSX import says the reader could not be loaded and nothing changes.
7. **Undo, save and reopen.** One Ctrl/Cmd+Z removes all imported sheets and the named range; save, reopen offline: the sheets are there, and `sources` has one `xlsx` entry per sheet with the file name and no path.
8. **Browsers.** Repeat 1, 2, 6 and 7 in Safari and Firefox (file picker, dialog at 1280 px and 375 px, preview scrolling).

### T16 — Refresh an imported source

Import a CSV exported from Excel or Sheets (section T15), build a formula on another sheet that sums one of its columns, a pivot table and a chart on it, then edit one value of the imported sheet by hand. Export a second version of the table from the same application with: one column renamed, one column removed, one new column, the columns reordered and two more rows. Use Data › Refresh source… on the imported sheet and pick it.

1. **Preview.** Before anything changes, the dialog shows rows before → after, the changed values per column with examples, and that the formula, the pivot table and the chart depend on the sheet.
2. **Missing and renamed columns.** Refresh stays disabled until the removed and renamed columns are each settled (use another column, clear, or keep values).
3. **Hand edits.** The column you edited is flagged and needs the confirmation checkbox.
4. **Result.** After Refresh: the values match the new file, renamed columns kept their position, the new column is on the right, the formula is updated, the pivot table is marked out of date until refreshed, and the chart redraws. Your formatting on the imported cells is kept.
5. **Undo.** Ctrl/Cmd+Z restores the previous values, including your hand edit; Ctrl/Cmd+Shift+Z refreshes again.
6. **Save and reopen** with the network off: no link to the file is needed, and `sources` names the second file without a path.
7. **Browsers.** Repeat 1–5 in Safari and Firefox.
8. **XLSX.** Import a sheet from an Excel workbook (section T15 — Import XLSX), then change values and a formula in Excel, add a column and rows, and save under a new name. Refresh the imported sheet from it: the dialog selects the sheet with the same name (another can be chosen), shows the changed values and formulas, and after Refresh the values and recalculated formulas match Excel. Undo restores the previous sheet in one step.

### T19 — CSV export

File › Export sheet as CSV… on the selected sheet. Use a sheet with text, negative amounts, percentages, dates, a formula error, a text cell starting with `=` (for example `=1+1`) and one holding a comma, a semicolon and a quote.

1. **English locale** (Regional settings… › English (United States)), *Calculated values*, default separators:
   - Double-click the file to open it in **Excel** on a computer set to English: one value per column, numbers are numbers (right-aligned, they add up), dates are dates, `=1+1` shows as text with its apostrophe and is not calculated.
   - **Google Sheets** › File › Import › Upload, separator *Detect automatically*: same result.
2. **French locale** (Regional settings… › Français (France)): the dialog proposes *Semicolons, decimal comma (fr-FR)*.
   - Open by double-click in **Excel** on a computer set to French: columns split on semicolons, `-1234,5` is a number, dates are dates.
   - Choose *Commas, decimal point* instead and open in Excel set to English, then in Sheets with an English spreadsheet locale: numbers are numbers.
   - Import the semicolon file into **Sheets** with the spreadsheet locale set to France (File › Settings): numbers are numbers.
3. *Displayed text*: the CSV shows each value as the grid does (currency signs, grouping, `k`/`M` scales, parentheses).
4. Accents and symbols (`é`, `€`, `—`) display correctly in Excel and Sheets (the file is UTF-8 with a BOM).
5. Open `packages/data/dist/data-test/csv-stale-offline.html` (written by `node tests/csv-browser.mjs` run in `packages/data`), whose saved results are out of date, and select Summary. The dialog warns, offers *Recalculate and export* and *Export saved values*, and no plain *Export CSV*. *Export saved values* names the file `…-stale.csv`; *Recalculate and export* exports current values. Insert a pivot table (Insert › Pivot table…), refresh it, then change one of its source values: the CSV dialog on the pivot's sheet says it is out of date until refreshed.
6. With the standard file and the network off, edit an input: the calculation cannot load. The CSV dialog says the uncalculated edit is not exported.
7. Repeat step 1 with the offline file and the network off.

### T19 — Print / PDF

File › Print / PDF… (or Cmd/Ctrl+P) on a sheet with a header row, more rows than one page, negative values under a data bar rule, a bordered total and a chart.

1. In **Chrome**, **Edge** and **Safari**, choose *Save as PDF* in the browser's print dialog (Safari: File › Export as PDF also works from the print dialog's PDF menu).
   - No menus, toolbar, formula bar, sheet tabs, row numbers or selection appear; the PDF starts with the workbook title and sheet name.
   - The header row repeats at the top of every page (note the browser if it does not: Safari may not repeat it).
   - No row is cut across two pages.
   - Currency signs, percentages, dates and red parentheses read as on screen; negative data bars run left of their axis in the alert colour.
   - The chart appears after the table, sharp when zoomed in (SVG), with its title and unit.
2. The dialog proposes Letter in English (United States) and A4 in French (France); portrait for a narrow sheet, landscape for a wide one. Change paper and orientation: the browser's preview follows.
3. A sheet about 15 columns wide: *Fit to the page width* shrinks it onto the page; a 30-column sheet is split into pages across, each starting with column A. Try *Repeat columns at left* 0 and 2.
4. Set *Repeat rows at top* to 0 and 3: the repeated rows follow (at most 5).
5. Turn grid lines off (View › Grid lines), then print: the PDF has no grid lines.
6. Edit an input with the network off in the standard file (the calculation cannot load), then print: the PDF starts with the orange "Saved results may be out of date" band.
7. Cancel the browser's print dialog: the editor is unchanged and prints again normally. Use the browser's own File › Print on a sheet larger than 50,000 cells: the page shows the refusal, not the editor.
8. Repeat step 1 with the offline file and the network off.

### T20 — Data document tools

From the repository root, after `npm ci` and `npm ci --prefix packages/data`.

1. Create `budget.html` with `node packages/data/tools/workbook.mjs new budget.html --model packages/data/examples/valid/budget.json`, then open it in Chrome: the budget, the scenario dropdown, the data bars and the chart show; the status says results are current.
2. Apply `packages/data/examples/patches/raise-price.json` with `--out budget-2.html`, open `budget-2.html`: price 40, scenario Busy, total margin €3,060, the chart redrawn; no warning about stale results.
3. Apply it with `--no-recalculate` instead, open the result: the editor reports stale results and recalculates on the first edit.
4. Edit `budget-2.html` in the browser (change a cost), save, then run `validate budget-2.html --since budget.html`: the browser edit is listed as unrequested until allowed with `--allow`.
5. Repeat step 1 with `--offline`, network off.

### T20 — html-data skill

1. Build the archive (`(cd plugin && zip -qr ../dist/html-slides.plugin . -x "*.DS_Store")`), then install it in **Claude Desktop** (Settings › Capabilities or Plugins, upload the `.plugin`). Both skills appear: html-slides and html-data.
2. In a new conversation: “Create an html-data budget for a small event with a Base and a Busy scenario.” The assistant writes a model, runs `workbook.mjs new`, fixes errors in at most two retries, runs `validate` and reports figures it read back with `inspect`. Open the file in Chrome: values, scenario dropdown, formats and chart are as described.
3. Ask for a change (“raise the ticket price to 40 €”): the assistant writes a patch, checks it with `--dry-run`, applies it to a copy and runs `validate --since` with only the price allowed. Compare both files in the browser.
4. Ask for something invalid (for example “colour the total in #ff0000”): the assistant explains the closed colour vocabulary instead of writing a literal colour.
5. Ask for a presentation in the same conversation: the html-slides skill still works as before (`deck.mjs`, `check.mjs`).
6. Repeat step 2 in an agent that uses skill folders (extract the archive, point it to `skills/html-data/SKILL.md`).
7. Ask for an offline copy of the budget (`new … --offline`), open it with the network off and import an Excel workbook (Data › Import XLSX…): the embedded reader works with no request. Then ask the assistant to change a value on the imported sheet: it patches the cell and keeps `sources`; Data › Refresh source… with the same file asks before replacing that hand edit.

## Log

| Date | Check | Browser / app | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
