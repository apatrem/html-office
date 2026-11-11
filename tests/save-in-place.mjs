// Save in place, shared by the three products' browser tests: a fake File System Access API
// over real files, and the scenarios every product must pass.
//
// Playwright cannot drive the native save picker or the permission prompt. The fake picker
// returns a handle for a real file (fakeFiles.next, or the suggested name next to the opened
// file) and, like Chromium, creates or empties that file before returning; handles are plain objects, so they persist in IndexedDB like real ones, and their methods
// live on Object.prototype (only for objects carrying fakePath). Write permission is granted to
// handles chosen in this page; a handle restored from IndexedDB asks, and fakeFiles.answer
// answers. window.__stallHandles (set by an init script) makes the remembered-handle database never answer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const COPY_ONLY = 'This browser can only download copies. To save in place, open the file in Chrome or Edge.';

function installFakeFiles() {
  const granted = new Set();
  const fake = (window.fakeFiles = { picks: 0, options: [], next: null, answer: 'granted', requests: 0, writes: 0 });
  const handle = fakePath => ({ kind: 'file', name: fakePath.split('/').pop(), fakePath });
  window.fakeHandle = handle;
  window.showSaveFilePicker = async (options = {}) => {
    fake.picks++;
    fake.options.push({ suggestedName: options.suggestedName, id: options.id, startIn: options.startIn?.name ?? null });
    if (fake.next === 'cancel') throw new DOMException('The user aborted a request.', 'AbortError');
    const dir = decodeURIComponent(location.pathname).replace(/[^/]*$/, '');
    const chosen = fake.next ?? dir + options.suggestedName;
    // Chromium creates or truncates the chosen file inside the picker (SELECT_SAVEAS_FILE).
    await window.__fakeWrite(chosen, '');
    granted.add(chosen);
    return handle(chosen);
  };
  const method = (name, fn) =>
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      writable: true,
      value(...args) {
        if (typeof this?.fakePath !== 'string') throw new TypeError(`${name} is not a function`);
        return fn.apply(this, args);
      },
    });
  method('getFile', async function () {
    const text = await window.__fakeRead(this.fakePath);
    return { text: async () => text };
  });
  // Storage that never answers, for the remembered handles only.
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (name, ...rest) =>
    window.__stallHandles && name === 'html-office-file-handles' ? {} : open(name, ...rest);
  method('createWritable', async function () {
    let next = '';
    const target = this.fakePath;
    if (!granted.has(target)) throw new DOMException('Write permission not granted', 'NotAllowedError');
    return {
      async write(value) { next = value; },
      async close() { await window.__fakeWrite(target, next); fake.writes++; },
      async abort() {},
    };
  });
  method('queryPermission', async function () {
    return granted.has(this.fakePath) ? 'granted' : 'prompt';
  });
  method('requestPermission', async function () {
    fake.requests++;
    if (fake.answer === 'granted') granted.add(this.fakePath);
    return fake.answer;
  });
}

// A context whose pages see the fake picker and the real files under it.
export async function fakeFileContext(browser, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  await context.exposeFunction('__fakeRead', p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''));
  await context.exposeFunction('__fakeWrite', (p, text) => fs.writeFileSync(p, text));
  await context.addInitScript(installFakeFiles);
  return context;
}

// The name of the handle remembered for the page's address, as the shared module stores it.
const rememberedName = page =>
  page.evaluate(async () => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin + location.pathname));
    const key = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('html-office-file-handles', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const g = r.result.transaction('handles').objectStore('handles').get(key);
        g.onsuccess = () => resolve(g.result?.name ?? null);
        g.onerror = () => reject(g.error);
      };
    });
  });
