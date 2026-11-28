// The counter's side of the bench, without calling the counter: its instructions, the anonymised
// folders, and the totals drawn from an answer. All answers here are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODES, tally, counterPrompt, anonymise, prepareDeck, random, shuffle } from '../lib/count.mjs';
import { loadBrief, ROOT } from '../lib/briefs.mjs';

test('every code of the defect list has one class, and the list names them all', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs/gate/DEFECTS.md'), 'utf8');
  const rows = [...text.matchAll(/^\| \*\*([BM]\d)\*\* \| [^|]+ \| (Blocking|Minor) \|/gm)].map(match => [match[1], match[2].toLowerCase()]);
  assert.deepEqual(Object.fromEntries(rows), CODES);
  for (const [code, cls] of rows) assert.equal(cls, code[0] === 'B' ? 'blocking' : 'minor');
});

test('the counter\'s instructions hold the codes and the rules, and never name a format', () => {
  const prompt = counterPrompt(9);
  assert.match(prompt, /You are given 9 page images/);
  for (const code of Object.keys(CODES)) assert.ok(prompt.includes(`**${code}**`), code);
  assert.match(prompt, /Elements moved on purpose/);
  assert.doesNotMatch(prompt, /html|pptx|powerpoint|\{pages\}/i);
  assert.doesNotMatch(prompt, /The owner's sample|A usable run/, 'only the sections a counter needs');
});

test('an answer is totalled by class and by page', () => {
  const answer = { page_count_expected: 3, page_count_seen: 3, pages: [
    { page: 1, defects: [] },
    { page: 2, defects: [{ code: 'M3', element: 'third box', seen: 'lower than the others' }, { code: 'M3', element: 'footer', seen: 'shifted' }, { code: 'B3', element: 'chart', seen: 'Q4 reads 2.1' }] },
    { page: 3, defects: [{ code: 'M1', element: 'list', seen: 'runs into the footer' }] }] };
  const total = tally(answer, 3);
  assert.deepEqual([total.blocking, total.minor], [1, 3]);
  assert.deepEqual(total.pages[1].codes, { M3: 2, B3: 1 });
  assert.deepEqual([total.pages[0].blocking, total.pages[0].minor, total.pages[2].minor], [0, 0, 1]);
});

test('an answer that cannot be used is refused, not repaired', () => {
  const page = (n, defects = []) => ({ page: n, defects });
  assert.throws(() => tally({ pages: [page(1)] }, 2), /says nothing about page 2/);
  assert.throws(() => tally({ pages: [page(1), page(3)] }, 2), /outside 1 to 2/);
  assert.throws(() => tally({ pages: [page(1), page(1)] }, 1), /twice/);
  assert.throws(() => tally({ pages: [page(1, [{ code: 'X9' }])] }, 1), /unknown defect code/);
  assert.throws(() => tally({}, 1), /no list of pages/);
  for (const code of ['toString', 'constructor', '__proto__', 'b3']) assert.throws(() => tally({ pages: [page(1, [{ code, element: 'x', seen: 'y' }])] }, 1), /unknown defect code/, code);
});

test('one defect per element and per code: a repeated line is counted once', () => {
  const footer = { code: 'M3', element: 'Footer', seen: 'shifted' };
  const total = tally({ pages: [{ page: 1, defects: [footer, { ...footer, element: ' footer ', seen: 'lower than on page 2' }, { ...footer, code: 'M1' }, { code: 'M3', element: 'third box', seen: 'lower' }] }, { page: 2, defects: [footer] }] }, 2);
  assert.deepEqual([total.minor, total.pages[0].codes, total.pages[0].repeated, total.pages[1].minor], [4, { M3: 2, M1: 1 }, 1, 1]);
});

test('results are shuffled and renamed, the same way for the same seed', () => {
  const items = ['1/html-slides/1', '1/pptx/1', '2/html-slides/1', '2/pptx/1', '3/html-slides/1', '3/pptx/1'].map(key => ({ key }));
  const a = anonymise(items, 42), b = anonymise(items, 42), c = anonymise(items, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map(item => item.code), c.map(item => item.code));
  assert.deepEqual(a.map(item => item.key).sort(), items.map(item => item.key));
  for (const item of a) { assert.match(item.code, /^deck-[a-z2-9]{5}$/); assert.doesNotMatch(item.code, /html|pptx/); }
  assert.equal(new Set(a.map(item => item.code)).size, items.length);
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], random(7)), shuffle([1, 2, 3, 4, 5], random(7)));
});

test('the folder a counter sees holds pages, the expected content and the instructions only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-count-test-'));
  const pages = ['a.png', 'b.png'].map(name => { const file = path.join(dir, name); fs.writeFileSync(file, 'not a real image'); return file; });
  const names = prepareDeck(path.join(dir, 'deck-abcde'), pages, loadBrief(3));
  assert.deepEqual(names, ['page-01.png', 'page-02.png']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'deck-abcde')).sort(), ['expected.md', 'instructions.md', 'page-01.png', 'page-02.png']);
  for (const name of ['expected.md', 'instructions.md']) assert.doesNotMatch(fs.readFileSync(path.join(dir, 'deck-abcde', name), 'utf8'), /html-slides|pptx|powerpoint/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
