// The grid of ADR-016 §6 (as amended on 27 November 2026) on invented inputs: every cell, the exact
// boundaries 0.50, 0.75, 0.80, 1.20 and 1.25, and the zero cases. No figure here comes from a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGrid, report, usable, FORMATS, SUBJECTS, RUNS_PER_CELL } from '../lib/grid.mjs';

const GOOD = { generationFinished: true, editsFinished: true, opens: true, checksPassed: true, movesKept: true, blocking: 0, minor: 0 };
const ALL = SUBJECTS.length * RUNS_PER_CELL;

// A complete invented campaign: 15 runs per format. A format's totals are carried by its first run,
// which is always usable; its last `unusable` runs have one blocking defect each.
function campaign({ html = {}, pptx = {}, preferences = { 1: 'equivalent', 2: 'equivalent', 3: 'equivalent', 4: 'equivalent', 5: 'equivalent' }, sharing = 'passed' } = {}) {
  const side = { 'html-slides': { minor: 40, ms: 1000, tokens: 1000, unusable: 0, ...html }, pptx: { minor: 40, ms: 1000, tokens: 1000, unusable: 0, ...pptx } };
  const runs = [];
  for (const format of FORMATS) {
    let index = 0;
    for (const subject of SUBJECTS) for (let run = 1; run <= RUNS_PER_CELL; run++) {
      const first = index === 0, bad = index >= ALL - side[format].unusable;
      runs.push({ ...GOOD, format, subject, run, blocking: bad ? 1 : 0, minor: first ? side[format].minor : 0,
        milliseconds: first ? side[format].ms : 0, tokens: first ? side[format].tokens : 0 });
      index++;
    }
  }
  return { runs, preferences, sharing };
}
const prefs = (...list) => Object.fromEntries(list.map((value, index) => [index + 1, value]));
const H = 'html-slides', P = 'pptx', E = 'equivalent';
const better = { minor: 30 };                                  // D = 0.75
const worse = { minor: 50 };                                   // D = 1.25
const cost = (ms, tokens = ms) => ({ ms, tokens });            // PPTX stays at 1000 / 1000
const read = input => { const grid = computeGrid(input); return [grid.quality.value, grid.cost.value, grid.outcome]; };

test('a run is usable only when every condition of the ADR holds', () => {
  assert.equal(usable(GOOD), true);
  for (const change of [{ generationFinished: false }, { editsFinished: false }, { opens: false }, { checksPassed: false }, { blocking: 1 }, { movesKept: false }])
    assert.equal(usable({ ...GOOD, ...change }), false, JSON.stringify(change));
  assert.equal(usable({ ...GOOD, minor: 12 }), true, 'minor defects do not make a run unusable');
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
    const input = campaign({ html: { ...quality, ...money } });
    assert.deepEqual(read(input), [q, c, outcome], `${q} / ${c}`);
    assert.equal(computeGrid(input).complete, true);
  }
});

test('R at 0.50: equivalent and cheaper becomes Continue', () => {
  assert.equal(computeGrid(campaign({ html: cost(500) })).outcome, 'Continue', 'R = 0.50');
  assert.equal(computeGrid(campaign({ html: cost(501) })).outcome, 'Maintain Slides alone', 'R just above 0.50');
  assert.equal(computeGrid(campaign({ html: cost(500, 501) })).outcome, 'Maintain Slides alone', 'R is the larger ratio');
  assert.equal(computeGrid(campaign({ html: { ...worse, ...cost(100) } })).outcome, 'Stop', 'a worse quality is never bought back by the cost');
  assert.equal(computeGrid(campaign({ html: cost(500) })).cost.r, 0.5);
});

test('D at 0.75 and 1.25, with as many usable runs on both sides', () => {
  const quality = minor => computeGrid(campaign({ html: { minor } })).quality;
  assert.deepEqual([quality(30).value, quality(30).d], ['better', 0.75]);
  assert.equal(quality(31).value, 'equivalent', 'D just above 0.75');
  assert.equal(quality(40).value, 'equivalent');
  assert.equal(quality(49).value, 'equivalent', 'D just under 1.25');
  assert.deepEqual([quality(50).value, quality(50).d], ['worse', 1.25]);
  assert.equal(quality(0).value, 'better', 'D = 0');
});

