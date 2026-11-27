// The grid of ADR-016 §6 on invented inputs: every cell, every boundary. No figure here comes
// from a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid, report, usable, FORMATS, SUBJECTS, RUNS_PER_CELL } from '../lib/grid.mjs';

// A complete invented campaign: 15 runs per format. Totals are carried by the first run of each
// format; `unusable` runs have one blocking defect each.
function campaign({ html = {}, pptx = {}, preferences = { 1: 'equivalent', 2: 'equivalent', 3: 'equivalent', 4: 'equivalent', 5: 'equivalent' }, sharing = 'passed' } = {}) {
  const side = { 'html-slides': { minor: 40, ms: 1000, tokens: 1000, unusable: 0, ...html }, pptx: { minor: 40, ms: 1000, tokens: 1000, unusable: 0, ...pptx } };
  const runs = [];
  for (const format of FORMATS) {
    let index = 0;
    for (const subject of SUBJECTS) for (let run = 1; run <= RUNS_PER_CELL; run++) {
      const first = index === 0;
      const bad = index >= SUBJECTS.length * RUNS_PER_CELL - side[format].unusable;
      runs.push({ format, subject, run, opens: true, movesKept: true, blocking: bad ? 1 : 0,
        minor: first ? side[format].minor : 0, milliseconds: first ? side[format].ms : 0, tokens: first ? side[format].tokens : 0 });
      index++;
    }
  }
  return { runs, preferences, sharing };
}
const prefs = (...list) => Object.fromEntries(list.map((value, index) => [index + 1, value]));
const better = { html: { minor: 30 } };                       // exactly 25 % fewer than 40
const worse = { html: { minor: 50 } };                        // exactly 25 % more than 40
const cost = (ms, tokens = ms) => ({ ms, tokens });           // PPTX stays at 1000 / 1000

test('a run is usable when it opens, has no blocking defect and kept the moves', () => {
  const run = { opens: true, blocking: 0, movesKept: true };
  assert.equal(usable(run), true);
  assert.equal(usable({ ...run, opens: false }), false);
  assert.equal(usable({ ...run, blocking: 1 }), false);
  assert.equal(usable({ ...run, movesKept: false }), false);
  assert.equal(usable({ ...run, minor: 12 }), true, 'minor defects do not make a run unusable');
});

test('the nine cells of the grid', () => {
  const cells = [
    [better, cost(800), 'better', 'cheaper', 'Continue'],
    [better, cost(1000), 'better', 'comparable', 'Continue'],
    [better, cost(1200), 'better', 'dearer', 'Maintain Slides alone'],
    [{}, cost(800), 'equivalent', 'cheaper', 'Maintain Slides alone'],
    [{}, cost(1000), 'equivalent', 'comparable', 'Stop'],
    [{}, cost(1200), 'equivalent', 'dearer', 'Stop'],
    [worse, cost(800), 'worse', 'cheaper', 'Stop'],
    [worse, cost(1000), 'worse', 'comparable', 'Stop'],
    [worse, cost(1200), 'worse', 'dearer', 'Stop']
  ];
  for (const [quality, money, q, c, outcome] of cells) {
    const grid = computeGrid(campaign({ html: { ...quality.html, ...money } }));
    assert.equal(grid.quality.value, q);
    assert.equal(grid.cost.value, c);
    assert.equal(grid.outcome, outcome, `${q} / ${c}`);
    assert.equal(grid.complete, true);
  }
});

test('equivalent and cheaper: Continue only when the gain reaches 50 %', () => {
  assert.equal(computeGrid(campaign({ html: cost(500) })).outcome, 'Continue', 'exactly 50 %');
  assert.equal(computeGrid(campaign({ html: cost(501) })).outcome, 'Maintain Slides alone', 'just under 50 %');
  assert.equal(computeGrid(campaign({ html: cost(500, 501) })).outcome, 'Maintain Slides alone', 'the gain must hold on both measures');
  assert.equal(computeGrid(campaign({ html: { minor: 50, ...cost(100) } })).outcome, 'Stop', 'a worse quality is never bought back by the cost');
});

test('quality boundaries: 25 % fewer or more minor defects', () => {
  const quality = minor => computeGrid(campaign({ html: { minor } })).quality.value;
  assert.equal(quality(30), 'better', 'exactly 25 % fewer');
  assert.equal(quality(31), 'equivalent', 'less than 25 % fewer');
  assert.equal(quality(40), 'equivalent');
  assert.equal(quality(49), 'equivalent', 'less than 25 % more');
  assert.equal(quality(50), 'worse', 'exactly 25 % more');
  assert.equal(quality(0), 'better');
});