const remember = (page, fakePath) =>
  page.evaluate(async fakePath => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin + location.pathname));
    const key = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('html-office-file-handles', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const t = r.result.transaction('handles', 'readwrite');
        t.objectStore('handles').put(window.fakeHandle(fakePath), key);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      };
    });
  }, fakePath);

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// product: {
//   label, prefix (for file names), purpose (the picker id), dir (a folder for the files),
//   source (the file text), other (another document's text), statusSelector, open(page) (after
//   navigation: ready to edit and save), edit(page, n), marker(n) (text the saved file holds
//   after edit n), save(page) (presses Cmd/Ctrl+S)
// }
export async function saveInPlaceScenarios(browser, product, log = console.log) {
  const pass = what => log(`PASS save in place [${product.label}]: ${what}`);
  const file = (name, text = product.source) => {
    const p = path.join(product.dir, name);
    if (text === null) fs.rmSync(p, { force: true });
    else fs.writeFileSync(p, text);
    return p;
  };
  const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  async function open(context, p) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.errors = errors;
    await page.goto(pathToFileURL(p).href);
    await product.open(page);
    return page;
  }
  const fake = page => page.evaluate(() => ({ ...window.fakeFiles }));
  const waitStatus = (page, pattern) =>
    page.waitForFunction(
      ([source, flags, selector]) => new RegExp(source, flags).test(document.querySelector(selector)?.textContent ?? ''),
      [pattern.source, pattern.flags, product.statusSelector],
    );
  async function save(page, pattern) {
    await product.save(page);
    await waitStatus(page, pattern);
  }
  const savedOpened = name => new RegExp(`Saved to ${escape(name)}\\. Next saves write to it directly\\.`);

  // ---- the opened file is chosen once, then remembered and reused after reopening ----
  {
    const context = await fakeFileContext(browser);
    const a = file(`${product.prefix}-report.html`);
    let page = await open(context, a);
    await product.edit(page, 1);
    await save(page, savedOpened(path.basename(a)));
    let disk = await fake(page);
    assert.equal(disk.picks, 1);
    assert.deepEqual(disk.options[0], { suggestedName: path.basename(a), id: product.purpose, startIn: null });
    assert.ok(read(a).includes(product.marker(1)), 'the opened file holds the edit');
    assert.equal(await rememberedName(page), path.basename(a));
    await product.edit(page, 2);
    await product.save(page);
    await page.waitForFunction(() => window.fakeFiles.writes === 2);
    await waitStatus(page, new RegExp(`^Saved to ${escape(path.basename(a))}\\.$`));
    assert.equal((await fake(page)).picks, 1, 'later saves write without the picker');
    assert.ok(read(a).includes(product.marker(2)));
    assert.deepEqual(page.errors, []);
    await page.close();

    // Reopened: Save asks for write permission on the remembered file, inside the gesture.
    page = await open(context, a);
    await product.edit(page, 3);
    await save(page, savedOpened(path.basename(a)));
    disk = await fake(page);
    assert.deepEqual([disk.picks, disk.requests, disk.writes], [0, 1, 1]);
    assert.ok(read(a).includes(product.marker(3)));
    await page.close();
    pass('the first Save suggests the opened name; the opened file is remembered and reused after reopening, with a permission request');

    // Permission refused: the picker opens in the remembered file's folder. A new name is saved
    // and used from then on, and does not replace the file remembered for this address.
    page = await open(context, a);
    await page.evaluate(() => (window.fakeFiles.answer = 'denied'));
    const b = file(`${product.prefix}-report-v2.html`, null);
    await page.evaluate(b => (window.fakeFiles.next = b), b);
    await product.edit(page, 4);
    await save(page, new RegExp(`Saved to ${escape(path.basename(b))}\\. The opened file, ${escape(path.basename(a))}, is unchanged; open ${escape(path.basename(b))} to keep working on it\\.`));
    disk = await fake(page);
    assert.deepEqual([disk.picks, disk.requests], [1, 1]);
    assert.equal(disk.options[0].startIn, path.basename(a));
    const before = read(a);
    assert.ok(read(b).includes(product.marker(4)));
    assert.ok(!before.includes(product.marker(4)), 'the opened file is unchanged');
    await product.edit(page, 5);
    await product.save(page);
    await page.waitForFunction(() => window.fakeFiles.writes === 2);
    assert.equal((await fake(page)).picks, 1);
    assert.ok(read(b).includes(product.marker(5)), 'later saves go to the new file');
    assert.equal(read(a), before);
    assert.equal(await rememberedName(page), path.basename(a));
    assert.deepEqual(page.errors, []);
    await page.close();
    pass('a refused permission falls back to the picker in the same folder; a new name is used from then on and is not remembered for the opened file');

    // Changed on disk after opening: the remembered file is not reused; the picker opens, and
    // cancelling it writes nothing. Choosing the file there replaces it, as Save As does.
    page = await open(context, a);
    const changed = read(a).replace('</body>', '<!-- changed elsewhere -->\n</body>');
    fs.writeFileSync(a, changed);
    await product.edit(page, 6);
    await page.evaluate(() => (window.fakeFiles.next = 'cancel'));
    await product.save(page);
    await page.waitForFunction(() => window.fakeFiles.picks === 1);
    await page.waitForTimeout(200);
    disk = await fake(page);
    assert.deepEqual([disk.picks, disk.writes], [1, 0]);
    assert.equal(disk.options[0].startIn, path.basename(a));
    assert.equal(read(a), changed, 'nothing was overwritten');
    await page.evaluate(() => (window.fakeFiles.next = null));
    await save(page, savedOpened(path.basename(a)));
    assert.ok(read(a).includes(product.marker(6)), 'the file chosen in the picker is replaced');
    assert.deepEqual(page.errors, []);
    await context.close();
    pass('a remembered file whose content changed falls back to the picker; cancelling writes nothing, choosing it replaces it');
  }

  // ---- a remembered handle with another name is not reused ----
  {
    const context = await fakeFileContext(browser);
    const a = file(`${product.prefix}-named.html`);
    const other = file(`${product.prefix}-other.html`);
    let page = await open(context, a);
    await remember(page, other);
    await page.close();
    page = await open(context, a);
    await product.edit(page, 1);
    await save(page, savedOpened(path.basename(a)));
    const disk = await fake(page);
    assert.deepEqual([disk.picks, disk.requests], [1, 0]);
    assert.equal(disk.options[0].startIn, path.basename(other));
    assert.equal(read(other), product.source, 'the file with another name is untouched');
    assert.ok(read(a).includes(product.marker(1)));
    assert.equal(await rememberedName(page), path.basename(a));
    assert.deepEqual(page.errors, []);
    await context.close();
    pass('a remembered handle whose name differs from the opened file is not reused');
  }

  // ---- another file is replaced as in Save As, and only the opened file's name is remembered ----
  {
    const context = await fakeFileContext(browser);
    const a = file(`${product.prefix}-mine.html`);
    const theirs = file(`${product.prefix}-theirs.html`, product.other);
    let page = await open(context, a);
    await page.evaluate(p => (window.fakeFiles.next = p), theirs);
    await product.edit(page, 1);
    await save(page, new RegExp(`^Saved to ${escape(path.basename(theirs))}\\. The opened file, ${escape(path.basename(a))}, is unchanged; open ${escape(path.basename(theirs))} to keep working on it\\.`));
    assert.ok(read(theirs).includes(product.marker(1)), 'the chosen file holds the document');
    assert.equal(read(a), product.source, 'the opened file is unchanged');
    assert.equal(await rememberedName(page), null, 'another name is not remembered for the opened file');
    assert.deepEqual(page.errors, []);
    await page.close();
    // Same name in another folder: it counts as the opened file (nothing tells them apart).
    page = await open(context, a);
    const elsewhere = path.join(product.dir, `${product.prefix}-sub`, path.basename(a));
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    await page.evaluate(p => (window.fakeFiles.next = p), elsewhere);
    await product.edit(page, 2);
    await save(page, savedOpened(path.basename(a)));
    assert.equal((await fake(page)).picks, 1, 'nothing was remembered: the picker asks');
    assert.ok(read(elsewhere).includes(product.marker(2)));
    assert.equal(read(a), product.source);
    assert.equal(await rememberedName(page), path.basename(a));
    await page.close();
    // Reopened: that file no longer holds the document opened, so it is not reused.
    page = await open(context, a);
    await page.evaluate(() => (window.fakeFiles.next = 'cancel'));
    await product.edit(page, 3);
    await product.save(page);
    await page.waitForFunction(() => window.fakeFiles.picks === 1);
    await page.waitForTimeout(200);
    assert.equal((await fake(page)).requests, 1);
    assert.ok(!read(elsewhere).includes(product.marker(3)));
    await context.close();
    pass('another file chosen in the picker is replaced and not remembered; a file with the opened name is remembered, and reused only while it holds the opened document');
  }

  // ---- storage that never answers does not hold up Save ----
  {
    const context = await fakeFileContext(browser);
    await context.addInitScript(() => (window.__stallHandles = true));
    const a = file(`${product.prefix}-stalled.html`);
    const page = await open(context, a);
    await product.edit(page, 1);
    await save(page, savedOpened(path.basename(a)));
    assert.equal((await fake(page)).picks, 1);
    assert.ok(read(a).includes(product.marker(1)));
    await product.edit(page, 2);
    await product.save(page);
    await page.waitForFunction(() => window.fakeFiles.writes === 2);
    assert.ok(read(a).includes(product.marker(2)));
    assert.deepEqual(page.errors, []);
    await context.close();
    pass('when the remembered-handle storage never answers, Save opens the picker and saves');
  }
}

