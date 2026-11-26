// The documentation-only rule of CI (tools/ci-changes.mjs): docs/** and root-level *.md skip the test jobs,
// everything else, and anything undecidable, runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { docsOnly, changedFiles } from '../tools/ci-changes.mjs';

test('docs/ only, root *.md only, or both: documentation', () => {
  assert.equal(docsOnly(['docs/STATUS.md', 'docs/decisions/001-x.md', 'docs/mockups/shell/a.png']), true);
  assert.equal(docsOnly(['README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md']), true);
  assert.equal(docsOnly(['docs/DEVELOPMENT.md', 'README.md']), true);
});

test('one other file runs everything', () => {
  assert.equal(docsOnly(['docs/STATUS.md', 'src/main.mjs']), false);
  assert.equal(docsOnly(['docs/STATUS.md', '.github/workflows/test.yml']), false);
  assert.equal(docsOnly(['README.md', 'package.json']), false);
});

test('only the root: a nested README or note is code as far as CI is concerned', () => {
  assert.equal(docsOnly(['packages/data/README.md']), false);
  assert.equal(docsOnly(['plugin/README.md']), false);
  assert.equal(docsOnly(['src/guide.md']), false);
  assert.equal(docsOnly(['README.md', 'packages/data/README.md']), false);
  assert.equal(docsOnly(['docs']), false);
  assert.equal(docsOnly(['docsx/a.md', 'mydocs/a.md', 'README.mdx', 'README.md.js']), false);
});

test('a rename out of docs/ counts on both sides', () => {
  assert.equal(docsOnly(['docs/old.md', 'src/new.md']), false);
  assert.equal(docsOnly(['docs/old.md', 'docs/new.md']), true);
});

test('empty or unusable input runs everything', () => {
  assert.equal(docsOnly([]), false);
  assert.equal(docsOnly(undefined), false);
  assert.equal(docsOnly(null), false);
  assert.equal(docsOnly('docs/a.md'), false);
  assert.equal(docsOnly(['docs/a.md', undefined]), false);
});

test('the git side: a pull request against its first parent, a push against the commit before, renames on both sides, no base: nothing', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-changes-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text); };
  git('init', '-q', '-b', 'main');
  put('docs/a.md', 'a'.repeat(200)); put('src/x.mjs', 'x');
  git('add', '-A'); git('commit', '-qm', 'base');
  git('mv', 'docs/a.md', 'src/a.md'); put('README.md', 'r');
  git('add', '-A'); git('commit', '-qm', 'change');
  const cwd = process.cwd();
  try {
    process.chdir(repo);
    assert.deepEqual(changedFiles('pull_request').sort(), ['README.md', 'docs/a.md', 'src/a.md']);
    assert.equal(docsOnly(changedFiles('pull_request')), false);
    assert.deepEqual(changedFiles('workflow_dispatch'), []);
    assert.deepEqual(changedFiles('push', '0'.repeat(40)), []);
    assert.deepEqual(changedFiles('push', 'not a sha'), []);
    assert.deepEqual(changedFiles('push', undefined), []);
    // The script itself: an unusable repository gives docs_only=false and exit code 0.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-changes-empty-'));
    const run = spawnSync(process.execPath, [path.join(cwd, 'tools/ci-changes.mjs')], { cwd: empty, encoding: 'utf8', env: { ...process.env, EVENT_NAME: 'pull_request', GITHUB_OUTPUT: '' } });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /^docs_only=false$/m);
  } finally { process.chdir(cwd); fs.rmSync(repo, { recursive: true, force: true }); }
});
