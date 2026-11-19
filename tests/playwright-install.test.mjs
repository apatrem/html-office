// The CI browser installer (.github/actions/playwright/install.sh) against stubbed sudo, timeout,
// getent, sleep, apt-get and Playwright CLI: where packages come from, that every step is bounded
// (Codex review of the CI resilience PR), and that DNS recovering after a long wait is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.github/actions/playwright/install.sh');

// state/: installed (packages present), dns-fails (probes left to fail), log (one line per call).
function run({ installed = false, debs = 0, dnsFails = 0, budget, dnsWait, aptFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-install-')), bin = path.join(dir, 'bin'), apt = path.join(dir, 'apt');
  fs.mkdirSync(bin); fs.mkdirSync(apt);
  for (let i = 0; i < debs; i++) fs.writeFileSync(path.join(apt, `lib${i}.deb`), '');
  if (installed) fs.writeFileSync(path.join(dir, 'installed'), '');
  fs.writeFileSync(path.join(dir, 'dns-fails'), String(dnsFails));
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nS=${JSON.stringify(dir)}\n${body}\n`, { mode: 0o755 });
  stub('sudo', `echo "sudo $*" >> "$S/log"; if [ "$1" = tee ]; then cat > "$S/apt.conf"; exit 0; fi; exec "$@"`);
  stub('timeout', `echo "timeout $*" >> "$S/log"; [ "$1" = --kill-after=15 ] && shift; [ "$1" -gt 0 ] || exit 99; shift; exec "$@"`);
  stub('sleep', 'exit 0');
  stub('getent', 'n=$(cat "$S/dns-fails"); if [ "$n" -gt 0 ]; then echo $((n-1)) > "$S/dns-fails"; exit 2; fi; echo "192.0.2.1 $3"');
  stub('apt-get', `echo "apt-get $*" >> "$S/log"; ${aptFails ? 'exit 100' : 'touch "$S/installed"'}`);
  const cli = path.join(dir, 'cli.js');
  fs.writeFileSync(cli, `const fs=require('fs'),S=${JSON.stringify(dir)},a=process.argv.slice(2);
fs.appendFileSync(S+'/log','cli '+a.join(' ')+'\\n');
if(a[0]==='install-deps'&&a[1]==='--dry-run')process.exit(fs.existsSync(S+'/installed')?0:1);
if(a[0]==='install-deps'){fs.writeFileSync(S+'/installed','');fs.writeFileSync(${JSON.stringify(apt)}+'/fresh.deb','');}`);
  const out = path.join(dir, 'output');
  const r = spawnSync('bash', [SCRIPT, 'chromium', 'webkit'], { encoding: 'utf8', env: { ...process.env,
    PATH: `${bin}:${process.env.PATH}`, PLAYWRIGHT_CLI: cli, PLAYWRIGHT_APT_DIR: apt, GITHUB_OUTPUT: out,
    ...(budget === undefined ? {} : { PLAYWRIGHT_INSTALL_BUDGET: String(budget) }),
    ...(dnsWait === undefined ? {} : { PLAYWRIGHT_DNS_WAIT: String(dnsWait) }) } });
  const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  const result = { code: r.status, stdout: r.stdout, log: read('log').trim().split('\n'), output: read('output'), conf: read('apt.conf'),
    debs: fs.existsSync(apt) ? fs.readdirSync(apt).sort() : [] };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('packages already on the image: nothing is installed', () => {
  const r = run({ installed: true });
  assert.equal(r.code, 0);
  assert.ok(!r.log.some(l => l.startsWith('apt-get') || l === 'cli install-deps chromium webkit'));
  assert.equal(r.output, '', 'nothing to save');
});

test('cached packages install without network, under a root-owned timeout', () => {
  const r = run({ debs: 2, dnsFails: 99 });
  assert.equal(r.code, 0, r.stdout);
  const apt = r.log.findIndex(l => l.startsWith('apt-get'));
  assert.match(r.log[apt - 2], /^sudo timeout --kill-after=15 \d+ apt-get install -y --no-download /);
  assert.ok(!r.log.includes('cli install-deps chromium webkit'), 'the mirrors are not used');
});

test('the mirrors: Playwright installs the packages as root under timeout, and the .deb files are kept', () => {
  const r = run({ debs: 1, aptFails: true });
  assert.equal(r.code, 0, r.stdout);
  const deps = r.log.indexOf('cli install-deps chromium webkit');
  assert.match(r.log[deps - 2], /^sudo timeout --kill-after=15 \d+ \S+ \S+cli\.js install-deps chromium webkit$/);
  assert.deepEqual(r.debs, ['fresh.deb'], 'packages restored for another image are dropped');
  assert.match(r.conf, /Dir::Cache::Archives/);
  assert.match(r.output, /^apt-cache=/);
});

test('DNS that recovers after several minutes of failed probes is used (review: the backoff status leaked)', () => {
  const r = run({ dnsFails: 6 });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.log.includes('cli install-deps chromium webkit'));
});

test('no time left: no command runs under `timeout 0`, and the error says why (review)', () => {
  const r = run({ budget: 5 });
  assert.equal(r.code, 1);
  assert.ok(!r.log.some(l => /^(sudo )?timeout( --kill-after=15)? 0 /.test(l)), r.log.join('\n'));
  assert.match(r.stdout, /::error title=Playwright install::/);
});

test('mirrors that never resolve: the install fails with the outage named instead of hanging', () => {
  const r = run({ dnsFails: 1e6, dnsWait: 0 });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /did not resolve or answer within the time allowed/);
  assert.ok(!r.log.includes('cli install-deps chromium webkit'));
});