test('D compares minor defects per usable result, not totals', () => {
  // PPTX has 12 usable runs and 32 minor defects (2.667 each); html-slides has 15 usable runs.
  const quality = minor => computeGrid(campaign({ html: { minor }, pptx: { minor: 32, unusable: 3 } })).quality;
  assert.deepEqual([quality(30).value, quality(30).d], ['better', 0.75], '30 / 15 against 32 / 12');
  assert.equal(quality(31).value, 'equivalent');
  assert.equal(quality(49).value, 'equivalent');
  assert.deepEqual([quality(50).value, quality(50).d], ['worse', 1.25], '50 / 15 against 32 / 12');
  assert.equal(quality(40).value, 'equivalent', 'more defects in total (40 against 32), fewer per usable result than 1.25 times');
});

test('the minor defects of an unusable run are left out of D', () => {
  const input = campaign({ html: { minor: 30, unusable: 1 }, pptx: { unusable: 1 } });
  input.runs.find(run => run.format === H && run.blocking === 1).minor = 500;
  const grid = computeGrid(input);
  assert.equal(grid.formats[H].minorOfUsable, 30);
  assert.deepEqual([grid.quality.value, grid.quality.d], ['better', 0.75]);
});

test('PPTX without a minor defect: D does not exist', () => {
  const quality = (h, p) => computeGrid(campaign({ html: { minor: h }, pptx: { minor: p } })).quality;
  assert.deepEqual([quality(0, 0).value, quality(0, 0).d], ['equivalent', null], 'none on either side meets neither condition');
  assert.equal(quality(1, 0).value, 'worse', 'any against none');
  assert.equal(quality(0, 1).value, 'better');
});

test('usable runs: fewer is worse, as many or more is needed for better', () => {
  const quality = (h, p, minor = 40) => computeGrid(campaign({ html: { unusable: h, minor }, pptx: { unusable: p } })).quality.value;
  assert.equal(quality(1, 0), 'worse', 'one usable run fewer is enough');
  assert.equal(quality(1, 0, 0), 'worse', 'whatever the defects');
  // 14 usable runs each: D = (28 / 14) / (40 / 14) = 0.70.
  assert.equal(quality(1, 1, 28), 'better', 'as many usable runs');
  assert.equal(quality(0, 1, 28), 'better', 'more usable runs');
  assert.equal(quality(0, 1), 'equivalent', 'more usable runs alone do not make it better');
});

test('the owner\'s preference, one per subject', () => {
  const quality = (list, html = better) => computeGrid(campaign({ html, preferences: prefs(...list) })).quality.value;
  assert.equal(quality([P, P, P, H, H]), 'worse', 'PPTX preferred on three subjects');
  assert.equal(quality([P, P, P, H, H], {}), 'worse', 'whatever the defects');
  assert.equal(quality([P, P, H, H, E]), 'better', 'as many subjects each: PPTX is not preferred on more');
  assert.equal(quality([P, P, H, E, E]), 'equivalent', 'PPTX preferred on more subjects, fewer than three');
  assert.equal(quality([P, E, E, E, E]), 'equivalent');
  assert.equal(quality([E, E, E, E, E]), 'better', 'equivalent counts for neither side');
  assert.equal(quality([H, H, H, H, H], {}), 'equivalent', 'preference alone does not make it better');
});

test('a subject without any final PDF has the preference equivalent', () => {
  const input = campaign({ html: better, preferences: prefs(H, H, P, P) });
  for (const run of input.runs.filter(r => r.subject === 5)) Object.assign(run, { opens: false, blocking: null, minor: null });
  const grid = computeGrid(input);
  assert.deepEqual(grid.preferences, { 'html-slides': 2, pptx: 2, equivalent: 1, missing: 0 });
  assert.equal(grid.complete, true);
  assert.throws(() => computeGrid({ ...input, preferences: prefs(H, H, P, P, P) }), /neither format produced a final PDF/);
  // One PDF on either side is enough for the owner to judge: the preference is then required.
  Object.assign(input.runs.find(r => r.subject === 5 && r.format === P), { opens: true, blocking: 1, minor: 0 });
  assert.equal(computeGrid(input).preferences.missing, 1);
});

test('R at 0.80 and 1.20, on time and on tokens', () => {
  const value = (ms, tokens) => computeGrid(campaign({ html: cost(ms, tokens) })).cost;
  assert.deepEqual([value(800, 800).value, value(800, 800).r], ['cheaper', 0.8]);
  assert.equal(value(801, 800).value, 'comparable', 'R just above 0.80');
  assert.equal(value(800, 801).value, 'comparable');
  assert.equal(value(1199, 1199).value, 'comparable', 'R just under 1.20');
  assert.deepEqual([value(1200, 1000).value, value(1200, 1000).r], ['dearer', 1.2]);
  assert.equal(value(1000, 1200).value, 'dearer');
  assert.equal(value(1000, 1000).value, 'comparable');
});

