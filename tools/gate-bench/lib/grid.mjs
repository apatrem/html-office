// The decision grid of ADR-016 §6, computed from recorded runs. Nothing here measures anything:
// the function only applies the written rules, with exact integer arithmetic so that a value
// sitting on a threshold (25 %, 20 %, 50 %) falls on the side the ADR names ("at least", "or more").
//
// Readings the ADR leaves open, fixed here and listed in docs/gate/README.md:
// - a format's minor defects are the sum over all of its counted runs;
// - "25 % fewer" and "25 % more" need a real difference: with no minor defect on either side,
//   neither holds;
// - time and tokens of a run are generation plus the three edits, and every run is charged,
//   usable or not;
// - "the less favourable measure counts" is read for html-slides: the measure on which it does
//   worst against PPTX decides the column.

export const FORMATS = ['html-slides', 'pptx'];
export const SUBJECTS = [1, 2, 3, 4, 5];
export const RUNS_PER_CELL = 3;

export const OUTCOMES = {
  continue: 'Continue',
  maintain: 'Maintain Slides alone',
  stop: 'Stop'
};

const GRID = {
  better: { cheaper: 'continue', comparable: 'continue', dearer: 'maintain' },
  // Cheaper and equivalent: "Maintain Slides alone; Continue if the gain reaches 50 %".
  equivalent: { cheaper: 'maintain', comparable: 'stop', dearer: 'stop' },
  worse: { cheaper: 'stop', comparable: 'stop', dearer: 'stop' }
};

const isCount = value => Number.isInteger(value) && value >= 0;

// A run is usable when its file opens, has no blocking defect and kept the scripted moves.
export function usable(run) {
  return run.opens === true && run.blocking === 0 && run.movesKept === true;
}

function validate(run, index) {
  const where = `run ${index + 1} (${run.format ?? '?'}, subject ${run.subject ?? '?'}, run ${run.run ?? '?'})`;
  if (!FORMATS.includes(run.format)) throw new Error(`${where}: unknown format`);
  if (!SUBJECTS.includes(run.subject)) throw new Error(`${where}: unknown subject`);
  if (!Number.isInteger(run.run) || run.run < 1) throw new Error(`${where}: run number`);
  if (typeof run.opens !== 'boolean') throw new Error(`${where}: opens must be true or false`);
  if (typeof run.movesKept !== 'boolean') throw new Error(`${where}: movesKept must be true or false`);
  if (run.opens) {
    if (!isCount(run.blocking) || !isCount(run.minor)) throw new Error(`${where}: a file that opens needs its defect counts`);
  } else if (run.blocking != null || run.minor != null) throw new Error(`${where}: a file that does not open has no defect count`);
  if (!isCount(run.milliseconds)) throw new Error(`${where}: milliseconds must be a whole number`);
  if (!isCount(run.tokens)) throw new Error(`${where}: tokens must be a whole number`);
}

function totals(runs, format) {
  const own = runs.filter(run => run.format === format);
  const sum = key => own.reduce((total, run) => total + (run[key] ?? 0), 0);
  return {
    runs: own.length,
    usable: own.filter(usable).length,
    blocking: sum('blocking'),
    minor: sum('minor'),
    milliseconds: sum('milliseconds'),
    tokens: sum('tokens')
  };
}

// html-slides against PPTX for one measure. Per usable result: total / usable runs, so the
// comparison total_h / usable_h <= k * total_p / usable_p is cross-multiplied.
function costClass(html, pptx, key) {
  if (html.usable === 0 && pptx.usable === 0) return { class: null, ratio: null, gain50: false };
  if (html.usable === 0) return { class: 'dearer', ratio: Infinity, gain50: false };
  if (pptx.usable === 0) return { class: 'cheaper', ratio: 0, gain50: true };
  const left = BigInt(html[key]) * BigInt(pptx.usable);   // html-slides per usable, scaled
  const right = BigInt(pptx[key]) * BigInt(html.usable);  // PPTX per usable, same scale
  const ratio = right === 0n ? (left === 0n ? 1 : Infinity) : Number(left) / Number(right);
  if (right === 0n && left === 0n) return { class: 'comparable', ratio, gain50: false };
  let cls = 'comparable';
  if (5n * left <= 4n * right) cls = 'cheaper';        // 20 % cheaper or more
  else if (5n * left >= 6n * right) cls = 'dearer';    // 20 % dearer or more
  return { class: cls, ratio, gain50: 2n * left <= right };
}

