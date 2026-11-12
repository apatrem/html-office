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
      }
      await copyOnlyScenario(browser, { ...product, label: `Slides, ${engine}` });
    } finally {
      await browser.close();
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
