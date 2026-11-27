#!/usr/bin/env node
// The measurement bench of ADR-016 (Slides go/stop gate). A development tool: nothing here ships.
//   node tools/gate-bench/gate.mjs doctor        --runs <folder>
//   node tools/gate-bench/gate.mjs run           --runs <folder> --subject 3 --format pptx [--run 1]
//   node tools/gate-bench/gate.mjs pilot         --runs <folder> [--subject 3]
//   node tools/gate-bench/gate.mjs campaign      --runs <folder> [--seed 1234]
//   node tools/gate-bench/gate.mjs count         --runs <folder> [--effort high] [--seed 1234]
//   node tools/gate-bench/gate.mjs sample        --runs <folder> [--pages 20] [--seed 1234]
//   node tools/gate-bench/gate.mjs sample-compare --runs <folder>
//   node tools/gate-bench/gate.mjs grid          --runs <folder> [--judgement judgement.json]
// <folder> holds everything a campaign produces. It must be outside any Git repository, so that a
// session finds no project around it. See docs/gate/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, listBriefs, loadBrief } from './lib/briefs.mjs';
import { FORMATS, MODEL, EFFORT, runSession, stagePlugin, generationPrompt, editPrompt, claudeStatus, skillSource, sessionEnv } from './lib/session.mjs';
import * as pptx from './lib/pptx.mjs';
import * as html from './lib/html.mjs';
import { render, renderingTools } from './lib/render.mjs';
import { anonymise, prepareDeck, countDeck, codexVersion, random, shuffle, newSeed, CODES, COUNTER } from './lib/count.mjs';
import { computeGrid, report, RUNS_PER_CELL } from './lib/grid.mjs';

const args = (argv => { const out = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else out._.push(a); } return out; })(process.argv.slice(2));
const command = args._[0];
const die = message => { console.error(`Error: ${message}`); process.exit(1); };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const git = (...list) => { const r = spawnSync('git', list, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const mover = format => (format === 'pptx' ? pptx : html);

function runsFolder() {
  if (!args.runs || args.runs === true) die('--runs <folder> is required');
  const runs = path.resolve(args.runs);
  fs.mkdirSync(runs, { recursive: true });
  const inside = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: runs, encoding: 'utf8' });
  if (inside.status === 0) die(`${runs} is inside the Git repository ${inside.stdout.trim()}: a session would find that project. Choose a folder outside any repository.`);
  return fs.realpathSync(runs);
}
const runFolder = (runs, subject, format, run) => path.join(runs, `subject-${subject}`, format, `run-${run}`);

// ---------- the environment each session needs ----------
// The bench installs nothing. It links the Playwright that the repository already has, so that the
// html-slides tools find it from a staged copy of the skill, and reports what the PowerPoint skill
// lists as preinstalled.
function environment(runs) {
  const modules = path.join(runs, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  for (const name of ['playwright', 'playwright-core']) {
    const link = path.join(modules, name), target = path.join(ROOT, 'node_modules', name);
    if (!fs.existsSync(link) && fs.existsSync(target)) fs.symlinkSync(target, link);
  }
  const env = sessionEnv(runs);
  const has = (command, list) => spawnSync(command, list, { env, encoding: 'utf8', cwd: runs }).status === 0;
  const python = ['python', 'python3'].find(name => has(name, ['-c', 'import pptx, PIL, lxml, defusedxml'])) ?? null;
  let playwright = null;
  try { playwright = readJson(path.join(modules, 'playwright/package.json')).version; } catch { /* not linked */ }
  return {
    htmlSlides: { node: process.version, playwright, required: '1.62.1' },
    pptx: { pptxgenjs: has('node', ['-e', 'require("pptxgenjs")']), pythonWithLibraries: python, soffice: has('which', ['soffice']), pdftoppm: has('which', ['pdftoppm']) },
    rendering: renderingTools(), claude: claudeStatus(runs), codex: codexVersion()
  };
}
function requireEnvironment(runs, formats) {
  const env = environment(runs);
  const problems = [];
  if (!env.claude.version) problems.push('the claude command was not found');
  else if (!env.claude.loggedIn) problems.push('the claude command is not logged in (run `claude`, then /login)');
  if (formats.includes('html-slides') && env.htmlSlides.playwright !== env.htmlSlides.required) problems.push(`Playwright ${env.htmlSlides.required} is not installed in this repository (npm ci)`);
  if (formats.includes('pptx')) {
    const p = env.pptx;
    const absent = [!p.pptxgenjs && 'pptxgenjs', !p.pythonWithLibraries && 'a python with python-pptx, Pillow, lxml and defusedxml', !p.soffice && 'soffice', !p.pdftoppm && 'pdftoppm'].filter(Boolean);
    if (absent.length) problems.push(`the PowerPoint skill lists as preinstalled, and the sessions would not find: ${absent.join('; ')} (docs/gate/README.md, "Before the first run")`);
    if (!env.rendering.powerpoint) problems.push('Microsoft PowerPoint is not installed: the bench converts .pptx to PDF with it');
  }
  if (problems.length && !args.force) die(problems.join('\n       ') + '\n       (--force starts anyway, and records the environment as it is)');
  return env;
}

// ---------- the format's own check, for information ----------
function formatCheck(format, file, runs) {
  if (!fs.existsSync(file)) return { ran: false, passed: false, note: 'no file' };
  if (format === 'html-slides') {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), file], { encoding: 'utf8', timeout: 180000 });
    return { ran: true, passed: r.status === 0, tool: 'check.mjs', output: (r.stdout + r.stderr).trim().slice(-600) };
  }
  const env = sessionEnv(runs);
  const validator = path.join(skillSource('pptx').dir, 'scripts/office/validate.py');
  for (const python of ['python', 'python3']) {
    if (spawnSync(python, ['-c', 'import lxml, defusedxml'], { env }).status !== 0) continue;
    const r = spawnSync(python, [validator, file], { env, encoding: 'utf8', timeout: 180000 });
    return { ran: true, passed: r.status === 0, tool: 'validate.py', output: (r.stdout + r.stderr).trim().slice(-600) };
  }
  return { ran: false, passed: null, note: 'no python with lxml and defusedxml: validate.py was not run' };
}