const ORDER = ['cheaper', 'comparable', 'dearer'];

export function computeGrid({ runs = [], preferences = {}, sharing = 'not-checked' } = {}) {
  runs.forEach(validate);
  const seen = new Set();
  for (const run of runs) {
    const key = `${run.format}/${run.subject}/${run.run}`;
    if (seen.has(key)) throw new Error(`duplicate run ${key}`);
    seen.add(key);
  }
  if (!['passed', 'failed', 'not-checked'].includes(sharing)) throw new Error('sharing must be passed, failed or not-checked');

  const missing = [];
  for (const format of FORMATS) for (const subject of SUBJECTS) for (let run = 1; run <= RUNS_PER_CELL; run++)
    if (!seen.has(`${format}/${subject}/${run}`)) missing.push(`${format}/${subject}/${run}`);
  const extra = runs.filter(run => run.run > RUNS_PER_CELL).map(run => `${run.format}/${run.subject}/${run.run}`);

  const html = totals(runs, 'html-slides');
  const pptx = totals(runs, 'pptx');

  // ---- first axis: quality ----
  const prefer = { 'html-slides': 0, pptx: 0, equivalent: 0, missing: 0 };
  for (const subject of SUBJECTS) {
    const value = preferences[subject] ?? preferences[String(subject)] ?? null;
    if (value === null) prefer.missing++;
    else if (value in prefer && value !== 'missing') prefer[value]++;
    else throw new Error(`preference for subject ${subject} must be html-slides, pptx or equivalent`);
  }
  const fewerUsable = html.usable < pptx.usable;
  const minorMore = html.minor > pptx.minor && 4 * html.minor >= 5 * pptx.minor;
  const minorFewer = html.minor < pptx.minor && 4 * html.minor <= 3 * pptx.minor;
  const worseReasons = [];
  if (fewerUsable) worseReasons.push(`fewer usable runs (${html.usable} against ${pptx.usable})`);
  if (minorMore) worseReasons.push(`at least 25 % more minor defects (${html.minor} against ${pptx.minor})`);
  if (prefer.pptx >= 3) worseReasons.push(`the owner prefers the PPTX on ${prefer.pptx} subjects`);
  let quality;
  let qualityReasons;
  if (worseReasons.length) { quality = 'worse'; qualityReasons = worseReasons; }
  else if (html.usable >= pptx.usable && minorFewer && prefer.pptx <= prefer['html-slides']) {
    quality = 'better';
    qualityReasons = [`at least as many usable runs (${html.usable} against ${pptx.usable})`,
      `at least 25 % fewer minor defects (${html.minor} against ${pptx.minor})`,
      `the owner prefers the PPTX on ${prefer.pptx} subjects and html-slides on ${prefer['html-slides']}`];
  } else {
    quality = 'equivalent';
    qualityReasons = ['neither the conditions of better nor those of worse are met'];
  }

  // ---- second axis: cost ----
  const time = costClass(html, pptx, 'milliseconds');
  const tokens = costClass(html, pptx, 'tokens');
  let cost = null;
  let deciding = null;
  let gain50 = false;
  if (time.class !== null) {
    deciding = ORDER.indexOf(tokens.class) > ORDER.indexOf(time.class) ? 'tokens'
      : ORDER.indexOf(time.class) > ORDER.indexOf(tokens.class) ? 'time'
        : tokens.ratio > time.ratio ? 'tokens' : 'time';
    cost = (deciding === 'tokens' ? tokens : time).class;
    gain50 = time.gain50 && tokens.gain50;
  }

  // ---- the grid ----
  const notes = [];
  let cell = null;
  let outcome = null;
  if (cost === null) notes.push('No usable run in either format: the cost per usable result is undefined and the grid cannot be read.');
  else {
    cell = GRID[quality][cost];
    if (quality === 'equivalent' && cost === 'cheaper' && gain50) cell = 'continue';
    outcome = cell;
    if (cell === 'continue' && sharing === 'failed') {
      outcome = null;
      notes.push('The grid gives Continue, but the sharing check failed. ADR-016 §6 makes Continue depend on it and names no fallback: the owner decides.');
    } else if (cell === 'continue' && sharing === 'not-checked')
      notes.push('Continue also requires the sharing check (ADR-016 §6), which is not recorded yet.');
  }
  const complete = missing.length === 0 && extra.length === 0 && prefer.missing === 0;
  if (missing.length) notes.push(`${missing.length} of ${FORMATS.length * SUBJECTS.length * RUNS_PER_CELL} runs are missing: the reading is provisional.`);
  if (extra.length) notes.push(`Runs beyond ${RUNS_PER_CELL} per subject and format: ${extra.join(', ')}.`);
  if (prefer.missing) notes.push(`The owner's preference is missing for ${prefer.missing} subjects: the quality axis is provisional.`);

  const perUsable = (side, key) => (side.usable ? side[key] / side.usable : null);
  return {
    complete,
    missing,
    formats: {
      'html-slides': { ...html, millisecondsPerUsable: perUsable(html, 'milliseconds'), tokensPerUsable: perUsable(html, 'tokens') },
      pptx: { ...pptx, millisecondsPerUsable: perUsable(pptx, 'milliseconds'), tokensPerUsable: perUsable(pptx, 'tokens') }
    },
    preferences: prefer,
    quality: { value: quality, reasons: qualityReasons },
    cost: { value: cost, deciding, gain50, time, tokens },
    sharing,
    cell: cell && OUTCOMES[cell],
    outcome: outcome && OUTCOMES[outcome],
    notes
  };
}

