// How a run's record is read for the count, the owner's judgement and the grid. Invented records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFinalResult, rowOf, pending } from '../lib/record.mjs';
import { computeGrid, usable } from '../lib/grid.mjs';

const session = (wallMs, tokens) => ({ wallMs, tokens: { total: tokens }, costUsd: 1 });
const finished = { subject: 3, format: 'pptx', run: 1, generationFinished: true, editsFinished: true, generation: session(600000, 2000000), edits: session(300000, 900000),
  finalCheck: { passed: true }, render: { opens: true, pages: 9 }, movesKept: { kept: true, applied: 3, notApplied: 0 }, totals: { milliseconds: 900000, tokens: 2900000, costUsd: 2 }, skill: {} };
const count = { ok: true, blocking: 0, minor: 4 };

test('a finished run with a final file is counted, shown and can be usable', () => {
  const row = rowOf(finished, count);
  assert.equal(hasFinalResult(finished), true);
  assert.deepEqual([row.opens, row.checksPassed, row.blocking, row.minor, row.pages], [true, true, 0, 4, 9]);
  assert.equal(usable(row), true);
  assert.deepEqual(pending(finished, count), []);
  assert.match(pending(finished, undefined)[0], /no usable count yet/);
});

test('a run whose edits did not finish is "no result", even with a partly edited file', () => {
  // The editing session saved a file, then reached its time limit. The file was rendered apart for
  // diagnosis (record.partial); it is not a final result (ADR-016 §6, amended on 28 November 2026).
  const cut = { ...finished, editsFinished: false, render: { opens: false, pages: 0, error: 'the run did not finish' }, partial: { opens: true, pages: 9 },
    finalCheck: { ran: false, passed: false }, movesKept: { kept: false, applied: 0, notApplied: 0 } };
  assert.equal(hasFinalResult(cut), false);
  const row = rowOf(cut, undefined);
  assert.deepEqual([row.opens, row.blocking, row.minor, row.pages, row.checksPassed], [false, null, null, 0, false]);
  assert.equal(usable(row), false);
  assert.deepEqual(pending(cut, undefined), [], 'nothing is owed: it is not counted');
  assert.deepEqual([row.milliseconds, row.tokens], [900000, 2900000], 'its time and tokens are still charged');
  // Even a record that wrongly says its partial file opens is not a final result.
  assert.equal(rowOf({ ...cut, render: { opens: true, pages: 9 } }, count).opens, false);
  // In the grid: an unusable run without a final PDF, accepted as such.
  const grid = computeGrid({ runs: [row].map(({ subject, format, run, generationFinished, editsFinished, opens, checksPassed, blocking, minor, movesKept, milliseconds, tokens }) => ({ subject, format, run, generationFinished, editsFinished, opens, checksPassed, blocking, minor, movesKept, milliseconds, tokens })) });
  assert.deepEqual([grid.formats.pptx.usable, grid.formats.pptx.finalFiles, grid.formats.pptx.tokens], [0, 0, 2900000]);
});

test('a run whose generation failed has no final result either', () => {
  const failed = { ...finished, generationFinished: false, editsFinished: false, edits: undefined, render: { opens: false, pages: 0 }, finalCheck: { passed: false }, movesKept: { kept: false },
    totals: { milliseconds: 2700000, tokens: 5000000, costUsd: 3 } };
  const row = rowOf(failed, undefined);
  assert.deepEqual([row.opens, row.editsMs, row.movesKept, row.milliseconds], [false, null, false, 2700000]);
});

test('a finished run whose final file does not open, or fails its own check, stays a recorded run', () => {
  const closed = rowOf({ ...finished, render: { opens: false, pages: 0, error: 'PowerPoint did not open it' } }, undefined);
  assert.deepEqual([closed.opens, closed.blocking, usable(closed)], [false, null, false]);
  const invalid = rowOf({ ...finished, finalCheck: { passed: false } }, count);
  assert.deepEqual([invalid.opens, invalid.checksPassed, usable(invalid)], [true, false, false]);
});

test('a finished run on which no move could be applied waits for a person', () => {
  assert.match(pending({ ...finished, movesKept: { kept: null, applied: 0, notApplied: 3 } }, count)[0], /a person has to decide/);
});
