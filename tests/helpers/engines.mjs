// Which browser engines a script runs, and the record CI keeps of it.
//
// Browser scripts read their engines from a variable (TEXT_ENGINES, CLIPBOARD_ENGINES,
// SLIDES_ENGINES, SAVE_ENGINES, ACCEPTANCE_ENGINES) and most default to Chromium, so a workflow
// step that loses its variable still passes, in Chromium alone. Each script takes its list from
// engineList(), which in CI also appends it to dist/engines-run.tsv. The jobs that exist to cover
// Firefox and WebKit end with
//   node tests/helpers/engines.mjs firefox webkit
// which fails unless every script recorded in the job ran those engines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RECORD = path.join(ROOT, 'dist/engines-run.tsv');

export function engineList(variable, fallback = 'chromium', { env = process.env, script = process.argv[1], record = RECORD } = {}) {
  const list = (env[variable] || fallback).split(',').map(name => name.trim()).filter(Boolean);
  if (env.CI) {
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.appendFileSync(record, `${path.relative(ROOT, script)}\t${list.join(',')}\n`);
  }
  return list;
}

// The scripts of a record with the engines each ran, and what is wrong with it for `required`.
export function review(text, required) {
  const rows = text.split('\n').filter(Boolean).map(line => { const [script, list = ''] = line.split('\t'); return { script, engines: list.split(',').filter(Boolean) }; });
  const problems = rows.filter(row => required.some(name => !row.engines.includes(name)))
    .map(row => `${row.script} ran ${row.engines.join(', ') || 'no engine'}: ${required.filter(name => !row.engines.includes(name)).join(' and ')} missing`);
  if (!rows.length) problems.push('no browser script recorded its engines');
  return { rows, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const required = process.argv.slice(2);
  if (!required.length) { console.error('Usage: node tests/helpers/engines.mjs <engine>...   (for example: firefox webkit)'); process.exit(2); }
  const { rows, problems } = review(fs.existsSync(RECORD) ? fs.readFileSync(RECORD, 'utf8') : '', required);
  for (const row of rows) console.log(`${row.engines.join(', ').padEnd(26)} ${row.script}`);
  for (const problem of problems) console.error(`::error title=Browser engines::${problem}`);
  if (!problems.length) console.log(`\n${rows.length} browser script(s), each in ${required.join(' and ')}.`);
  process.exit(problems.length ? 1 : 0);
}
