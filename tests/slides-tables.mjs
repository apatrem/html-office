// Slides table column widths (FORMAT.md › Tables) in a browser: Table › Column width… and
// Distribute columns evenly as one undo step each, a colgroup kept with one col per column when
// columns are inserted and deleted, widths rendered as percentages of the table (with a theme
// that predates them too), copied and pasted with the table, and checked by check.mjs.
//   SLIDES_ENGINES=chromium,firefox,webkit node tests/slides-tables.mjs   (default: chromium)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as playwright from 'playwright';
import { upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'work/slides-tables');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const ENGINES = (process.env.SLIDES_ENGINES || 'chromium').split(',');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

const TABLE = '<table class="t"><tbody><tr><th>Plot</th><th class="n">Spring</th><th class="n">Summer</th></tr>' +
  '<tr><td>Raised beds</td><td class="n">120</td><td class="n">45</td></tr>' +
  '<tr class="tot"><td>Total</td><td class="n">120</td><td class="n">45</td></tr></tbody></table>';
const example = fs.readFileSync(path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8');
const deck = theme => upgrade(example, { theme }).replace('</main>', `<section class="slide" id="s90" data-layout="default"><h1>Widths</h1>${TABLE}<p class="source">Source: fictional</p></section>
<section class="slide" id="s91" data-layout="default"><h1>Paste here</h1><p class="source">Source: fictional</p></section></main>`);
const FILE = path.join(DIR, 'deck.html');
fs.writeFileSync(FILE, deck(true));
// The example's own theme zone, as an older deck has it: widths come from the engine alone.
const OLD = path.join(DIR, 'old-theme.html');
fs.writeFileSync(OLD, deck(false));
ok(!fs.readFileSync(OLD, 'utf8').includes('col[data-width="1"]'), 'the old-theme deck has no column rules in its theme');

// The checker on a deck with these tables in slide s90.
function check(table) {
  const file = path.join(DIR, `check-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, deck(true).replace(TABLE, table));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), file, '--json'], { encoding: 'utf8' });
  return JSON.parse(r.stdout).out.filter(f => f.level === 'error' && f.slide === 's90').map(f => f.msg);
}

async function run(engine) {
  const browser = await playwright[engine].launch();
  const tag = m => `[${engine}] ${m}`;
  try {
    for (const [file, label] of [[FILE, 'current theme'], [OLD, 'old theme']]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => window.deckEngine);
      await page.evaluate(() => window.deckEngine.ready);
      await page.keyboard.press('e');
      const table = () => page.evaluate(() => {
        const t = document.querySelector('#s90 > table').cloneNode(true);
        for (const a of ['data-id', 'style', 'class']) t.removeAttribute(a);
        return t.innerHTML.replace(/<tbody>[^]*$/, '');
      });
      // Column widths as shares of the table, from the last row's cells.
      const shares = () => page.evaluate(() => {
        const t = document.querySelector('#s90 > table'), w = t.getBoundingClientRect().width;
        return [...t.rows[t.rows.length - 1].cells].map(c => Math.round((c.getBoundingClientRect().width / w) * 100));
      });
      const menu = async entry => {
        await page.getByRole('menubar').getByRole('menuitem', { name: 'Table', exact: true }).click();
        await page.locator('.sh-pop [role=menuitem]').filter({ has: page.locator('.sh-mlabel').getByText(entry, { exact: true }) }).click();
      };
      const select = async () => {
        await page.locator('#s90 > table').scrollIntoViewIfNeeded();
        await page.locator('#s90 > table').click({ position: { x: 20, y: 8 } });
      };
      // Once the dialog has gone (it closes, then returns focus to the page).
      const undo = async () => {
        await page.waitForSelector('dialog', { state: 'detached' });
        await page.keyboard.press('ControlOrMeta+z');
      };

      await select();
      await menu('Column width…');
      await page.fill('dialog input[type=number]', '0');
      await page.click('dialog .sh-primary');
      ok(/whole number from 1 to 100/.test(await page.textContent('dialog .sh-err')), tag(`${label}: 0 is refused, the dialog stays open`));
      await page.fill('dialog input[type=number]', '50');
      await page.click('dialog .sh-primary');
      ok(await table() === '<colgroup><col><col><col data-width="50"></colgroup>', tag(`${label}: Column width… sets the last column (${await table()})`));
      ok((await shares())[2] === 50, tag(`${label}: the column takes 50% of the table (${await shares()})`));
      await undo();
      ok(await table() === '', tag(`${label}: one undo removes the colgroup`));
      await select();
      await menu('Distribute columns evenly');
      ok(await table() === '<colgroup><col data-width="34"><col data-width="33"><col data-width="33"></colgroup>', tag(`${label}: Distribute columns evenly`));
      const even = await shares();
      ok(even.every(s => Math.abs(s - 33) <= 1), tag(`${label}: even columns render (${even})`));
      if (file === OLD) { ok(!errors.length, tag(`${label}: no JavaScript error`)); await page.close(); continue; }

      // Inserting and deleting columns keeps one col per column.
      await select();
      await menu('Insert column right');
      ok(await table() === '<colgroup><col data-width="34"><col data-width="33"><col data-width="33"><col></colgroup>', tag('a new column gets an automatic col'));
      await select();
      await menu('Delete column');
      ok(await table() === '<colgroup><col data-width="34"><col data-width="33"><col data-width="33"></colgroup>', tag('deleting a column removes its col'));
      // The caret's column: typing in the first cell, then Column width….
      await page.locator('#s90 > table td').first().dblclick();
      await menu('Column width…');
      ok(await page.inputValue('dialog input[type=number]') === '34', tag('the dialog shows the caret column\'s width'));
      await page.fill('dialog input[type=number]', '');
      await page.click('dialog .sh-primary');
      ok(await table() === '<colgroup><col><col data-width="33"><col data-width="33"></colgroup>', tag('an empty width makes the column automatic'));

      // Keyboard in the dialog: Enter saves; Delete on its buttons never reaches the canvas.
      await select();
      await menu('Column width…');
      await page.fill('dialog input[type=number]', '40');
      await page.press('dialog input[type=number]', 'Enter');
      ok(await table() === '<colgroup><col><col data-width="33"><col data-width="40"></colgroup>', tag(`Enter in the field saves (${await table()})`));
      await undo();
      await select();
      await menu('Column width…');
      await page.focus('dialog .sh-ghost');
      await page.keyboard.press('Delete'); // (Backspace would go back in WebKit's test build)
      ok(await page.evaluate(() => !!document.querySelector('#s90 > table')), tag('Delete on a dialog button keeps the table'));
      await page.keyboard.press('Escape');

      // Distribute while typing in a cell: an undo step of its own, after the typing's.
      const text = () => page.evaluate(() => document.querySelector('#s90 > table').textContent);
      const before = await text();
      await page.locator('#s90 > table td').nth(1).dblclick();
      await page.keyboard.type('7');
      const typed = await text();
      ok(typed !== before, tag('typing in a cell'));
      await menu('Distribute columns evenly');
      ok(await table() === '<colgroup><col data-width="34"><col data-width="33"><col data-width="33"></colgroup>', tag('Distribute while typing'));
      await page.keyboard.press('Escape');
      await undo();
      ok(await table() === '<colgroup><col><col data-width="33"><col data-width="33"></colgroup>' && await text() === typed, tag(`one undo reverts Distribute only, the typing stays (${await table()})`));
      await undo();
      ok(await text() === before, tag('the next undo reverts the typing'));
      await page.keyboard.press('ControlOrMeta+Shift+z');

      // Copy, then paste on another slide: the widths come with the table.
      await select();
      await page.keyboard.press('ControlOrMeta+c');
      const copied = await page.evaluate(() => new Promise(done => {
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        done(Object.fromEntries([...data.types].map(t => [t, data.getData(t)])));
      }));
      ok(/"columns":\[\{\},\{"width":33\},\{"width":33\}\]/.test(Object.values(copied).join('')), tag('the copied table carries its widths'));
      await page.locator('#s91').scrollIntoViewIfNeeded();
      await page.locator('#s91').click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('Escape');
      await page.evaluate(f => {
        const data = new DataTransfer();
        for (const [t, v] of Object.entries(f)) data.setData(t, v);
        document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, copied);
      const pasted = await page.evaluate(() => document.querySelector('#s91 > table colgroup')?.outerHTML);
      ok(pasted === '<colgroup><col><col data-width="33"><col data-width="33"></colgroup>', tag(`the pasted table keeps them (${pasted})`));
      // Widths kept as given, even adding up to more than 100 (the checker accepts them).
      {
        const wide = Object.fromEntries(Object.entries(copied).map(([t, v]) =>
          [t, v.replaceAll('"columns":[{},{"width":33},{"width":33}]', '"columns":[{"width":40},{},{"width":100}]')
            .replaceAll('&quot;columns&quot;:[{},{&quot;width&quot;:33},{&quot;width&quot;:33}]', '&quot;columns&quot;:[{&quot;width&quot;:40},{},{&quot;width&quot;:100}]')]));
        await page.evaluate(f => {
          const data = new DataTransfer();
          for (const [t, v] of Object.entries(f)) data.setData(t, v);
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, wide);
        const got = await page.evaluate(() => [...document.querySelectorAll('#s91 > table')].pop().querySelector('colgroup')?.outerHTML);
        ok(got === '<colgroup><col data-width="40"><col><col data-width="100"></colgroup>', tag(`pasted widths are kept as given (${got})`));
        await undo();
      }
      // The same envelope from a Text document or a Data workbook keeps them too.
      for (const [product, expected] of [['text', pasted], ['data', pasted]]) {
        const from = Object.fromEntries(Object.entries(copied).map(([t, v]) =>
          [t, v.replaceAll('"product":"slides"', `"product":"${product}"`).replaceAll('&quot;product&quot;:&quot;slides&quot;', `&quot;product&quot;:&quot;${product}&quot;`)]));
        ok(Object.values(from).join('').includes(product), tag(`the ${product} envelope is built`));
        await page.evaluate(f => {
          const data = new DataTransfer();
          for (const [t, v] of Object.entries(f)) data.setData(t, v);
          document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, from);
        const got = await page.evaluate(() => [...document.querySelectorAll('#s91 > table')].pop().querySelector('colgroup')?.outerHTML);
        ok(got === expected, tag(`a table pasted from ${product} keeps its widths (${got})`));
        await undo();
      }

      // Saved and checked.
      const saved = path.join(DIR, `saved-${engine}.html`);
      fs.writeFileSync(saved, await page.evaluate(() => window.deckEngine.serialize()));
      const r = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), saved, '--json'], { encoding: 'utf8' });
      const findings = JSON.parse(r.stdout).out.filter(f => f.level === 'error' && ['s90', 's91'].includes(f.slide));
      ok(!findings.length, tag(`the saved deck passes the checker (${findings.map(f => f.msg)})`));
      ok(!errors.length, tag(`no JavaScript error (${errors})`));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

for (const engine of ENGINES) await run(engine);

// The checker: one colgroup first, one col per column, whole percentages, no other attribute.
const cols = c => TABLE.replace('<tbody>', `${c}<tbody>`);
ok(!check(cols('<colgroup><col data-width="40"><col><col data-width="100"></colgroup>')).length, 'checker: a valid colgroup passes');
for (const [c, message] of [
  ['<colgroup><col data-width="50"><col></colgroup>', '2 <col> for a table of 3 columns'],
  ['<colgroup><col data-width="0"><col><col></colgroup>', 'Column data-width is a whole percentage 1–100, not "0"'],
  ['<colgroup><col data-width="40%"><col><col></colgroup>', 'Column data-width is a whole percentage 1–100, not "40%"'],
  ['<colgroup><col span="2"><col></colgroup>', 'Attribute span on <col> (only data-width)'],
  ['<colgroup span="3"></colgroup>', 'Attributes on <colgroup>'],
]) {
  const found = check(cols(c));
  ok(found.some(m => m.includes(message)), `checker: ${message} (${found})`);
}

console.log(fails ? `\n${fails} failure(s)` : '\nAll Slides table width checks passed');
process.exit(fails ? 1 : 0);