test('quality boundaries: no minor defect on one side or both', () => {
  const quality = (h, p) => computeGrid(campaign({ html: { minor: h }, pptx: { minor: p } })).quality.value;
  assert.equal(quality(0, 0), 'equivalent', 'nothing is fewer or more than nothing');
  assert.equal(quality(1, 0), 'worse');
  assert.equal(quality(0, 1), 'better');
  assert.equal(quality(3, 4), 'better', '3 against 4 is exactly 25 % fewer');
  assert.equal(quality(5, 4), 'worse', '5 against 4 is exactly 25 % more');
});

test('quality boundaries: usable runs', () => {
  const grid = (h, p, extra = {}) => computeGrid(campaign({ html: { unusable: h, ...extra }, pptx: { unusable: p } }));
  assert.equal(grid(1, 0).quality.value, 'worse', 'one usable run fewer is enough');
  assert.equal(grid(1, 1, { minor: 30 }).quality.value, 'better', 'as many usable runs');
  assert.equal(grid(0, 1, { minor: 30 }).quality.value, 'better', 'more usable runs');
  assert.equal(grid(0, 1).quality.value, 'equivalent', 'more usable runs alone do not make it better');
});

test('quality boundaries: the owner\'s preference', () => {
  const quality = (list, html = better.html) => computeGrid(campaign({ html, preferences: prefs(...list) })).quality.value;
  const H = 'html-slides', P = 'pptx', E = 'equivalent';
  assert.equal(quality([P, P, P, H, H]), 'worse', 'PPTX preferred on three subjects');
  assert.equal(quality([P, P, P, H, H], {}), 'worse', 'whatever the defects');
  assert.equal(quality([P, P, H, H, E]), 'better', 'as many subjects each: the PPTX is not preferred on more');
  assert.equal(quality([P, P, H, E, E]), 'equivalent', 'PPTX preferred on more subjects, fewer than three');
  assert.equal(quality([P, E, E, E, E]), 'equivalent');
  assert.equal(quality([E, E, E, E, E]), 'better');
  assert.equal(quality([H, H, H, H, H], {}), 'equivalent', 'preference alone does not make it better');
});

test('cost boundaries: 20 % either way, on time and on tokens', () => {
  const value = (ms, tokens) => computeGrid(campaign({ html: cost(ms, tokens) })).cost;
  assert.equal(value(800, 800).value, 'cheaper', 'exactly 20 % cheaper');
  assert.equal(value(801, 800).value, 'comparable');
  assert.equal(value(1199, 1199).value, 'comparable');
  assert.equal(value(1200, 1000).value, 'dearer', 'exactly 20 % dearer');
  assert.equal(value(1000, 1000).value, 'comparable');
});

test('the less favourable of time and tokens decides', () => {
  const value = (ms, tokens) => computeGrid(campaign({ html: cost(ms, tokens) })).cost;
  assert.deepEqual([value(500, 1300).value, value(500, 1300).deciding], ['dearer', 'tokens']);
  assert.deepEqual([value(1300, 500).value, value(1300, 500).deciding], ['dearer', 'time']);
  assert.deepEqual([value(700, 1000).value, value(700, 1000).deciding], ['comparable', 'tokens']);
  assert.deepEqual([value(700, 790).value, value(700, 790).deciding], ['cheaper', 'tokens'], 'same class: the higher ratio is named');
});

test('a format that fails runs is charged for them', () => {
  // Same totals, but html-slides has 12 usable runs against 15: per usable result it costs 25 % more.
  const grid = computeGrid(campaign({ html: { unusable: 3 }, pptx: {} }));
  assert.equal(grid.formats['html-slides'].usable, 12);
  assert.equal(grid.cost.value, 'dearer');
  assert.equal(grid.cost.time.ratio, 1.25);
  // 13 usable against 15: 15.4 % more, comparable. And the other way round.
  assert.equal(computeGrid(campaign({ html: { unusable: 2 } })).cost.value, 'comparable');
  assert.equal(computeGrid(campaign({ pptx: { unusable: 3 } })).cost.value, 'cheaper', '12/15 = exactly 20 % cheaper');
  assert.equal(computeGrid(campaign({ pptx: { unusable: 2 } })).cost.value, 'comparable');
});

