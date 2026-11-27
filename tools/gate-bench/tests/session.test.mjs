// What the bench reads from a session's own report, on invented events. No session is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usageOf, readLog, sessionEnv, stagePlugin, FORMATS, MODEL, EFFORT } from '../lib/session.mjs';

test('the model and effort are those of ADR-016', () => {
  assert.deepEqual([MODEL, EFFORT], ['claude-opus-5-5', 'high']);
  assert.deepEqual(Object.keys(FORMATS), ['html-slides', 'pptx']);
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
  assert.deepEqual(readLog(path.join(dir, 'absent.jsonl')), { init: null, result: null, toolUses: 0, skillsInvoked: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a session inherits nothing of the operator\'s Claude Code session except a login', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDE_CODE_EFFORT_LEVEL: 'max', ANTHROPIC_MODEL: 'other', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', GATE_KEEP: 'yes' });
  try {
    const env = sessionEnv('/runs');
    assert.deepEqual([env.CLAUDE_CODE_EFFORT_LEVEL, env.ANTHROPIC_MODEL, env.CLAUDECODE], [undefined, undefined, undefined]);
    assert.deepEqual([env.ANTHROPIC_API_KEY, env.GATE_KEEP, env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, env.ENABLE_CLAUDEAI_MCP_SERVERS], ['k', 'yes', '1', 'false']);
    assert.ok(env.PATH.startsWith('/runs/bin:/runs/pyenv/bin:'));
    assert.equal(env.NODE_PATH, '/runs/node_modules');
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
