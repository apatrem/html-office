// What the bench reads from a session's own report, on invented events. No session is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usageOf, usageFromStream, usageWindows, outsideCause, readLog, sessionEnv, stagePlugin, FORMATS, MODEL, EFFORT, LIMITS, USAGE_CEILING } from '../lib/session.mjs';

test('the model and effort are those of ADR-016', () => {
  assert.deepEqual([MODEL, EFFORT], ['claude-opus-5-5', 'high']);
  assert.deepEqual(Object.keys(FORMATS), ['html-slides', 'pptx']);
});

test('the time limits and the usage ceiling are those written in the README', () => {
  assert.deepEqual(LIMITS, { generationMinutes: 45, editMinutes: 30 });
  assert.deepEqual(USAGE_CEILING, { fiveHour: 0.8, sevenDay: 0.95 });
  const readme = fs.readFileSync(new URL('../../../docs/gate/README.md', import.meta.url), 'utf8');
  assert.match(readme, /Generation: 45 minutes/);
  assert.match(readme, /three edits: 30 minutes/);
  assert.match(readme, /80 % of the five-hour window or 95 % of the seven-day window/);
});

test('tokens are every token the models read or wrote, subagents included', () => {
  const usage = usageOf({ total_cost_usd: 1.5, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {
    'claude-opus-5-5': { inputTokens: 100, outputTokens: 2000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 7000, costUSD: 1.4 },
    'claude-haiku-5-5': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.1 } } });
  assert.deepEqual(usage.tokens, { input: 110, output: 2020, cacheCreation: 7000, cacheRead: 50000, total: 59130 });
  assert.equal(usage.costUsd, 1.5);
  assert.deepEqual(Object.keys(usage.models), ['claude-opus-5-5', 'claude-haiku-5-5']);
});

test('without a per-model report the main loop\'s usage is taken; without any, zero', () => {
  assert.equal(usageOf({ usage: { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 7, cache_read_input_tokens: 8 }, modelUsage: {} }).tokens.total, 26);
  assert.equal(usageOf(null).tokens.total, 0);
});

test('the log gives the session\'s start, its result and the skills it invoked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-session-test-'));
  const log = path.join(dir, 'log.jsonl');
  fs.writeFileSync(log, [
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5', skills: ['gate:pptx'] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'gate:pptx' } }, { type: 'text', text: 'working' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node build.js' } }] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 3 }
  ].map(event => JSON.stringify(event)).join('\n') + '\nnot json\n');
  const read = readLog(log);
  assert.equal(read.init.model, 'claude-opus-5-5');
  assert.equal(read.result.num_turns, 3);
  assert.deepEqual([read.toolUses, read.skillsInvoked], [2, ['gate:pptx']]);
  assert.deepEqual(readLog(path.join(dir, 'absent.jsonl')), { list: [], init: null, result: null, toolUses: 0, skillsInvoked: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a session inherits nothing of the operator\'s Claude Code session except a login', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDE_CODE_EFFORT_LEVEL: 'max', ANTHROPIC_MODEL: 'other', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', GATE_KEEP: 'yes' });
  try {
    const env = sessionEnv('/bench/pilot');
    assert.deepEqual([env.CLAUDE_CODE_EFFORT_LEVEL, env.ANTHROPIC_MODEL, env.CLAUDECODE], [undefined, undefined, undefined]);
    assert.deepEqual([env.ANTHROPIC_API_KEY, env.GATE_KEEP, env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, env.ENABLE_CLAUDEAI_MCP_SERVERS], ['k', 'yes', '1', 'false']);
    assert.ok(env.PATH.startsWith('/bench/pyenv/bin:'), 'the bench folder is the parent of the runs folder');
    assert.equal(env.NODE_PATH, '/bench/node_modules');
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});

test('the staged plugin holds the html-slides skill and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-plugin-test-'));
  const provenance = stagePlugin('html-slides', path.join(dir, 'plugin'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'plugin')).sort(), ['.claude-plugin', 'skills']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'plugin/skills')), ['html-slides']);
  assert.ok(fs.existsSync(path.join(dir, 'plugin/skills/html-slides/tools/check.mjs')));
  assert.match(provenance.commit, /^[0-9a-f]{40}$/);
  assert.match(provenance.version, /^\d+\.\d+\.\d+$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (id, usage, extra = {}) => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage, content: [] }, ...extra });
