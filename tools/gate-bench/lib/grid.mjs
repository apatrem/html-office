// The decision grid of ADR-016 §6, computed from recorded runs. Nothing here measures anything:
// the function applies the written rules, with exact integer arithmetic so that a value sitting on
// a threshold (0.50, 0.75, 0.80, 1.20, 1.25) falls on the side the ADR names.
//
//   D = minor defects per usable result, html-slides / PPTX
//   R = the larger of two ratios html-slides / PPTX: time per usable result, tokens per usable result
//
// Void runs (cut off by a cause outside the format) are not given to this function: they enter no
// total and are run again.

export const FORMATS = ['html-slides', 'pptx'];
export const SUBJECTS = [1, 2, 3, 4, 5];
export const RUNS_PER_CELL = 3;

export const OUTCOMES = {
  continue: 'Continue',
  pending: 'Continue (pending the sharing check)',
  maintain: 'Maintain Slides alone',
  stop: 'Stop'
};
export const SHARING = ['not-checked', 'passed', 'failed-once', 'failed-twice'];
const PREFERENCES = ['html-slides', 'pptx', 'equivalent'];

const GRID = {
  better: { cheaper: 'continue', comparable: 'continue', dearer: 'maintain' },
  // Cheaper and equivalent: "Maintain Slides alone; Continue if R ≤ 0.50".
  equivalent: { cheaper: 'maintain', comparable: 'stop', dearer: 'stop' },
  worse: { cheaper: 'stop', comparable: 'stop', dearer: 'stop' }
};

const isCount = value => Number.isInteger(value) && value >= 0;

// A run is usable when the generation and the three edits both finished, and the final file opens,
// passes its format's own checks, has no blocking defect and kept the scripted moves after the edits.
export function usable(run) {
  return run.generationFinished === true && run.editsFinished === true && run.opens === true && run.checksPassed === true
    && run.blocking === 0 && run.movesKept === true;
}

function validate(run, index) {
  const where = `run ${index + 1} (${run.format ?? '?'}, subject ${run.subject ?? '?'}, run ${run.run ?? '?'})`;
  if (!FORMATS.includes(run.format)) throw new Error(`${where}: unknown format`);
  if (!SUBJECTS.includes(run.subject)) throw new Error(`${where}: unknown subject`);
  if (!Number.isInteger(run.run) || run.run < 1) throw new Error(`${where}: run number`);
  for (const key of ['generationFinished', 'editsFinished', 'opens', 'checksPassed', 'movesKept'])
    if (typeof run[key] !== 'boolean') throw new Error(`${where}: ${key} must be true or false`);
  if (run.editsFinished && !run.generationFinished) throw new Error(`${where}: edits cannot finish after a generation that did not`);
  if (run.opens) {
    if (!isCount(run.blocking) || !isCount(run.minor)) throw new Error(`${where}: a final file that opens needs its defect counts`);
  } else if (run.blocking != null || run.minor != null) throw new Error(`${where}: a run without a final file that opens has no defect count`);
  if (!isCount(run.milliseconds)) throw new Error(`${where}: milliseconds must be a whole number`);
  if (!isCount(run.tokens)) throw new Error(`${where}: tokens must be a whole number`);
}

function totals(runs, format) {
  const own = runs.filter(run => run.format === format);
  const good = own.filter(usable);
  // Sums are exact whatever their size: each recorded value is a safe integer, a total need not be.
  const sum = (list, key) => list.reduce((total, run) => total + BigInt(run[key] ?? 0), 0n);
  return {
    runs: own.length,
    usable: good.length,
    finalFiles: own.filter(run => run.opens).length,
    blocking: sum(own, 'blocking'),
    minorOfUsable: sum(good, 'minor'),
    // Failed runs included, generation plus edits.
    milliseconds: sum(own, 'milliseconds'),
    tokens: sum(own, 'tokens')
  };
}

// The ratio html-slides / PPTX of (total / usable runs), kept as two integers.
const ratio = (html, pptx, key) => ({ left: html[key] * BigInt(pptx.usable), right: pptx[key] * BigInt(html.usable) });
const atMost = (r, num, den) => BigInt(den) * r.left <= BigInt(num) * r.right;   // ratio ≤ num/den
const atLeast = (r, num, den) => BigInt(den) * r.left >= BigInt(num) * r.right;  // ratio ≥ num/den
const value = r => (r.right === 0n ? null : Number(r.left) / Number(r.right));

