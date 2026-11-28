// The defect count (ADR-016 §5): a model of the other family (Codex CLI, read-only) counts the
// defects of docs/gate/DEFECTS.md on page images. It is given a folder that holds the pages of one
// result under a random name, and the expected content; neither names the format.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, expectedContent } from './briefs.mjs';

export const COUNTER = { model: 'gpt-6.1-sol', effort: 'high' };
export const CODES = { B1: 'blocking', B2: 'blocking', B3: 'blocking', B4: 'blocking', B5: 'blocking', M1: 'minor', M2: 'minor', M3: 'minor', M4: 'minor' };
const DEFECTS = path.join(ROOT, 'docs/gate/DEFECTS.md');

// A small seeded generator (mulberry32): the shuffles and draws can be replayed from their seed.
export function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const section = (text, heading) => {
  const start = text.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error(`DEFECTS.md has no section "${heading}"`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next).trim();
};

export function counterPrompt(pages) {
  const text = fs.readFileSync(DEFECTS, 'utf8');
  const quoted = section(text, 'Instructions given to the counter').split('\n').filter(line => line.startsWith('>')).map(line => line.replace(/^> ?/, '')).join('\n');
  if (!quoted.includes('{pages}')) throw new Error('DEFECTS.md: the counter\'s instructions must name {pages}');
  return [quoted.replaceAll('{pages}', String(pages)), section(text, 'Codes'), section(text, 'Counting rules')].join('\n\n');
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pages', 'page_count_expected', 'page_count_seen'],
  properties: {
    page_count_expected: { type: 'integer' }, page_count_seen: { type: 'integer' },
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'defects'], properties: {
      page: { type: 'integer' },
      defects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'element', 'seen'], properties: {
        code: { type: 'string', enum: Object.keys(CODES) }, element: { type: 'string' }, seen: { type: 'string' } } } }
    } } }
  }
};

// Checks a counter's answer and totals it. Throws when the answer cannot be used as it is.
export function tally(answer, pageCount) {
  if (!answer || !Array.isArray(answer.pages)) throw new Error('the answer has no list of pages');
  const perPage = Array.from({ length: pageCount }, (_, index) => ({ page: index + 1, blocking: 0, minor: 0, codes: {}, defects: [], repeated: 0 }));
  const seen = new Set();
  const words = text => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const entry of answer.pages) {
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > pageCount) throw new Error(`the answer names page ${entry.page}, outside 1 to ${pageCount}`);
    if (seen.has(entry.page)) throw new Error(`the answer lists page ${entry.page} twice`);
    seen.add(entry.page);
    const counted = new Set();
    for (const defect of entry.defects ?? []) {
      if (!Object.hasOwn(CODES, defect.code)) throw new Error(`unknown defect code ${defect.code}`);
      const page = perPage[entry.page - 1];
      // One defect per element and per code (DEFECTS.md, counting rule 1): a repeated line is one defect.
      const same = `${defect.code}|${words(defect.element)}`;
      if (counted.has(same)) { page.repeated++; continue; }
      counted.add(same);
      page[CODES[defect.code]]++;
      page.codes[defect.code] = (page.codes[defect.code] ?? 0) + 1;
      page.defects.push({ code: defect.code, element: String(defect.element ?? ''), seen: String(defect.seen ?? '') });
    }
  }
  const missing = perPage.filter(page => !seen.has(page.page)).map(page => page.page);
  if (missing.length) throw new Error(`the answer says nothing about page ${missing.join(', ')}`);
  const sum = key => perPage.reduce((total, page) => total + page[key], 0);
  return { blocking: sum('blocking'), minor: sum('minor'), pages: perPage, pageCountExpected: answer.page_count_expected ?? null, pageCountSeen: answer.page_count_seen ?? null };
}

// Lays out the folder one counter sees: page-01.png …, expected.md, instructions.md.
export function prepareDeck(folder, pages, brief) {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const names = pages.map((page, index) => { const name = `page-${String(index + 1).padStart(2, '0')}.png`; fs.copyFileSync(page, path.join(folder, name)); return name; });
  fs.writeFileSync(path.join(folder, 'expected.md'), expectedContent(brief));
  fs.writeFileSync(path.join(folder, 'instructions.md'), counterPrompt(names.length) + '\n');
  return names;
}

// Random names for the results, in a shuffled order. `items`: [{ key, pages, brief }].
export function anonymise(items, seed) {
  const rand = random(seed);
  const used = new Set();
  return shuffle(items, rand).map(item => {
    let code;
    do code = 'deck-' + Array.from({ length: 5 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rand() * 31)]).join(''); while (used.has(code));
    used.add(code);
    return { ...item, code };
  });
}

export function codexVersion() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// One call per result. The command is the review command of AGENTS.md, with the pages attached.
export function countDeck(folder, { effort = COUNTER.effort, model = COUNTER.model, timeoutMinutes = 30 } = {}) {
  const pages = fs.readdirSync(folder).filter(name => /^page-\d+\.png$/.test(name)).sort();
  const work = fs.mkdtempSync(path.join(path.dirname(folder), '.count-'));
  const schema = path.join(work, 'schema.json'), answerFile = path.join(work, 'answer.json');
  fs.writeFileSync(schema, JSON.stringify(SCHEMA));
  const prompt = `${fs.readFileSync(path.join(folder, 'instructions.md'), 'utf8')}\n\n${fs.readFileSync(path.join(folder, 'expected.md'), 'utf8')}`;
  const args = ['exec', '-s', 'read-only', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '--skip-git-repo-check', '--ephemeral', '-C', folder,
    '--output-schema', schema, '-o', answerFile, '--json', ...pages.flatMap(name => ['-i', path.join(folder, name)]), '-'];
  const started = Date.now();
  const result = spawnSync('codex', args, { input: prompt, encoding: 'utf8', timeout: timeoutMinutes * 60000, maxBuffer: 1 << 28 });
  const wallMs = Date.now() - started;
  try {
    const events = (result.stdout ?? '').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const usage = events.map(event => event.usage ?? event.msg?.usage ?? event.info?.total_token_usage ?? event.msg?.info?.total_token_usage ?? null).filter(Boolean).pop() ?? null;
    if (result.status !== 0 || !fs.existsSync(answerFile)) return { ok: false, wallMs, usage, error: (result.error?.message ?? result.stderr ?? '').toString().trim().slice(-800) || `codex exited with ${result.status}` };
    const text = fs.readFileSync(answerFile, 'utf8');
    let answer;
    try { answer = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '')); } catch { return { ok: false, wallMs, usage, error: 'the answer is not JSON', raw: text.slice(0, 2000) }; }
    try { return { ok: true, wallMs, usage, model, effort, pagesGiven: pages.length, answer, ...tally(answer, pages.length) }; }
    catch (error) { return { ok: false, wallMs, usage, error: error.message, answer }; }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

export const newSeed = () => crypto.randomBytes(4).readUInt32LE(0);
