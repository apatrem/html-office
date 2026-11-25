// Save in place for Slides (shared FileBinding): the opened file is remembered and reused, the
// picker behaves as Save As, a new name is used from then on; Cmd/Ctrl+S downloads a copy where the
// browser cannot save in place.
//   SAVE_ENGINES=chromium,firefox,webkit node tests/save-in-place-slides.mjs   (default: chromium)
// Firefox and WebKit run only the copy scenario; Chromium runs both.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as playwright from 'playwright';
import { saveInPlaceScenarios, copyOnlyScenario, fakeFileContext } from './save-in-place.mjs';
import { ASSETS, asset, setZone } from '../plugin/skills/html-slides/tools/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(root, 'work/save-in-place-'));
const seed = path.join(dir, 'seed.html');
execFileSync(process.execPath, [path.join(root, 'plugin/skills/html-slides/tools/deck.mjs'), 'new', seed, '--footer', 'Original']);
const source = fs.readFileSync(seed, 'utf8');

const product = {
  label: 'Slides',
  prefix: 'deck',
  purpose: 'html-slides-save',
  dir,
  source,
  other: source.replace('data-footer="Original"', 'data-footer="Theirs"'),
  statusSelector: '.hs-banner',
  async open(page) {
    await page.waitForFunction(() => window.deckEngine);
    await page.evaluate(() => window.deckEngine.ready);
    await page.keyboard.press('e');
  },
  async edit(page, n) {
    await page.getByRole('toolbar', { name: 'Slide and selection' }).getByRole('button', { name: 'Footer', exact: true }).click();
    await page.locator('.hs-panel input').first().fill(`Footer ${n}`);
    await page.locator('.hs-panel button', { hasText: 'Apply' }).click();
  },
  marker: n => `data-footer="Footer ${n}"`,
  save: page => page.keyboard.press('Control+s'),
};

// A draft of an older revision restored: Save never writes over the newer file it was opened
// from, even when that file is remembered; the picker suggests the -recovered name (review of
// 22 November 2026, as Text and Data).
async function recoveredDraft(browser) {
  const context = await fakeFileContext(browser);
  const a = path.join(dir, 'deck-recovered-src.html');
  fs.writeFileSync(a, source);
  let page = await context.newPage();
  await page.goto(pathToFileURL(a).href);
  await product.open(page);
  await product.edit(page, 1);
  await product.save(page);
  await page.waitForFunction(() => /Saved to/.test(document.querySelector('.hs-banner')?.textContent ?? ''));
  await product.edit(page, 2); // left as a draft
  const newer = fs.readFileSync(a, 'utf8').replace('data-footer="Footer 1"', 'data-footer="Newer elsewhere"');
  fs.writeFileSync(a, newer);
  await page.close({ runBeforeUnload: false });
  page = await context.newPage();
  await page.goto(pathToFileURL(a).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.locator('.hs-banner button', { hasText: 'Restore older draft' }).click();
  await product.save(page);
  await page.waitForFunction(() => window.fakeFiles.picks === 1 || window.fakeFiles.writes > 0);
  await page.waitForFunction(() => /Saved to|Save failed/.test(document.querySelector('.hs-banner')?.textContent ?? ''));
  const disk = await page.evaluate(() => ({ ...window.fakeFiles }));
  if (disk.picks !== 1 || disk.options[0].suggestedName !== 'deck-recovered-src-recovered.html')
    throw new Error('restored older draft: ' + JSON.stringify(disk));
  if (fs.readFileSync(a, 'utf8') !== newer) throw new Error('the newer file was overwritten');
  await context.close();
  console.log('PASS save in place [Slides]: a restored older draft opens the picker with the -recovered name and never replaces the newer file');
}

const engines = (process.env.SAVE_ENGINES || 'chromium').split(',');
try {
  for (const engine of engines) {
    const browser = await playwright[engine].launch();
    try {
      if (engine === 'chromium') {
        await saveInPlaceScenarios(browser, product);
        // A deck with charts (rendered after the engine records the opened document): the saved
        // file is recognised as the opened document on reopening, and reused without the picker.
        const garden = path.join(dir, 'garden.html');
        fs.writeFileSync(garden, setZone(fs.readFileSync(path.join(root, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8'), 'engine', asset('engine.js')));
        const context = await fakeFileContext(browser);
        for (const n of [7, 8]) {
          const page = await context.newPage();
          await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
          await page.goto(pathToFileURL(garden).href);
          await product.open(page);
          await page.waitForFunction(() => document.querySelector('figure[data-type] canvas, figure[data-type] svg'));
          await product.edit(page, n);
          await product.save(page);
          await page.waitForFunction(() => /Saved to garden\.html\. Next saves write|Save failed/.test(document.querySelector('.hs-banner')?.textContent ?? ''));
          const banner = await page.locator('.hs-banner').textContent();
          if (!banner.startsWith('Saved to garden.html.')) throw new Error(banner);
          if (!fs.readFileSync(garden, 'utf8').includes(product.marker(n))) throw new Error('garden.html not written');
          const picks = await page.evaluate(() => window.fakeFiles.picks);
          if (picks !== (n === 7 ? 1 : 0)) throw new Error(`picker opened ${picks} times on save ${n}`);
          await page.close();
        }
        await context.close();
        console.log('PASS save in place [Slides]: a saved deck with charts is recognised as the opened document on reopening');
        await recoveredDraft(browser);
      }
      await copyOnlyScenario(browser, { ...product, label: `Slides, ${engine}` });
    } finally {
      await browser.close();
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