export function computeGrid({ runs = [], preferences = {}, sharing = 'not-checked' } = {}) {
  runs.forEach(validate);
  const seen = new Set();
  for (const run of runs) {
    const key = `${run.format}/${run.subject}/${run.run}`;
    if (seen.has(key)) throw new Error(`duplicate run ${key}`);
    seen.add(key);
  }
  if (!SHARING.includes(sharing)) throw new Error(`sharing must be one of ${SHARING.join(', ')}`);

  const missing = [];
  for (const format of FORMATS) for (const subject of SUBJECTS) for (let run = 1; run <= RUNS_PER_CELL; run++)
    if (!seen.has(`${format}/${subject}/${run}`)) missing.push(`${format}/${subject}/${run}`);
  const extra = runs.filter(run => run.run > RUNS_PER_CELL).map(run => `${run.format}/${run.subject}/${run.run}`);

  const html = totals(runs, 'html-slides');
  const pptx = totals(runs, 'pptx');
  for (const [name, side] of [['html-slides', html], ['PPTX', pptx]])
    if (side.usable && (side.milliseconds === 0n || side.tokens === 0n)) throw new Error(`${name} has usable runs and no recorded time or tokens`);
  const notes = [];

  // ---- the owner's preference, one per subject ----
  const prefer = { 'html-slides': 0, pptx: 0, equivalent: 0, missing: 0 };
  for (const subject of SUBJECTS) {
    const given = preferences[subject] ?? preferences[String(subject)] ?? null;
    if (given !== null && !PREFERENCES.includes(given)) throw new Error(`preference for subject ${subject} must be html-slides, pptx or equivalent`);
    const recorded = runs.filter(run => run.subject === subject);
    const complete = recorded.length === FORMATS.length * RUNS_PER_CELL;
    // "If neither format produced a final PDF for a subject, the preference is equivalent."
    if (complete && !recorded.some(run => run.opens)) {
      if (given !== null && given !== 'equivalent') throw new Error(`subject ${subject}: neither format produced a final PDF, so the preference is equivalent`);
      prefer.equivalent++;
    } else if (given === null) prefer.missing++;
    else prefer[given]++;
  }

  // ---- first axis: quality ----
  const reasons = [];
  let quality;
  let d = null;
  if (pptx.usable === 0 && html.usable > 0) {
    quality = 'better';
    reasons.push('PPTX has no usable run and html-slides has at least one');
  } else if (html.usable === 0) {
    quality = html.usable < pptx.usable ? 'worse' : null;
    reasons.push(quality ? `fewer usable runs (0 against ${pptx.usable})` : 'neither format has a usable run');
  } else {
    // D compares minor defects per usable result; it does not exist when PPTX has none.
    const dRatio = ratio(html, pptx, 'minorOfUsable');
    const hasD = pptx.minorOfUsable > 0n;
    d = hasD ? value(dRatio) : null;
    const fewerMinor = hasD && atMost(dRatio, 3, 4);                                  // D ≤ 0.75
    const moreMinor = hasD ? atLeast(dRatio, 5, 4) : html.minorOfUsable > 0n;          // D ≥ 1.25, or any against none
    if (html.usable < pptx.usable) reasons.push(`fewer usable runs (${html.usable} against ${pptx.usable})`);
    if (moreMinor) reasons.push(hasD ? `D ≥ 1.25 (${d.toFixed(3)})` : 'html-slides has minor defects and PPTX has none');
    if (prefer.pptx >= 3) reasons.push(`the owner prefers PPTX on ${prefer.pptx} subjects`);
    if (reasons.length) quality = 'worse';
    else if (fewerMinor && prefer.pptx <= prefer['html-slides']) {
      quality = 'better';
      reasons.push(`at least as many usable runs (${html.usable} against ${pptx.usable})`, `D ≤ 0.75 (${d.toFixed(3)})`,
        `the owner prefers PPTX on ${prefer.pptx} subjects and html-slides on ${prefer['html-slides']}`);
    } else {
      quality = 'equivalent';
      reasons.push('neither the conditions of better nor those of worse are met');
    }
  }

  // ---- second axis: cost ----
  let cost = null;
  let gain50 = false;
  let time = null;
  let tokens = null;
  let r = null;
  if (pptx.usable === 0 && html.usable > 0) cost = 'cheaper';
  else if (html.usable > 0) {
    const t = ratio(html, pptx, 'milliseconds'), k = ratio(html, pptx, 'tokens');
    time = value(t); tokens = value(k); r = Math.max(time, tokens);
    // R is the larger ratio: R ≤ x needs both, R ≥ x needs one.
    if (atMost(t, 4, 5) && atMost(k, 4, 5)) cost = 'cheaper';
    else if (atLeast(t, 6, 5) || atLeast(k, 6, 5)) cost = 'dearer';
    else cost = 'comparable';
    gain50 = atMost(t, 1, 2) && atMost(k, 1, 2);
  }

  // ---- the grid, then the sharing rule ----
  let cell;
  if (html.usable === 0) { cell = 'stop'; notes.push('html-slides has no usable run: Stop (ADR-016 §6).'); }
  else {
    cell = GRID[quality][cost];
    if (quality === 'equivalent' && cost === 'cheaper' && gain50) cell = 'continue';
    if (pptx.usable === 0) notes.push('PPTX has no usable run: quality is better and cost is cheaper (ADR-016 §6).');
  }
  let outcome = cell;
  if (cell === 'continue') {
    if (sharing === 'not-checked') { outcome = 'pending'; notes.push('Continue also requires the sharing check, which is not done yet.'); }
    else if (sharing === 'failed-once') { outcome = 'pending'; notes.push('The sharing check failed once: what blocked is fixed and the owner repeats the check once.'); }
    else if (sharing === 'failed-twice') { outcome = 'maintain'; notes.push('The sharing check failed twice: Continue becomes Maintain Slides alone.'); }
  }
  const complete = missing.length === 0 && extra.length === 0 && prefer.missing === 0;
  if (missing.length) notes.push(`${missing.length} of ${FORMATS.length * SUBJECTS.length * RUNS_PER_CELL} runs are missing: the reading is provisional.`);
  if (extra.length) notes.push(`Runs beyond ${RUNS_PER_CELL} per subject and format: ${extra.join(', ')}.`);
  if (prefer.missing) notes.push(`The owner's preference is missing for ${prefer.missing} subjects: the quality axis is provisional.`);

  const per = (side, key) => (side.usable ? Number(side[key]) / side.usable : null);
  const plain = side => Object.fromEntries(Object.entries(side).map(([key, v]) => [key, typeof v === 'bigint' ? Number(v) : v]));
  const shape = side => ({ ...plain(side), minorPerUsable: per(side, 'minorOfUsable'), millisecondsPerUsable: per(side, 'milliseconds'), tokensPerUsable: per(side, 'tokens') });
  return {
    complete,
    missing,
    formats: { 'html-slides': shape(html), pptx: shape(pptx) },
    preferences: prefer,
    quality: { value: quality, d, reasons },
    cost: { value: cost, r, time, tokens, gain50 },
    sharing,
    cell: OUTCOMES[cell],
    outcome: OUTCOMES[outcome],
    notes
  };
}

