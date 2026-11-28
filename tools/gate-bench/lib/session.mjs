// Starts one headless Claude Code session per measured step (ADR-016 §2): a new session, the model
// and effort of the ADR, the brief and exactly one skill. Records wall time and the session's own
// usage report. Nothing of the operator's Claude Code setup reaches the session: no user or project
// settings, no CLAUDE.md, no user skills or plugins, no hooks, no MCP server, no memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './briefs.mjs';

export const MODEL = 'claude-opus-5-5';
export const EFFORT = 'high';
// Fixed before the pilot, the same for both formats (ADR-016 §3; docs/gate/README.md): at the limit
// the session is ended and the run has failed.
export const LIMITS = { generationMinutes: 45, editMinutes: 30 };
// A run is not started above these shares of the subscription's usage windows.
export const USAGE_CEILING = { fiveHour: 0.80, sevenDay: 0.95 };
export const FORMATS = {
  'html-slides': { skill: 'html-slides', file: 'deck.html', phrase: 'an html-slides file' },
  pptx: { skill: 'pptx', file: 'deck.pptx', phrase: 'a PowerPoint file (.pptx)' }
};
// The same tools for both formats. No network tool; installing packages is refused.
const TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,Skill,Task';
const DENIED = ['Bash(npm install *)', 'Bash(npm i *)', 'Bash(npx *)', 'Bash(pip install *)', 'Bash(pip3 install *)', 'Bash(python -m pip *)', 'Bash(python3 -m pip *)', 'Bash(brew *)', 'Bash(curl *)', 'Bash(wget *)'];
const AUTH = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];

const RULES = file => [
  `- Save the result as \`${file}\` in the current directory. Other files you create while working may stay there.`,
  '- Nobody is available to answer a question or to approve a plan: decide yourself, and work until the file is finished and has passed the checks that the skill asks for.',
  '- Do not install software and do not use the network.'
].join('\n');

export function generationPrompt(format, brief) {
  const f = FORMATS[format];
  return `Produce the presentation described in the brief below as ${f.phrase}, using the ${f.skill} skill.\n\n${RULES(f.file)}\n\n${brief.brief}\n`;
}
export function editPrompt(format, brief) {
  const f = FORMATS[format];
  return `The presentation \`${f.file}\` in the current directory was produced earlier as ${f.phrase}, then retouched by hand by its author. Apply the three changes below to it, using the ${f.skill} skill, and change nothing else.\n\n${RULES(f.file)}\n\n${brief.edits}\n`;
}

// ---------- the skill given to a session ----------
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => { const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

export function discoverPptxSkill() {
  if (process.env.GATE_PPTX_SKILL) return process.env.GATE_PPTX_SKILL;
  const base = path.join(os.homedir(), 'Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin');
  const found = [];
  for (const org of fs.existsSync(base) ? fs.readdirSync(base) : []) for (const account of fs.readdirSync(path.join(base, org)).filter(name => !name.startsWith('.'))) {
    const skill = path.join(base, org, account, 'skills/pptx');
    if (fs.existsSync(path.join(skill, 'SKILL.md'))) found.push(skill);
  }
  return found.sort((a, b) => fs.statSync(path.join(b, 'SKILL.md')).mtimeMs - fs.statSync(path.join(a, 'SKILL.md')).mtimeMs)[0] ?? null;
}

export function skillSource(format) {
  if (format === 'html-slides') {
    const dir = path.join(ROOT, 'plugin/skills/html-slides');
    return { dir, provenance: { skill: 'html-slides', source: 'plugin/skills/html-slides of this repository', version: fs.readFileSync(path.join(dir, 'assets/VERSION'), 'utf8').trim(),
      commit: git('log', '-1', '--format=%H', '--', 'plugin/skills/html-slides'), uncommittedChanges: !!git('status', '--porcelain', '--', 'plugin/skills/html-slides'), skillMd: sha256(path.join(dir, 'SKILL.md')) } };
  }
  const dir = discoverPptxSkill();
  if (!dir) throw new Error('the PowerPoint skill was not found: set GATE_PPTX_SKILL to the folder that holds its SKILL.md');
  let updatedAt = null;
  try { updatedAt = JSON.parse(fs.readFileSync(path.join(dir, '../../manifest.json'), 'utf8')).skills.find(skill => skill.name === 'pptx')?.updatedAt ?? null; } catch { /* no manifest beside the skill */ }
  return { dir, provenance: { skill: 'pptx', source: 'the anthropic-skills plugin installed by Claude Desktop (not part of this repository)', updatedAt, skillMd: sha256(path.join(dir, 'SKILL.md')) } };
}

// A plugin folder that holds one skill and nothing else. A fresh copy per session: a session cannot
// leave anything behind for the next one.
export function stagePlugin(format, folder) {
  const { dir, provenance } = skillSource(format);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(path.join(folder, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'gate', version: '0.0.0', description: 'One skill, staged by the gate bench' }) + '\n');
  fs.cpSync(dir, path.join(folder, 'skills', FORMATS[format].skill), { recursive: true });
  return provenance;
}