const pct = ratio => (ratio === null ? 'n/a' : ratio === Infinity ? 'no usable html-slides run' : `${(ratio * 100).toFixed(1)} %`);
const minutes = ms => (ms === null ? 'n/a' : `${(ms / 60000).toFixed(1)} min`);
const whole = value => (value === null ? 'n/a' : Math.round(value).toLocaleString('en-US'));

export function report(grid) {
  const h = grid.formats['html-slides'];
  const p = grid.formats.pptx;
  const lines = [
    '# Slides go/stop gate: reading of the grid (ADR-016 §6)',
    '',
    grid.complete ? 'All runs and preferences are recorded.' : '**Provisional reading: the data are incomplete (see the notes).**',
    '',
    '| | html-slides | PPTX |',
    '| --- | --- | --- |',
    `| Runs recorded | ${h.runs} | ${p.runs} |`,
    `| Usable runs | ${h.usable} | ${p.usable} |`,
    `| Blocking defects | ${h.blocking} | ${p.blocking} |`,
    `| Minor defects | ${h.minor} | ${p.minor} |`,
    `| Time, all runs | ${minutes(h.milliseconds)} | ${minutes(p.milliseconds)} |`,
    `| Time per usable result | ${minutes(h.millisecondsPerUsable)} | ${minutes(p.millisecondsPerUsable)} |`,
    `| Tokens, all runs | ${whole(h.tokens)} | ${whole(p.tokens)} |`,
    `| Tokens per usable result | ${whole(h.tokensPerUsable)} | ${whole(p.tokensPerUsable)} |`,
    `| Subjects the owner prefers | ${grid.preferences['html-slides']} | ${grid.preferences.pptx} |`,
    '',
    `Quality of html-slides against PPTX: **${grid.quality.value}** (${grid.quality.reasons.join('; ')}).`,
    '',
    grid.cost.value === null ? 'Cost: undefined.'
      : `Cost of html-slides against PPTX: **${grid.cost.value}**. Time per usable result is ${pct(grid.cost.time.ratio)} of PPTX's, tokens per usable result ${pct(grid.cost.tokens.ratio)}; the less favourable measure, ${grid.cost.deciding}, decides.${grid.cost.gain50 ? ' The gain reaches 50 % on both measures.' : ''}`,
    '',
    `Sharing check: ${grid.sharing}.`,
    '',
    `Grid cell: **${grid.cell ?? 'none'}**. Outcome: **${grid.outcome ?? 'not decided by the grid'}**.`
  ];
  if (grid.notes.length) lines.push('', 'Notes:', ...grid.notes.map(note => `- ${note}`));
  return lines.join('\n') + '\n';
}
