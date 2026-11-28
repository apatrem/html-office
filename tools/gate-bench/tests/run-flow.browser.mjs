// The whole chain of one html-slides run, with a stand-in for the claude command that calls no
// model: it writes the events a session writes and "generates" the distributed example deck
// (fictional content). Checks what the runner records for a finished run, a failed run, a void run
// and an interrupted one. Needs Chromium. Run by hand: node tools/gate-bench/tests/run-flow.browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GATE = path.join(ROOT, 'tools/gate-bench/gate.mjs');
const bench = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-flow-test-')));
const example = path.join(ROOT, 'plugin/skills/html-slides/examples/community-garden.html');
let fails = 0;
const ok = (condition, message) => { console.log((condition ? 'OK  ' : 'FAIL') + ' ' + message); if (!condition) fails++; };

// The stand-in. FAKE_GENERATION and FAKE_EDITS choose what each session does.
const fake = path.join(bench, 'claude');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('0.0.0 (stand-in)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let prompt = '';
process.stdin.on('data', d => { prompt += d; }).on('end', async () => {
  const say = event => console.log(JSON.stringify(event));
  const window = status => say({ type: 'rate_limit_event', rate_limit_info: { status, rateLimitType: 'five_hour', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.2 }, seven_day: { utilization: 0.3 } } } });
  const done = (extra = {}) => say({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 1200, total_cost_usd: 0.5, result: 'done',
    modelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 1000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 4000, costUSD: 0.5, costBasis: 'list' } }, ...extra });
  say({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', apiKeySource: 'none', claude_code_version: '0.0.0', tools: ['Bash'], skills: ['gate:html-slides'], plugins: [{ name: 'gate' }], mcp_servers: [] });
  window('allowed');
  const kind = /single word ok/.test(prompt) ? 'probe' : /retouched by hand/.test(prompt) ? 'edits' : 'generation';
  const mode = kind === 'probe' ? 'ok' : process.env[kind === 'edits' ? 'FAKE_EDITS' : 'FAKE_GENERATION'] || 'ok';
  say({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 7, cache_creation_input_tokens: 300, cache_read_input_tokens: 2000, output_tokens: 1 } } } });
  if (mode === 'hang') { await new Promise(() => setInterval(() => {}, 1000)); }
  if (mode === 'limit') { window('rejected'); say({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: 'You have reached your usage limit' }); process.exit(1); }
  if (mode === 'error') { say({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: null, result: 'The session gave up' }); process.exit(1); }
  if (kind === 'generation' && mode !== 'no-file') fs.copyFileSync(${JSON.stringify(example)}, 'deck.html');
  if (kind === 'generation' && mode === 'garbage') fs.writeFileSync('deck.html', '<p>not a deck</p>');
  done();
});
`);
fs.chmodSync(fake, 0o755);

const gate = (runs, list, env = {}) => spawnSync(process.execPath, [GATE, ...list, '--runs', path.join(bench, runs)], { encoding: 'utf8', env: { ...process.env, GATE_CLAUDE: fake, ...env } });
const record = (runs, name = 'run-1') => JSON.parse(fs.readFileSync(path.join(bench, runs, 'subject-3/html-slides', name, 'record.json'), 'utf8'));
const run = (runs, env, extra = []) => gate(runs, ['run', '--subject', '3', '--format', 'html-slides', ...extra], env);

// 1. A run that finishes. Brief 3 names a box and a table that the example deck does not have on
// those slides: they are reported, and the chart of slide 4 is moved and kept.
let out = run('finished', {});
ok(out.status === 0, `a finished run (${out.stderr.trim().split('\n').pop() || 'no error'})`);
let r = record('finished');
ok(r.generationFinished && r.editsFinished && r.render.opens && r.render.pages === 9, 'both sessions finished, the final file opens, nine pages');
ok(r.finalCheck.ran && typeof r.finalCheck.passed === 'boolean', 'the format\'s own check ran on the final file');
ok(r.movesKept.applied === 1 && r.movesKept.notApplied === 2 && r.movesKept.kept === true, 'one target applied and kept, two reported as not found');
ok(r.generation.tokens.total === 55010 && r.totals.tokens === 110020 && r.totals.milliseconds === r.generation.wallMs + r.edits.wallMs, 'tokens and time are the sum of the two sessions');
ok(r.usageBefore.windows.fiveHour === 0.2 && r.skill.version && !r.void, 'the usage windows before the run and the skill version are recorded');
ok(fs.existsSync(path.join(bench, 'finished/subject-3/html-slides/run-1/render/deck.pdf')) && fs.existsSync(path.join(bench, 'finished/subject-3/html-slides/run-1/moved/render/pages/page-04.png')), 'the final PDF and the pages after the move exist');
out = run('finished', {});
ok(/already recorded/.test(out.stdout) && JSON.stringify(record('finished')) === JSON.stringify(r), 'a recorded run is not run again');

// 2. The edits end with an error: a failed run, charged, without a final result.
out = run('edits-fail', { FAKE_EDITS: 'error' });
r = record('edits-fail');
ok(out.status === 0 && r.generationFinished && !r.editsFinished && !r.render.opens && !r.void, 'an error of the editing session is a failure, not a void run');
ok(r.partial && r.partial.pages === 9 && !fs.existsSync(path.join(bench, 'edits-fail/subject-3/html-slides/run-1/render')), 'its file is rendered apart, for diagnosis, and there is no final PDF');
ok(r.totals.tokens === 55010 + 2308, 'the generation and the cut-off edits are both charged, the edits from their stream');

// 3. The generation ends without a file, or with an error.
out = run('no-file', { FAKE_GENERATION: 'no-file' });
r = record('no-file');
ok(!r.generationFinished && !r.edits && !r.render.opens && r.totals.tokens === 55010, 'a generation without a file ends the run, which is charged');
out = run('garbage', { FAKE_GENERATION: 'garbage' });
r = record('garbage');
ok(r.generationFinished && r.move.unreadable && r.movesKept.kept === false && !r.void, 'a generated file that is not a deck: no move, moves lost, not void');

// 4. The usage limit during the generation: void, with its evidence, and run again.
out = run('limit', { FAKE_GENERATION: 'limit' });
const folder = path.join(bench, 'limit/subject-3/html-slides');
ok(fs.readdirSync(folder).join() === 'run-1.void-1', 'a void run is set aside');
r = record('limit', 'run-1.void-1');
ok(r.void.cause === 'usage-limit' && /rejected/.test(r.void.evidence) && r.void.step === 'generation', 'with its cause and the rate-limit event as evidence');
out = run('limit', {});
ok(out.status === 0 && fs.readdirSync(folder).sort().join() === 'run-1,run-1.void-1' && record('limit').editsFinished, 'and the same run number is run again');
out = gate('limit', ['grid']);
ok(/Runs recorded \| 1 \| 0/.test(out.stdout.replace(/\*\*/g, '')) || /count yet/.test(out.stdout), 'the void run enters no total');

// 5. The bench is stopped while the editing session runs: on the next start the run is closed as
// failed and charged from its stream, because no cause of the closed list is found.
const child = spawn(process.execPath, [GATE, 'run', '--subject', '3', '--format', 'html-slides', '--runs', path.join(bench, 'stopped')], { env: { ...process.env, GATE_CLAUDE: fake, FAKE_EDITS: 'hang' }, stdio: 'ignore' });
const editLog = path.join(bench, 'stopped/subject-3/html-slides/run-1/edit.log.jsonl');
for (let i = 0; i < 600 && !(fs.existsSync(editLog) && /message_start/.test(fs.readFileSync(editLog, 'utf8'))); i++) await new Promise(resolve => setTimeout(resolve, 100));
child.kill('SIGKILL');
spawnSync('pkill', ['-f', fake]);
out = run('stopped', {});
r = record('stopped');
ok(out.status === 0 && r.interrupted && r.generationFinished && !r.editsFinished && !r.void, 'an interrupted run is closed as failed, not void and not erased');
ok(r.totals.tokens === 55010 + 2308 && r.edits.tokensFromStream === true, 'and is charged with what its stream shows');

// 6. The void command takes only the causes of the closed list, with evidence.
out = gate('finished', ['void', '--subject', '3', '--format', 'html-slides', '--run', '1', '--cause', 'the model was slow', '--evidence', 'x']);
ok(out.status === 1 && /closed list/.test(out.stderr), 'an unlisted cause is refused');
out = gate('finished', ['void', '--subject', '3', '--format', 'html-slides', '--run', '1', '--cause', 'network']);
ok(out.status === 1 && /evidence/.test(out.stderr), 'a listed cause without evidence is refused');

fs.rmSync(bench, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'All checks passed');
process.exit(fails ? 1 : 0);