const sessionRecord = session => { const { session: seen, ...rest } = session; return { ...rest, model: seen?.model ?? null, claudeCode: seen?.claudeCode ?? null, skillsOffered: seen?.skills ?? null, tools: seen?.tools ?? null, plugins: seen?.plugins ?? null, mcpServers: seen?.mcpServers ?? null }; };

// ---------- one run: generation, scripted move, three edits, rendering ----------
async function oneRun(runs, subject, format, run) {
  const brief = loadBrief(subject);
  const folder = runFolder(runs, subject, format, run);
  const recordFile = path.join(folder, 'record.json');
  if (fs.existsSync(recordFile) && !args.redo) { console.log(`subject ${subject}, ${format}, run ${run}: already recorded (--redo to run it again)`); return readJson(recordFile); }
  fs.rmSync(folder, { recursive: true, force: true });
  const f = FORMATS[format];
  const say = message => console.log(`[${new Date().toISOString().slice(11, 19)}] subject ${subject}, ${format}, run ${run}: ${message}`);
  const record = { schema: 1, subject, format, run, startedAt: new Date().toISOString(), requested: { model: MODEL, effort: EFFORT },
    bench: { commit: git('rev-parse', 'HEAD'), uncommittedChanges: !!git('status', '--porcelain', '--', 'tools/gate-bench', 'docs/gate') },
    machine: { platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30) } };

  // 1. Generation, in a new session.
  record.skill = stagePlugin(format, path.join(folder, 'plugin-gen'));
  say('generation');
  const generation = await runSession({ cwd: path.join(folder, 'gen'), prompt: generationPrompt(format, brief), plugin: path.join(folder, 'plugin-gen'), runs, log: path.join(folder, 'gen.log.jsonl'), timeoutMinutes: Number(args['generation-minutes'] ?? 60) });
  const generated = path.join(folder, 'gen', f.file);
  record.generation = { ...sessionRecord(generation), fileProduced: fs.existsSync(generated), formatCheck: formatCheck(format, generated, runs) };
  say(`generation ${generation.completed ? 'ended' : 'did not complete'} after ${(generation.wallMs / 60000).toFixed(1)} min, ${generation.tokens.total.toLocaleString('en-US')} tokens`);

  // 2. The scripted move, on a copy.
  let source = generated;
  if (record.generation.fileProduced) {
    const moved = path.join(folder, 'moved', f.file);
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    try {
      record.move = await mover(format).moveDeck(generated, moved, brief.move);
      source = moved;
      say(`move applied to ${record.move.targets.filter(t => t.resolved).length} of ${record.move.targets.length} targets`);
    } catch (error) { record.move = { error: error.message, targets: [] }; say(`move failed: ${error.message}`); }
  }

  // 3. The three edits, in another new session that is given the file and nothing else.
  if (record.generation.fileProduced) {
    stagePlugin(format, path.join(folder, 'plugin-edit'));
    fs.mkdirSync(path.join(folder, 'edit'), { recursive: true });
    fs.copyFileSync(source, path.join(folder, 'edit', f.file));
    say('edits');
    const edits = await runSession({ cwd: path.join(folder, 'edit'), prompt: editPrompt(format, brief), plugin: path.join(folder, 'plugin-edit'), runs, log: path.join(folder, 'edit.log.jsonl'), timeoutMinutes: Number(args['edit-minutes'] ?? 45) });
    const edited = path.join(folder, 'edit', f.file);
    record.edits = { ...sessionRecord(edits), fileProduced: fs.existsSync(edited), formatCheck: formatCheck(format, edited, runs) };
    say(`edits ${edits.completed ? 'ended' : 'did not complete'} after ${(edits.wallMs / 60000).toFixed(1)} min, ${edits.tokens.total.toLocaleString('en-US')} tokens`);

    // 4. Did the moved elements keep their place? 5. Rendering to page images.
    if (record.edits.fileProduced) {
      if (record.move?.targets?.some(t => t.resolved)) {
        try { record.movesKept = await mover(format).checkMoves(edited, record.move); }
        catch (error) { record.movesKept = { kept: false, error: error.message, applied: 0, notApplied: 0, targets: [] }; }
      } else record.movesKept = { kept: null, applied: 0, notApplied: brief.move.targets.length, targets: [] };
      const rendered = render(format, edited, path.join(folder, 'render'));
      record.render = { opens: rendered.opens, pages: rendered.pages.length, error: rendered.error ?? null };
      if (source !== generated) { const evidence = render(format, source, path.join(folder, 'moved/render')); record.move.renderedPages = evidence.pages.length; }
      say(`moves kept: ${record.movesKept.kept}; rendering: ${rendered.opens ? rendered.pages.length + ' pages' : 'does not open (' + rendered.error + ')'}`);
    }
  }
  record.render ??= { opens: false, pages: 0, error: 'no final file' };
  record.movesKept ??= { kept: false, applied: 0, notApplied: 0, targets: [], error: 'no final file' };
  // Every session is charged, whatever became of the run (ADR-016 §6).
  record.totals = { milliseconds: generation.wallMs + (record.edits?.wallMs ?? 0), tokens: generation.tokens.total + (record.edits?.tokens.total ?? 0), costUsd: generation.costUsd + (record.edits?.costUsd ?? 0) };
  record.endedAt = new Date().toISOString();
  writeJson(recordFile, record);
  return record;
}