test('R is the larger of the two ratios', () => {
  const value = (ms, tokens) => computeGrid(campaign({ html: cost(ms, tokens) })).cost;
  assert.deepEqual([value(500, 1300).value, value(500, 1300).r], ['dearer', 1.3]);
  assert.deepEqual([value(1300, 500).value, value(1300, 500).r], ['dearer', 1.3]);
  assert.deepEqual([value(700, 1000).value, value(700, 1000).r], ['comparable', 1]);
  assert.deepEqual([value(700, 790).value, value(700, 790).r], ['cheaper', 0.79]);
});

test('failed runs are charged: totals over all runs, divided by the usable ones', () => {
  // Same totals, but html-slides has 12 usable runs against 15: R = 1.25.
  const grid = computeGrid(campaign({ html: { unusable: 3 } }));
  assert.equal(grid.formats[H].usable, 12);
  assert.deepEqual([grid.cost.value, grid.cost.r], ['dearer', 1.25]);
  assert.equal(computeGrid(campaign({ html: { unusable: 2 } })).cost.value, 'comparable', '15 / 13 = 1.154');
  const cheap = computeGrid(campaign({ pptx: { unusable: 3 } }));
  assert.deepEqual([cheap.cost.value, cheap.cost.r], ['cheaper', 0.8], '12 / 15 = 0.80');
  assert.equal(computeGrid(campaign({ pptx: { unusable: 2 } })).cost.value, 'comparable');
  // The time and tokens of a failed run count even though its result does not.
  const input = campaign();
  Object.assign(input.runs.find(run => run.format === H && run.run === 2), { editsFinished: false, opens: false, blocking: null, minor: null, milliseconds: 500, tokens: 0 });
  const charged = computeGrid(input);
  assert.deepEqual([charged.formats[H].usable, charged.formats[H].milliseconds], [14, 1500]);
});

test('a format without a usable run', () => {
  const none = { unusable: ALL };
  assert.deepEqual(read(campaign({ html: none })), ['worse', null, 'Stop'], 'html-slides with none: stop');
  assert.deepEqual(read(campaign({ html: none, pptx: none })), [null, null, 'Stop'], 'neither: still stop');
  assert.deepEqual(read(campaign({ pptx: none })), ['better', 'cheaper', 'Continue'], 'PPTX with none and html-slides with at least one');
  assert.deepEqual(read(campaign({ pptx: none, html: { unusable: ALL - 1, minor: 500, ...cost(9000) } })), ['better', 'cheaper', 'Continue'], 'one usable run is enough');
  assert.deepEqual(read(campaign({ pptx: none, preferences: prefs(P, P, P, P, P) })), ['better', 'cheaper', 'Continue'], 'as the ADR writes it, whatever the preference');
  assert.match(computeGrid(campaign({ html: none })).notes.join(' '), /no usable run: Stop/);
});

test('each cause of an unusable run', () => {
  const lose = change => { const input = campaign(); Object.assign(input.runs[1], change); return computeGrid(input).formats[H]; };
  assert.equal(lose({ generationFinished: false, editsFinished: false, opens: false, blocking: null, minor: null }).usable, 14, 'generation cut off');
  assert.equal(lose({ editsFinished: false }).usable, 14, 'the edits did not finish');
  assert.equal(lose({ opens: false, blocking: null, minor: null }).usable, 14, 'the final file does not open');
  assert.equal(lose({ checksPassed: false }).usable, 14, 'the final file fails its format\'s own checks');
  assert.equal(lose({ blocking: 2 }).usable, 14, 'a blocking defect');
  assert.equal(lose({ movesKept: false }).usable, 14, 'the scripted moves were lost');
  assert.equal(lose({ opens: false, blocking: null, minor: null }).finalFiles, 14);
});

test('the sharing check', () => {
  const input = sharing => campaign({ html: { ...better, ...cost(800) }, sharing });
  assert.equal(computeGrid(input('passed')).outcome, 'Continue');
  assert.equal(computeGrid(input('not-checked')).outcome, 'Continue (pending the sharing check)');
  assert.equal(computeGrid(input('failed-once')).outcome, 'Continue (pending the sharing check)', 'fixed, then checked once more');
  const twice = computeGrid(input('failed-twice'));
  assert.deepEqual([twice.cell, twice.outcome], ['Continue', 'Maintain Slides alone']);
  for (const sharing of ['not-checked', 'failed-once', 'failed-twice']) {
    assert.equal(computeGrid(campaign({ html: cost(1200), sharing })).outcome, 'Stop', 'the other outcomes do not depend on it');
    assert.equal(computeGrid(campaign({ html: { ...better, ...cost(1200) }, sharing })).outcome, 'Maintain Slides alone');
  }
  assert.equal(computeGrid(campaign({ html: cost(500), sharing: 'not-checked' })).outcome, 'Continue (pending the sharing check)', 'also when Continue comes from R ≤ 0.50');
});