const pct = v => (v === null ? 'n/a' : v.toFixed(3));
const minutes = ms => (ms === null ? 'n/a' : `${(ms / 60000).toFixed(1)} min`);
const whole = v => (v === null ? 'n/a' : Math.round(v).toLocaleString('en-US'));
const decimal = v => (v === null ? 'n/a' : v.toFixed(2));

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
    `| Runs with a final file that opens | ${h.finalFiles} | ${p.finalFiles} |`,
    `| Blocking defects, all counted runs | ${h.blocking} | ${p.blocking} |`,
    `| Minor defects of the usable runs | ${h.minorOfUsable} | ${p.minorOfUsable} |`,
    `| Minor defects per usable result | ${decimal(h.minorPerUsable)} | ${decimal(p.minorPerUsable)} |`,
    `| Time, all runs | ${minutes(h.milliseconds)} | ${minutes(p.milliseconds)} |`,
    `| Time per usable result | ${minutes(h.millisecondsPerUsable)} | ${minutes(p.millisecondsPerUsable)} |`,
    `| Tokens, all runs | ${whole(h.tokens)} | ${whole(p.tokens)} |`,
    `| Tokens per usable result | ${whole(h.tokensPerUsable)} | ${whole(p.tokensPerUsable)} |`,
    `| Subjects the owner prefers | ${grid.preferences['html-slides']} | ${grid.preferences.pptx} |`,
    '',
    `Quality of html-slides against PPTX: **${grid.quality.value ?? 'not read'}** (${grid.quality.reasons.join('; ')}). D = ${pct(grid.quality.d)}; better needs D ≤ 0.75, worse is D ≥ 1.25.`,
    '',
    grid.cost.value === null ? 'Cost: not read (html-slides has no usable run).'
      : `Cost of html-slides against PPTX: **${grid.cost.value}**. Time ratio ${pct(grid.cost.time)}, token ratio ${pct(grid.cost.tokens)}, R = ${pct(grid.cost.r)}; cheaper is R ≤ 0.80, dearer is R ≥ 1.20, the 50 % gain is R ≤ 0.50.`,
    '',
    `Sharing check: ${grid.sharing}.`,
    '',
    `Grid cell: **${grid.cell}**. Outcome: **${grid.outcome}**.`
  ];
  if (grid.notes.length) lines.push('', 'Notes:', ...grid.notes.map(note => `- ${note}`));
  return lines.join('\n') + '\n';
}