const records = runs => listBriefs().flatMap(({ subject }) => Object.keys(FORMATS).flatMap(format => {
  const base = path.join(runs, `subject-${subject}`, format);
  return (fs.existsSync(base) ? fs.readdirSync(base) : []).filter(name => /^run-\d+$/.test(name)).map(name => path.join(base, name, 'record.json')).filter(file => fs.existsSync(file)).map(readJson);
}));

// ---------- the count ----------
const keyOf = record => `${record.subject}/${record.format}/${record.run}`;
function count(runs) {
  const keyFile = path.join(runs, 'count-key.json');
  const key = fs.existsSync(keyFile) ? readJson(keyFile) : { seed: Number(args.seed ?? newSeed()), decks: {} };
  const todo = records(runs).filter(record => record.render.opens && !Object.values(key.decks).includes(keyOf(record)));
  const pagesOf = record => { const dir = path.join(runFolder(runs, record.subject, record.format, record.run), 'render/pages'); return fs.readdirSync(dir).filter(n => n.endsWith('.png')).sort().map(n => path.join(dir, n)); };
  const taken = new Set(Object.keys(key.decks));
  for (const item of anonymise(todo.map(record => ({ record })), key.seed + taken.size)) {
    let code = item.code; while (taken.has(code)) code += 'x';
    taken.add(code);
    prepareDeck(path.join(runs, 'count', code), pagesOf(item.record), loadBrief(item.record.subject));
    key.decks[code] = keyOf(item.record);
  }
  writeJson(keyFile, key);
  const countsFile = path.join(runs, 'counts.json');
  const counts = fs.existsSync(countsFile) ? readJson(countsFile) : {};
  for (const code of Object.keys(key.decks).sort()) {
    if (counts[code]?.ok && !args.redo) continue;
    console.log(`[${new Date().toISOString().slice(11, 19)}] counting ${code}`);
    counts[code] = { countedAt: new Date().toISOString(), codex: codexVersion(), ...countDeck(path.join(runs, 'count', code), { effort: args.effort && args.effort !== true ? args.effort : COUNTER.effort }) };
    writeJson(countsFile, counts);
    console.log(counts[code].ok ? `  ${counts[code].blocking} blocking, ${counts[code].minor} minor, ${(counts[code].wallMs / 60000).toFixed(1)} min` : `  failed: ${counts[code].error}`);
  }
  return { key, counts };
}

