// How a run's record is read by the count, by the owner's judgement and by the grid (ADR-016 §6).
// Kept apart from the command line so that the rules can be tested.

// A final result exists only for a run that finished its generation and its three edits. A run that
// did not finish is "no result", even if it left a partly edited file: that file may be kept for
// diagnosis, and is neither shown to the owner nor counted.
export const hasFinalResult = record => record.generationFinished === true && record.editsFinished === true && record.render?.opens === true;

// The line of a run in the results file. `counted` is the counter's answer for it, if any.
export function rowOf(record, counted) {
  const final = hasFinalResult(record);
  return {
    subject: record.subject, format: record.format, run: record.run,
    generationFinished: record.generationFinished === true, editsFinished: record.editsFinished === true,
    opens: final, checksPassed: final && record.finalCheck?.passed === true,
    blocking: final ? counted?.blocking ?? null : null, minor: final ? counted?.minor ?? null : null,
    movesKept: record.movesKept?.kept ?? false,
    // Charged whatever became of the run.
    milliseconds: record.totals.milliseconds, tokens: record.totals.tokens,
    generationMs: record.generation.wallMs, editsMs: record.edits?.wallMs ?? null, costUsd: record.totals.costUsd,
    pages: final ? record.render.pages : 0, movesApplied: record.movesKept?.applied ?? 0, movesNotApplied: record.movesKept?.notApplied ?? 0, skill: record.skill
  };
}

// What stops the grid from being computed for a run: something a count or a person still owes.
export function pending(record, counted) {
  const key = `${record.subject}/${record.format}/${record.run}`;
  const out = [];
  if (hasFinalResult(record) && !counted?.ok) out.push(`${key}: its final file opens but has no usable count yet`);
  if (record.editsFinished && record.movesKept?.kept === null) out.push(`${key}: no target of the scripted move could be applied; a person has to decide what this run shows`);
  return out;
}