// Safari and Firefox (and Brave): Cmd/Ctrl+S downloads a copy, with a notice once per session.
export async function copyOnlyScenario(browser, product, log = console.log) {
  const context = await browser.newContext({ acceptDownloads: true });
  const p = path.join(product.dir, `${product.prefix}-copy.html`);
  fs.writeFileSync(p, product.source);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Chromium stands in for a browser without the API when it runs this scenario.
  await page.addInitScript(() => delete window.showSaveFilePicker);
  await page.goto(pathToFileURL(p).href);
  await product.open(page);
  await product.edit(page, 1);
  let download = page.waitForEvent('download');
  await product.save(page);
  const copy = fs.readFileSync(await (await download).path(), 'utf8');
  assert.ok(copy.includes(product.marker(1)), 'the copy holds the edit');
  await page.waitForFunction(
    ([selector, notice]) => document.querySelector(selector)?.textContent.includes(notice),
    [product.statusSelector, COPY_ONLY],
  );
  assert.equal(fs.readFileSync(p, 'utf8'), product.source, 'the opened file is unchanged');
  await product.edit(page, 2);
  download = page.waitForEvent('download');
  await product.save(page);
  await download;
  await page.waitForTimeout(100);
  assert.ok(!(await page.locator(product.statusSelector).textContent()).includes(COPY_ONLY), 'the notice is shown once per session');
  assert.deepEqual(errors, []);
  await context.close();
  log(`PASS save in place [${product.label}]: Cmd/Ctrl+S downloads a copy where the browser cannot save in place, with a one-time notice`);
}