const window = (status, fiveHour, sevenDay) => ({ type: 'rate_limit_event', rate_limit_info: { status, rateLimitType: 'five_hour', isUsingOverage: false, overageStatus: 'rejected',
  unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt: 1795814400 }, seven_day: { utilization: sevenDay, resetsAt: 1796144400 } } } });

test('a session cut off before its report is charged from its stream, each model call once', () => {
  const list = [
    call('m1', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 }),
    call('m1', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 }),
    call('m2', { input_tokens: 2, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 1010 }),
    { type: 'user', message: { content: [] } }
  ];
  assert.deepEqual(usageFromStream(list).tokens, { input: 12, output: 12, cacheCreation: 1000, cacheRead: 1010, total: 2034 });
  assert.equal(usageFromStream([]).tokens.total, 0);
});

test('a model call still in progress at the cut-off is charged for what it had read', () => {
  // Found by the review of #134. The stream of a real session: a start event with the input and
  // cache tokens, then, when the answer ends, a delta event with the output tokens.
  const start = (id, usage, thread = null) => ({ type: 'stream_event', parent_tool_use_id: thread, event: { type: 'message_start', message: { id, model: 'claude-opus-5-5', usage } } });
  const end = (usage, thread = null) => ({ type: 'stream_event', parent_tool_use_id: thread, event: { type: 'message_delta', usage } });
  const first = { input_tokens: 2, cache_creation_input_tokens: 1604, cache_read_input_tokens: 649, output_tokens: 4 };
  const list = [
    start('m1', first), call('m1', first), end({ ...first, output_tokens: 900 }),
    start('s1', { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 300, output_tokens: 1 }, 'toolu_1'),
    start('m2', { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2253, output_tokens: 1 }),
    end({ input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 300, output_tokens: 70 }, 'toolu_1')
  ];
  // m1 finished (900 output), the subagent's call s1 finished (70), m2 was cut off after its start (1).
  assert.deepEqual(usageFromStream(list).tokens, { input: 17, output: 971, cacheCreation: 2604, cacheRead: 3202, total: 6794 });
  assert.equal(usageFromStream([start('m9', { input_tokens: 10, cache_creation_input_tokens: 1000 })]).tokens.total, 1010, 'a session cut off during its first call');
});

test('the usage windows are read from the first and the last event of a session', () => {
  const seen = usageWindows([window('allowed', 0.58, 0.32), call('m1', {}), window('allowed', 0.62, 0.33)]);
  assert.deepEqual([seen.first.fiveHour, seen.last.fiveHour, seen.last.sevenDay, seen.last.usingOverage, seen.last.status], [0.58, 0.62, 0.33, false, 'allowed']);
  assert.deepEqual(usageWindows([]), { first: null, last: null }, 'an API key reports no window');
});

test('a cause outside the format makes a run void; a cause inside it does not', () => {
  const ok = { type: 'result', is_error: false };
  const none = { list: [], result: ok, spawnError: null, timedOut: false };
  assert.equal(outsideCause(none), null, 'a session that finished');
  assert.equal(outsideCause({ ...none, result: null, timedOut: true }), null, 'the time limit is a failure of the run');
  assert.equal(outsideCause({ ...none, result: { is_error: true, result: 'The model stopped: maximum output reached' } }), null, 'an error of the work itself');
  assert.match(outsideCause({ ...none, list: [window('rejected', 1, 0.5)], result: { is_error: true, result: 'x' } }), /usage limit/);
  assert.equal(outsideCause({ ...none, list: [window('allowed_warning', 0.9, 0.5)] }), null, 'a warning is not a limit');
  assert.match(outsideCause({ ...none, list: [call('m1', {}, { error: 'authentication_failed' })], result: { is_error: true, result: 'Not logged in' } }), /authentication_failed/);
  assert.match(outsideCause({ ...none, result: { is_error: true, api_error_status: 529, result: 'x' } }), /API error 529/);
  assert.match(outsideCause({ ...none, result: { is_error: true, result: 'API Error: Connection error.' } }), /Connection error/);
  assert.match(outsideCause({ ...none, result: null, spawnError: 'spawn claude ENOENT' }), /could not be started/);
  assert.match(outsideCause({ ...none, result: null }), /without a report/);
});
