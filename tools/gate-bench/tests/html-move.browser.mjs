// The html-slides side of the scripted move, in Chromium, on the distributed example deck (fictional
// content). Run by hand: node tools/gate-bench/tests/html-move.browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveDeck, checkMoves, SLIDE } from '../lib/html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const example = path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-html-test-'));
const moved = path.join(dir, 'moved.html');
let fails = 0;
const ok = (condition, message) => { console.log((condition ? 'OK  ' : 'FAIL') + ' ' + message); if (!condition) fails++; };

const move = { dx: -0.02, dy: -0.02, targets: [
  { slide: 2, kind: 'text', contains: 'three small changes', label: 'a text of slide 2' },
  { slide: 4, kind: 'chart', label: 'the chart of slide 4' },
  { slide: 7, kind: 'text', contains: 'review', label: 'a shape of the detached slide 7' },
  { slide: 8, kind: 'table', label: 'the table of slide 8' },
  { slide: 9, kind: 'chart', label: 'a chart that does not exist' }
] };
const result = await moveDeck(example, moved, move);
ok(result.slides === 9, `nine slides (${result.slides})`);
ok(JSON.stringify(result.targets.map(t => t.resolved)) === '[true,true,true,true,false]', 'four targets applied, the absent one reported');
for (const target of result.targets.filter(t => t.resolved)) {
  const { before, after } = target.shapes[0];
  const dx = (after.x - before.x) * SLIDE.width, dy = (after.y - before.y) * SLIDE.height;
  ok(Math.abs(dx + 25.6) <= 2 && Math.abs(dy + 14.4) <= 2, `${target.label}: moved by ${dx.toFixed(1)}, ${dy.toFixed(1)} px`);
}
const html = fs.readFileSync(moved, 'utf8');
for (const id of ['s02', 's04', 's07', 's08']) ok(new RegExp(`<section[^>]*id="${id}"[^>]*data-detached`).test(html), `${id} is detached in the saved file`);
ok(!/<section[^>]*id="s05"[^>]*data-detached/.test(html), 's05 keeps its layout');
ok(!/hs-editing|data-ui/.test(html.match(/<main\b[^>]*id="deck"[^>]*>[\s\S]*?<\/main>/)[0]), 'no editor interface in the saved content');

let check = await checkMoves(moved, result);
ok(check.kept === true && check.applied === 4 && check.notApplied === 1, 'the untouched file keeps its four moves');

// An edit that resets the layout of slide 4 loses the move of its chart.
const reset = path.join(dir, 'reset.html');
fs.writeFileSync(reset, html.replace(/(<section[^>]*id="s04"[^>]*?) data-detached(="")?/, '$1').replace(/(<section[^>]*id="s04"[\s\S]*?<\/section>)/, section => section.replace(/ style="--x:[^"]*"/g, '')));
check = await checkMoves(reset, result);
ok(check.kept === false && JSON.stringify(check.targets.map(t => t.kept)) === '[true,false,true,true,null]', 'a reset layout is seen as a lost move');

// An edit that renumbers the identifiers: the elements are found again by kind and text.
const renamed = path.join(dir, 'renamed.html');
const tableId = result.targets[3].shapes[0].id;
fs.writeFileSync(renamed, html.replaceAll(`data-id="${tableId}"`, 'data-id="e999"'));
check = await checkMoves(renamed, result);
ok(check.targets[3].kept === true && check.targets[3].shapes[0].how !== 'same identifier', `the table is found again (${check.targets[3].shapes[0].how})`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'All checks passed');
process.exit(fails ? 1 : 0);