// ---------- the results file and the grid ----------
function results(runs) {
  const key = fs.existsSync(path.join(runs, 'count-key.json')) ? readJson(path.join(runs, 'count-key.json')) : { decks: {} };
  const counts = fs.existsSync(path.join(runs, 'counts.json')) ? readJson(path.join(runs, 'counts.json')) : {};
  const codeOf = Object.fromEntries(Object.entries(key.decks).map(([code, k]) => [k, code]));
  const problems = [];
  const rows = records(runs).map(record => {
    const counted = counts[codeOf[keyOf(record)]];
    if (record.render.opens && !counted?.ok) problems.push(`${keyOf(record)}: opens but has no usable count yet`);
    if (record.movesKept.kept === null) problems.push(`${keyOf(record)}: the scripted move could not be applied; a person has to decide what this run shows`);
    return { subject: record.subject, format: record.format, run: record.run, opens: record.render.opens, blocking: record.render.opens ? counted?.blocking ?? null : null,
      minor: record.render.opens ? counted?.minor ?? null : null, movesKept: record.movesKept.kept, milliseconds: record.totals.milliseconds, tokens: record.totals.tokens,
      generationMs: record.generation.wallMs, editsMs: record.edits?.wallMs ?? null, costUsd: record.totals.costUsd, pages: record.render.pages,
      movesApplied: record.movesKept.applied, movesNotApplied: record.movesKept.notApplied,
      formatCheckAfterGeneration: record.generation.formatCheck.passed, formatCheckAfterEdits: record.edits?.formatCheck.passed ?? null, skill: record.skill };
  });
  return { rows, problems };
}

function grid(runs) {
  const { rows, problems } = results(runs);
  writeJson(path.join(runs, 'results.json'), { generatedAt: new Date().toISOString(), runs: rows, problems });
  if (problems.length) { console.log('The grid is not computed yet:\n' + problems.map(p => `- ${p}`).join('\n')); return null; }
  const judgement = args.judgement && args.judgement !== true ? readJson(path.resolve(args.judgement)) : fs.existsSync(path.join(runs, 'judgement.json')) ? readJson(path.join(runs, 'judgement.json')) : {};
  const result = computeGrid({ runs: rows.map(({ subject, format, run, opens, blocking, minor, movesKept, milliseconds, tokens }) => ({ subject, format, run, opens, blocking, minor, movesKept, milliseconds, tokens })),
    preferences: judgement.preferences ?? {}, sharing: judgement.sharing ?? 'not-checked' });
  writeJson(path.join(runs, 'grid.json'), result);
  fs.writeFileSync(path.join(runs, 'grid.md'), report(result));
  console.log(report(result));
  return result;
}