// ---------- the environment of a session ----------
// The bench folder: the parent of a runs folder. It holds what the skills list as preinstalled
// (node_modules, pyenv), shared by the pilot and the campaign, and found from any run below it.
export const benchFolder = runs => (process.env.GATE_ENV ? path.resolve(process.env.GATE_ENV) : path.dirname(runs));
export function sessionEnv(runs) {
  const bench = benchFolder(runs);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|SUPERSET)/.test(key) || AUTH.includes(key)) env[key] = value;
  env.PATH = [path.join(bench, 'pyenv/bin'), process.env.PATH].join(path.delimiter);
  env.NODE_PATH = path.join(bench, 'node_modules');
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}
export const claudeBinary = () => process.env.GATE_CLAUDE ?? 'claude';
export function claudeStatus(runs) {
  const env = sessionEnv(runs);
  const version = spawnSync(claudeBinary(), ['--version'], { env, encoding: 'utf8' });
  const auth = spawnSync(claudeBinary(), ['auth', 'status'], { env, encoding: 'utf8' });
  let loggedIn = null;
  try { loggedIn = JSON.parse(auth.stdout).loggedIn === true; } catch { /* older CLI: unknown */ }
  return { version: version.status === 0 ? version.stdout.trim() : null, loggedIn: loggedIn || AUTH.some(key => env[key]) };
}

// ---------- reading the session's own report ----------
const number = value => (Number.isFinite(value) ? value : 0);
export function usageOf(result) {
  const models = {};
  for (const [name, u] of Object.entries(result?.modelUsage ?? {})) models[name] = {
    input: number(u.inputTokens ?? u.input_tokens), output: number(u.outputTokens ?? u.output_tokens),
    cacheCreation: number(u.cacheCreationInputTokens ?? u.cache_creation_input_tokens), cacheRead: number(u.cacheReadInputTokens ?? u.cache_read_input_tokens),
    costUsd: number(u.costUSD ?? u.cost_usd)
  };
  // The main loop's usage, when the per-model report is absent (it also leaves subagents out).
  if (!Object.keys(models).length && result?.usage) models.unknown = { input: number(result.usage.input_tokens), output: number(result.usage.output_tokens),
    cacheCreation: number(result.usage.cache_creation_input_tokens), cacheRead: number(result.usage.cache_read_input_tokens), costUsd: 0 };
  const sum = key => Object.values(models).reduce((total, model) => total + model[key], 0);
  const tokens = { input: sum('input'), output: sum('output'), cacheCreation: sum('cacheCreation'), cacheRead: sum('cacheRead') };
  // Every token the models read or wrote in the session, subagents included.
  tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead;
  return { tokens, models, costUsd: number(result?.total_cost_usd) };
}

