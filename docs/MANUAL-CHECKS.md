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

## 5. Pending: needs #70 and #71

Not in `main` yet. Run these once [#70](https://github.com/apatrem/html-office/pull/70) (Data ⇄ Slides tables) and [#71](https://github.com/apatrem/html-office/pull/71) (Slides charts) are merged and the files rebuilt:

- Copy a table between Slides and Data, both ways, in Chrome and Safari.
- Copy a Slides chart into Data and into another deck.
- Paste a Slides table and a Slides chart into Word, Google Docs, Excel and Google Sheets.

## Log

| Date | Check | Browser / app | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