// ---------- the owner's sample ----------
function sample(runs) {
  const key = readJson(path.join(runs, 'count-key.json'));
  const counts = readJson(path.join(runs, 'counts.json'));
  const seed = Number(args.seed ?? newSeed());
  const pool = Object.keys(key.decks).filter(code => counts[code]?.ok).sort().flatMap(code => counts[code].pages.map(page => ({ code, page: page.page })));
  const drawn = shuffle(pool, random(seed)).slice(0, Number(args.pages ?? 20));
  const folder = path.join(runs, 'sample');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const subjects = new Set();
  const lines = [['image', 'expected content', 'page of that deck', ...Object.keys(CODES)].join(',')];
  const answer = {};
  drawn.forEach((item, index) => {
    const name = `sample-${String(index + 1).padStart(2, '0')}.png`;
    const subject = Number(key.decks[item.code].split('/')[0]);
    fs.copyFileSync(path.join(runs, 'count', item.code, `page-${String(item.page).padStart(2, '0')}.png`), path.join(folder, name));
    if (!subjects.has(subject)) { subjects.add(subject); fs.copyFileSync(path.join(runs, 'count', item.code, 'expected.md'), path.join(folder, `expected-subject-${subject}.md`)); }
    lines.push([name, `expected-subject-${subject}.md`, item.page, ...Object.keys(CODES).map(() => '')].join(','));
    answer[name] = { code: item.code, page: item.page };
  });
  fs.writeFileSync(path.join(folder, 'FORM.csv'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(folder, 'README.md'), `# Sample of the defect count\n\n${drawn.length} page images drawn at random (seed ${seed}) from ${pool.length} counted pages.\n\nFor each image, open the expected content named on its line of \`FORM.csv\`, count the defects with [docs/gate/DEFECTS.md](${path.join(ROOT, 'docs/gate/DEFECTS.md')}), and write the number of defects of each code on the line (leave a cell empty for none). A defect that concerns the deck as a whole (a missing slide) cannot be judged on one page: leave it out. Then run \`node tools/gate-bench/gate.mjs sample-compare --runs <folder>\`.\n`);
  writeJson(path.join(runs, 'sample-key.json'), { seed, drawn: answer });
  console.log(`${drawn.length} pages written to ${folder}`);
}

function sampleCompare(runs) {
  const key = readJson(path.join(runs, 'sample-key.json')).drawn;
  const counts = readJson(path.join(runs, 'counts.json'));
  const [header, ...rows] = fs.readFileSync(path.join(runs, 'sample/FORM.csv'), 'utf8').trim().split('\n').map(line => line.split(','));
  const codes = Object.keys(CODES);
  const totals = Object.fromEntries(codes.map(code => [code, { owner: 0, counter: 0 }]));
  const differing = [];
  for (const row of rows) {
    const where = key[row[0]];
    if (!where) die(`FORM.csv names ${row[0]}, which is not in the sample`);
    const counter = counts[where.code].pages[where.page - 1].codes;
    const diff = [];
    codes.forEach(code => {
      const owner = Number(row[header.indexOf(code)] || 0), other = counter[code] ?? 0;
      if (!Number.isInteger(owner) || owner < 0) die(`${row[0]}, ${code}: "${row[header.indexOf(code)]}" is not a count`);
      totals[code].owner += owner; totals[code].counter += other;
      if (owner !== other) diff.push(`${code} owner ${owner}, counter ${other}`);
    });
    if (diff.length) differing.push(`${row[0]}: ${diff.join('; ')}`);
  }
  console.log(['| Code | Class | Owner | Counter |', '| --- | --- | --- | --- |', ...codes.map(code => `| ${code} | ${CODES[code]} | ${totals[code].owner} | ${totals[code].counter} |`)].join('\n'));
  console.log(`\nPages where the two counts differ: ${differing.length} of ${rows.length}\n${differing.map(line => `- ${line}`).join('\n')}`);
}

// ---------- commands ----------
if (command === 'doctor') {
  const runs = runsFolder();
  console.log(JSON.stringify({ runs, bench: { commit: git('rev-parse', 'HEAD') }, requested: { model: MODEL, effort: EFFORT },
    skills: Object.fromEntries(Object.keys(FORMATS).map(format => { try { return [format, skillSource(format).provenance]; } catch (error) { return [format, { error: error.message }]; } })), environment: environment(runs) }, null, 2));
} else if (command === 'run') {
  const runs = runsFolder();
  if (!FORMATS[args.format]) die('--format html-slides or pptx');
  requireEnvironment(runs, [args.format]);
  await oneRun(runs, Number(args.subject), args.format, Number(args.run ?? 1));
} else if (command === 'pilot') {
  const runs = runsFolder();
  const subject = Number(args.subject ?? 3);
  writeJson(path.join(runs, 'environment.json'), requireEnvironment(runs, Object.keys(FORMATS)));
  for (const format of Object.keys(FORMATS)) await oneRun(runs, subject, format, 1);
  count(runs);
  grid(runs);
} else if (command === 'campaign') {
  const runs = runsFolder();
  writeJson(path.join(runs, 'environment.json'), requireEnvironment(runs, Object.keys(FORMATS)));
  // Sessions run one after the other, in a shuffled order, so that neither format always runs
  // first or at the same hour. The order is recorded, and kept when the campaign is resumed.
  const orderFile = path.join(runs, 'campaign-order.json');
  const seed = fs.existsSync(orderFile) ? readJson(orderFile).seed : Number(args.seed ?? newSeed());
  const order = shuffle(listBriefs().flatMap(({ subject }) => Object.keys(FORMATS).flatMap(format => Array.from({ length: RUNS_PER_CELL }, (_, i) => ({ subject, format, run: i + 1 })))), random(seed));
  writeJson(orderFile, { seed, order });
  for (const item of order) await oneRun(runs, item.subject, item.format, item.run);
  console.log('Generations and edits are done. Next: gate.mjs count, then gate.mjs sample, then gate.mjs grid.');
} else if (command === 'count') { count(runsFolder()); }
else if (command === 'sample') { sample(runsFolder()); }
else if (command === 'sample-compare') { sampleCompare(runsFolder()); }
else if (command === 'grid') { grid(runsFolder()); }
else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(command ? 1 : 0);
}