const events = file => {
  const out = [];
  for (const line of fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a line that is not an event */ } }
  return out;
};

// Usage of a session that was cut off and never wrote its report: the sum over the model calls that
// the stream shows. A call's input and cache tokens are known when it starts and its output tokens
// when it ends, so only the output of the one call in progress at the cut-off is missing.
export function usageFromStream(list) {
  const calls = new Map();
  const current = new Map();   // the call in progress, for the main loop and for each subagent
  for (const event of list) {
    const thread = event.parent_tool_use_id ?? 'main';
    if (event.type === 'stream_event' && event.event?.type === 'message_start' && event.event.message?.id) {
      current.set(thread, event.event.message.id);
      calls.set(event.event.message.id, { model: event.event.message.model ?? 'unknown', usage: { ...event.event.message.usage } });
    } else if (event.type === 'stream_event' && event.event?.type === 'message_delta' && event.event.usage && calls.has(current.get(thread))) {
      Object.assign(calls.get(current.get(thread)).usage, event.event.usage);
    } else if (event.type === 'assistant' && event.message?.id && event.message.usage && !calls.has(event.message.id)) {
      calls.set(event.message.id, { model: event.message.model ?? 'unknown', usage: event.message.usage });
    }
  }
  const modelUsage = {};
  for (const { model, usage } of calls.values()) {
    const m = modelUsage[model] ??= { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUSD: 0 };
    m.inputTokens += number(usage.input_tokens); m.outputTokens += number(usage.output_tokens);
    m.cacheCreationInputTokens += number(usage.cache_creation_input_tokens); m.cacheReadInputTokens += number(usage.cache_read_input_tokens);
  }
  return usageOf({ modelUsage });
}

// The subscription's usage windows as the session reports them (absent with an API key).
export function usageWindows(list) {
  const seen = list.filter(event => event.type === 'rate_limit_event' && event.rate_limit_info).map(event => event.rate_limit_info);
  const shape = info => info && { status: info.status ?? null, usingOverage: info.isUsingOverage ?? null, overage: info.overageStatus ?? null,
    fiveHour: info.unifiedWindows?.five_hour?.utilization ?? null, sevenDay: info.unifiedWindows?.seven_day?.utilization ?? null,
    fiveHourResetsAt: info.unifiedWindows?.five_hour?.resetsAt ?? null, sevenDayResetsAt: info.unifiedWindows?.seven_day?.resetsAt ?? null };
  return { first: shape(seen[0]) ?? null, last: shape(seen[seen.length - 1]) ?? null };
}

// A cause outside the format that cut the session off: the run is then void, not failed
// (docs/gate/README.md, "Failed runs and void runs"). Null when the session ended for its own reasons.
const OUTSIDE = /usage limit|rate limit|limit reached|not logged in|\/login|overloaded|api error|connection error|network|socket hang up|ECONN|ETIMEDOUT|ENOTFOUND|credit balance|billing/i;
export function outsideCause({ list, result, spawnError, timedOut }) {
  if (spawnError) return `the claude command could not be started: ${spawnError}`;
  const limit = list.filter(event => event.type === 'rate_limit_event').map(event => event.rate_limit_info).find(info => info && info.status && !/^allowed/.test(info.status));
  if (limit) return `the subscription's usage limit was reached (${limit.rateLimitType ?? 'window'}: ${limit.status})`;
  const errored = list.filter(event => event.type === 'assistant' && typeof event.error === 'string').pop();
  if (errored && (!result || result.is_error)) return `the service reported ${errored.error}`;
  if (result?.is_error && result.api_error_status != null) return `API error ${result.api_error_status}`;
  if (result?.is_error && OUTSIDE.test(String(result.result ?? ''))) return `the session ended on: ${String(result.result).slice(0, 200)}`;
  if (!result && !timedOut) return 'the session stopped without a report and before its time limit (interrupted, or the machine slept)';
  return null;
}