test('incomplete data give a provisional reading', () => {
  const input = campaign();
  const pilot = { runs: input.runs.filter(run => run.subject === 3 && run.run === 1).map(run => ({ ...run, milliseconds: 600000, tokens: 2000000 })), preferences: {}, sharing: 'not-checked' };
  const grid = computeGrid(pilot);
  assert.equal(grid.complete, false);
  assert.equal(grid.missing.length, 28);
  assert.equal(grid.preferences.missing, 5);
  assert.match(report(grid), /Provisional reading/);
  assert.match(grid.notes.join(' '), /28 of 30 runs are missing/);
  assert.equal(computeGrid({ ...input, preferences: prefs(P) }).complete, false, 'four preferences are missing');
  assert.equal(computeGrid({ runs: [], preferences: {} }).outcome, 'Stop', 'no run at all: html-slides has no usable run');
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
  assert.throws(broken({ checksPassed: null }), /checksPassed/);
  assert.throws(broken({ generationFinished: false }), /edits cannot finish/);
  assert.throws(broken({ milliseconds: 0 }), /no recorded time or tokens/);
  assert.throws(() => { const input = campaign(); input.runs.push({ ...input.runs[0] }); computeGrid(input); }, /duplicate run/);
  assert.throws(() => computeGrid({ ...campaign(), preferences: prefs('keynote') }), /preference/);
  assert.throws(() => computeGrid({ ...campaign(), sharing: 'failed' }), /sharing/);
});

test('large totals stay exact', () => {
  // 80 % of 9,007,199,254,740,990 tokens is not reached exactly by a product of doubles.
  const big = 9007199254740990;
  assert.equal(computeGrid(campaign({ html: { ms: 800, tokens: big / 5 * 4 }, pptx: { ms: 1000, tokens: big } })).cost.value, 'cheaper');
  assert.equal(computeGrid(campaign({ html: { ms: 800, tokens: big / 5 * 4 + 2 }, pptx: { ms: 1000, tokens: big } })).cost.value, 'comparable');
});

test('totals beyond the largest safe integer stay exact', () => {
  // Found by the review of #134: every recorded value is safe, their sum is not.
  const M = 9007199254740990;
  const input = campaign({ html: cost(500), pptx: cost(1000) });
  const set = (format, list) => input.runs.filter(run => run.format === format).forEach((run, index) => { run.tokens = list[index] ?? 0; });
  set(H, [M, M, 1]); set(P, [M, M, M, M]);
  assert.equal(computeGrid(input).outcome, 'Maintain Slides alone', '(2M + 1) / 4M is just above 0.50');
  set(H, [M, M]);
  assert.equal(computeGrid(input).outcome, 'Continue', '2M / 4M is exactly 0.50');
});

test('recorded costs of zero', () => {
  const zero = (format, key) => { const input = campaign(); input.runs.filter(run => run.format === format).forEach(run => { run[key] = 0; }); return () => computeGrid(input); };
  for (const format of FORMATS) for (const key of ['milliseconds', 'tokens']) assert.throws(zero(format, key), /no recorded time or tokens/, `${format} ${key}`);
  // A format without a usable run may have recorded nothing: the ADR's rule for it does not use its cost.
  const none = input => { input.runs.filter(run => run.format === P).forEach(run => Object.assign(run, { blocking: 1, milliseconds: 0, tokens: 0 })); return input; };
  assert.deepEqual(read(none(campaign())), ['better', 'cheaper', 'Continue']);
  const neither = campaign({ html: { unusable: ALL } });
  neither.runs.forEach(run => Object.assign(run, { milliseconds: 0, tokens: 0 }));
  assert.equal(computeGrid(none(neither)).outcome, 'Stop');
});

test('the report names the axes, the ratios, the cell and the outcome', () => {
  const text = report(computeGrid(campaign({ html: { ...better, ...cost(1200) } })));
  assert.match(text, /\*\*better\*\*/);
  assert.match(text, /D = 0\.750/);
  assert.match(text, /\*\*dearer\*\*/);
  assert.match(text, /R = 1\.200/);
  assert.match(text, /Outcome: \*\*Maintain Slides alone\*\*/);
});
