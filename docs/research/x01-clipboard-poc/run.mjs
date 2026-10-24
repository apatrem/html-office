import { chromium } from 'playwright';
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
// Two file:// documents = two opaque origins, as html-office files are used.
const dir = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ headless: true }); // add firefox/webkit in X02
const ctx = await browser.newContext();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(e => console.log('grant', e.message));
const src = await ctx.newPage(), dst = await ctx.newPage();
await src.goto('file://' + dir + '/source.html');
await dst.goto('file://' + dir + '/target.html');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
for (const how of ['dt', 'async']) {
  await src.bringToFront();
  await src.click('#' + how);
  await src.waitForFunction(() => window.r !== undefined);
  console.log(`\n=== copy ${how}: result`, await src.evaluate(() => window.r));
  await src.evaluate(() => { window.r = undefined; });
  await dst.bringToFront();
  await dst.evaluate(() => { window.got = null; });
  await dst.click('#t');
  await dst.keyboard.press(`${mod}+V`);
  await dst.waitForTimeout(300);
  console.log('paste event:', JSON.stringify(await dst.evaluate(() => window.got), null, 1));
  console.log('async read (sanitized):', JSON.stringify(await dst.evaluate(() => window.readAsync(false)), null, 1));
  console.log('async read (unsanitized):', JSON.stringify(await dst.evaluate(() => window.readAsync(true)), null, 1));
}
console.log('\nversion', browser.version());
await browser.close();