export function readLog(file) {
  const list = events(file);
  const init = list.find(event => event.type === 'system' && event.subtype === 'init') ?? null;
  const result = list.filter(event => event.type === 'result').pop() ?? null;
  const uses = list.filter(event => event.type === 'assistant').flatMap(event => event.message?.content ?? []).filter(block => block.type === 'tool_use');
  return { list, init, result, toolUses: uses.length, skillsInvoked: [...new Set(uses.filter(use => use.name === 'Skill').map(use => String(use.input?.skill ?? use.input?.command ?? '')))] };
}

const baseArgs = tools => ['-p', '--model', MODEL, '--effort', EFFORT, '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'dontAsk',
  '--tools', tools, '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--no-session-persistence'];

// Runs one session and returns what it reports. `log` receives the stream of events.
export function runSession({ cwd, prompt, plugin, runs, log, timeoutMinutes, tools = TOOLS }) {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const args = [...baseArgs(tools), ...(plugin ? ['--plugin-dir', plugin] : []), ...(tools ? ['--allowedTools', tools, '--disallowedTools', ...DENIED] : [])];
  return new Promise(resolve => {
    const out = fs.openSync(log, 'w');
    const err = fs.openSync(log + '.stderr', 'w');
    const loadBefore = os.loadavg();
    const started = process.hrtime.bigint();
    const startedAt = new Date().toISOString();
    const child = spawn(claudeBinary(), args, { cwd, env: sessionEnv(runs), stdio: ['pipe', out, err] });
    // Keeps the machine from idle sleep for as long as the session lives (macOS).
    const awake = child.pid && fs.existsSync('/usr/bin/caffeinate') ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore' }) : null;
    awake?.on('error', () => {});
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000).unref(); }, timeoutMinutes * 60000);
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    let done = false;
    const finish = (exitCode, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      awake?.kill();
      const wallMs = Number((process.hrtime.bigint() - started) / 1000000n);
      fs.closeSync(out); fs.closeSync(err);
      const { list, init, result, toolUses, skillsInvoked } = readLog(log);
      const spawnError = error ? String(error.message) : null;
      const usage = result ? usageOf(result) : usageFromStream(list);
      resolve({
        startedAt, wallMs, exitCode, timedOut, timeLimitMinutes: timeoutMinutes, spawnError,
        // Finished: the session ended by itself, without an error, inside its time limit.
        finished: !!result && result.is_error !== true && !timedOut,
        outsideCause: outsideCause({ list, result, spawnError, timedOut }),
        reported: result ? { subtype: result.subtype, isError: result.is_error === true, numTurns: result.num_turns ?? null, durationMs: result.duration_ms ?? null, durationApiMs: result.duration_api_ms ?? null,
          permissionDenials: (result.permission_denials ?? []).length, message: typeof result.result === 'string' ? result.result.slice(0, 600) : null } : null,
        ...usage, tokensFromStream: !result,
        usageWindows: usageWindows(list), apiKeySource: init?.apiKeySource ?? null,
        costBasis: [...new Set(Object.values(result?.modelUsage ?? {}).map(m => m.costBasis).filter(Boolean))],
        session: init ? { model: init.model, permissionMode: init.permissionMode, claudeCode: init.claude_code_version, tools: init.tools, skills: init.skills, plugins: (init.plugins ?? []).map(p => p.name), mcpServers: (init.mcp_servers ?? []).length } : null,
        toolUses, skillsInvoked, load: { before: loadBefore, after: os.loadavg(), cpus: os.cpus().length }
      });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code, null));
  });
}

// A session that does nothing: it shows the login in use and the subscription's usage windows,
// before a run is started. No skill, no tool.
export function probe(runs) {
  const cwd = path.join(runs, '.probe');
  return runSession({ cwd, prompt: 'Reply with the single word ok.', plugin: null, runs, log: path.join(cwd, 'probe.log.jsonl'), timeoutMinutes: 3, tools: '' });
}