test('no usable run', () => {
  const none = { unusable: 15 };
  let grid = computeGrid(campaign({ html: none }));
  assert.deepEqual([grid.quality.value, grid.cost.value, grid.outcome], ['worse', 'dearer', 'Stop']);
  grid = computeGrid(campaign({ pptx: none, html: { minor: 30 } }));
  assert.deepEqual([grid.quality.value, grid.cost.value, grid.outcome], ['better', 'cheaper', 'Continue']);
  grid = computeGrid(campaign({ html: none, pptx: none }));
  assert.equal(grid.cost.value, null);
  assert.equal(grid.outcome, null, 'the grid cannot be read');
  assert.match(grid.notes.join(' '), /cannot be read/);
});

test('a file that does not open is unusable and carries no count', () => {
  const input = campaign();
  Object.assign(input.runs[0], { opens: false, blocking: null, minor: null });
  const grid = computeGrid(input);
  assert.equal(grid.formats['html-slides'].usable, 14);
  assert.equal(grid.formats['html-slides'].minor, 0, 'its minor defects were never counted');
  assert.equal(grid.formats['html-slides'].milliseconds, 1000, 'its time is still charged');
  assert.equal(grid.quality.value, 'worse');
});

test('a run that lost the scripted moves is unusable', () => {
  const input = campaign();
  input.runs[20].movesKept = false;
  assert.equal(computeGrid(input).formats.pptx.usable, 14);
});

test('Continue depends on the sharing check', () => {
  const input = sharing => campaign({ html: { ...better.html, ...cost(800) }, sharing });
  assert.equal(computeGrid(input('passed')).outcome, 'Continue');
  let grid = computeGrid(input('not-checked'));
  assert.equal(grid.outcome, 'Continue');
  assert.match(grid.notes.join(' '), /sharing check/);
  grid = computeGrid(input('failed'));
  assert.equal(grid.cell, 'Continue');
  assert.equal(grid.outcome, null, 'the ADR names no fallback');
  assert.equal(computeGrid({ ...campaign({ html: cost(1200) }), sharing: 'failed' }).outcome, 'Stop', 'the other outcomes do not depend on it');
});

test('incomplete data give a provisional reading', () => {
  const input = campaign();
  const pilot = { runs: input.runs.filter(run => run.subject === 3 && run.run === 1), preferences: {}, sharing: 'not-checked' };
  const grid = computeGrid(pilot);
  assert.equal(grid.complete, false);
  assert.equal(grid.missing.length, 28);
  assert.equal(grid.preferences.missing, 5);
  assert.match(report(grid), /Provisional reading/);
  assert.match(grid.notes.join(' '), /28 of 30 runs are missing/);
  assert.equal(computeGrid({ ...input, preferences: prefs('pptx') }).complete, false, 'four preferences are missing');
});

test('invalid records are refused', () => {
  const broken = change => { const input = campaign(); Object.assign(input.runs[0], change); return () => computeGrid(input); };
  assert.throws(broken({ format: 'keynote' }), /unknown format/);
  assert.throws(broken({ subject: 6 }), /unknown subject/);
  assert.throws(broken({ blocking: null }), /needs its defect counts/);
  assert.throws(broken({ opens: false }), /has no defect count/);
  assert.throws(broken({ milliseconds: 1.5 }), /whole number/);
  assert.throws(broken({ tokens: -1 }), /whole number/);
  assert.throws(broken({ movesKept: undefined }), /movesKept/);
  assert.throws(() => { const input = campaign(); input.runs.push({ ...input.runs[0] }); computeGrid(input); }, /duplicate run/);
  assert.throws(() => computeGrid({ ...campaign(), preferences: prefs('keynote') }), /preference/);
  assert.throws(() => computeGrid({ ...campaign(), sharing: 'maybe' }), /sharing/);
});

test('large totals stay exact', () => {
  // 20 % of 9,007,199,254,740,990 tokens is not representable as a double product.
  const big = 9007199254740990;
  const grid = computeGrid(campaign({ html: { ms: 800, tokens: big / 5 * 4 }, pptx: { ms: 1000, tokens: big } }));
  assert.equal(grid.cost.value, 'cheaper');
});

test('the report names the axes, the cell and the outcome', () => {
  const text = report(computeGrid(campaign({ html: { ...better.html, ...cost(1200) } })));
  assert.match(text, /\*\*better\*\*/);
  assert.match(text, /\*\*dearer\*\*/);
  assert.match(text, /Outcome: \*\*Maintain Slides alone\*\*/);
});
