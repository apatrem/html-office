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
export function sessionEnv(runs) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|SUPERSET)/.test(key) || AUTH.includes(key)) env[key] = value;
  env.PATH = [path.join(runs, 'bin'), path.join(runs, 'pyenv/bin'), process.env.PATH].join(path.delimiter);
  env.NODE_PATH = path.join(runs, 'node_modules');
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

export function readLog(file) {
  const events = [];
  for (const line of fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []) { if (!line.trim()) continue; try { events.push(JSON.parse(line)); } catch { /* a line that is not an event */ } }
  const init = events.find(event => event.type === 'system' && event.subtype === 'init') ?? null;
  const result = events.filter(event => event.type === 'result').pop() ?? null;
  const uses = events.filter(event => event.type === 'assistant').flatMap(event => event.message?.content ?? []).filter(block => block.type === 'tool_use');
  return { init, result, toolUses: uses.length, skillsInvoked: [...new Set(uses.filter(use => use.name === 'Skill').map(use => String(use.input?.skill ?? use.input?.command ?? '')))] };
}

// Runs one session and returns what it reports. `log` receives the stream of events.
export function runSession({ cwd, prompt, plugin, runs, log, timeoutMinutes = 60 }) {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const args = ['-p', '--model', MODEL, '--effort', EFFORT, '--setting-sources', '', '--strict-mcp-config', '--plugin-dir', plugin,
    '--permission-mode', 'dontAsk', '--tools', TOOLS, '--allowedTools', TOOLS, '--disallowedTools', ...DENIED,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  return new Promise(resolve => {
    const out = fs.openSync(log, 'w');
    const err = fs.openSync(log + '.stderr', 'w');
    const loadBefore = os.loadavg();
    const started = process.hrtime.bigint();
    const startedAt = new Date().toISOString();
    const child = spawn(claudeBinary(), args, { cwd, env: sessionEnv(runs), stdio: ['pipe', out, err] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000).unref(); }, timeoutMinutes * 60000);
    child.stdin.end(prompt);
    let done = false;
    const finish = (exitCode, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const wallMs = Number((process.hrtime.bigint() - started) / 1000000n);
      fs.closeSync(out); fs.closeSync(err);
      const { init, result, toolUses, skillsInvoked } = readLog(log);
      resolve({
        startedAt, wallMs, exitCode, timedOut, spawnError: error ? String(error.message) : null,
        completed: !!result && result.is_error !== true && !timedOut,
        reported: result ? { subtype: result.subtype, isError: result.is_error === true, numTurns: result.num_turns ?? null, durationMs: result.duration_ms ?? null, durationApiMs: result.duration_api_ms ?? null,
          permissionDenials: (result.permission_denials ?? []).length, message: typeof result.result === 'string' ? result.result.slice(0, 600) : null } : null,
        ...usageOf(result),
        session: init ? { model: init.model, permissionMode: init.permissionMode, claudeCode: init.claude_code_version, tools: init.tools, skills: init.skills, plugins: (init.plugins ?? []).map(p => p.name), mcpServers: (init.mcp_servers ?? []).length } : null,
        toolUses, skillsInvoked, load: { before: loadBefore, after: os.loadavg(), cpus: os.cpus().length }
      });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code, null));
  });
}
