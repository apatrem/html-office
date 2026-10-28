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

## Log

| Date | Check | Browser / app | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
