// Decides whether a change touches documentation only, so that CI can skip its test jobs (the
// "changes" job of .github/workflows/test.yml). Documentation is docs/** and root-level *.md; no test
// or job reads either (checked: tests/ci.test.mjs keeps the rule's paths and the jobs' guard).
// Fail safe: anything that cannot be decided is "not documentation only", and the script always exits 0.
//   node tools/ci-changes.mjs   (EVENT_NAME, BEFORE, FORCED, GITHUB_OUTPUT from the workflow, which runs the copy of this file from the base commit; prints docs_only=true|false)
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const isDocumentation = file => /^docs\/./.test(file) || /^[^/]+\.md$/.test(file);

// paths: every path the change touches, both sides of a rename. Empty or not an array: run everything.
export function docsOnly(paths) {
  return Array.isArray(paths) && paths.length > 0 && paths.every(file => typeof file === 'string' && isDocumentation(file));
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 });

// The files changed since the base: a pull request's merge commit against its first parent (the base
// branch), a push against the commit before it. Renames are listed as a deletion and an addition.
export function changedFiles(event = process.env.EVENT_NAME, before = process.env.BEFORE, forced = process.env.FORCED) {
  let base;
  // A force push rewrote history: the range from the old tip says nothing about what was merged.
  if (forced === 'true') return [];
  if (event === 'pull_request') base = 'HEAD^1';
  else if (event === 'push' && /^[0-9a-f]{40}$/.test(before ?? '') && !/^0+$/.test(before)) {
    git('fetch', '--no-tags', '--depth=1', 'origin', before);
    base = before;
  } else return [];
  return git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD').split('\0').filter(Boolean);
}

// realpath: the workflow runs a copy under RUNNER_TEMP, which may be reached through a symbolic link.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  let result = false;
  try { result = docsOnly(changedFiles()); } catch (error) { console.error(`changed files unknown, running everything: ${error.message}`); }
  const line = `docs_only=${result}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}
