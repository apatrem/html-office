// The CI workflow (.github/workflows/test.yml) read as text, so that a gate cannot leave it
// unnoticed (a merge once dropped the env: block of several steps, which then passed in Chromium
// alone): every test file is run by a suite, every gate is still in its job, the engine variables
// are set where a step cannot lose them and checked by a last step, and actions are pinned.
// Also the engine list helper those jobs rely on (tests/helpers/engines.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engineList, review } from './helpers/engines.mjs';
import { SCRIPTS as DATA_BROWSER_SCRIPTS, SERIAL as DATA_BROWSER_SERIAL, problems as dataBrowserProblems } from '../packages/data/tests/browser-pool.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const workflow = read('.github/workflows/test.yml');
// jobs: name → its text; a job starts at a key indented by two spaces after "jobs:".
const jobs = Object.fromEntries(workflow.slice(workflow.indexOf('\njobs:\n')).split(/\n(?=  [\w-]+:\n)/).slice(1)
  .map(text => [/^  ([\w-]+):/.exec(text)[1], text]));
// The job's own env: block (four spaces), not the env: of a step (eight).
const jobEnv = job => Object.fromEntries([...(/\n    env:\n((?:      .*\n)+)/.exec(jobs[job])?.[1] ?? '').matchAll(/^      (\w+): (.*)$/gm)].map(m => [m[1], m[2]]));
// One npm script, by name: a file named only in a script CI never calls is not run.
const script = (file, name) => JSON.parse(read(file)).scripts[name] ?? '';
const list = (dir, test) => fs.readdirSync(path.join(ROOT, dir)).filter(test).map(name => `${dir}/${name}`);

test('the workflow has the jobs this file knows', () => {
  assert.deepEqual(Object.keys(jobs).sort(), ['blind-kits', 'clipboard-engines', 'data-bench', 'data-phase-a', 'test', 'text', 'text-bench-engines', 'text-engines']);
});

test('every gate is still in its job', () => {
  const gates = {
    test: ['fetch-tags: true', 'npm audit --audit-level=high', 'npm run build', 'git status --porcelain -- plugin/skills/html-slides', 'run: npm test',
      'npm --prefix tools/engine-assessment test', 'npm --prefix tools/engine-assessment run measure -- --check',
      'check.mjs plugin/skills/html-slides/examples/community-garden.html', 'check.mjs plugin/skills/html-slides/examples/catalogue.html'],
    'data-phase-a': ['npm audit --prefix packages/data --audit-level=high', 'npm audit --prefix packages/data/engine/toolchain --audit-level=high',
      'npm audit --prefix packages/data/bench/storage --audit-level=high', 'npm --prefix packages/data run format:check',
      'node packages/data/tools/skill.mjs --check', 'run: npm run test:data'],
    'data-bench': ['node --expose-gc packages/data/bench/browser.mjs --check --profile'],
    'blind-kits': ['node --test packages/data/tests/blind-kit.test.mjs packages/text/tests/blind-kit.test.mjs'],
    text: ['npm audit --prefix packages/text --audit-level=high', 'npm --prefix packages/text run format:check',
      'node packages/text/tools/skill.mjs --check', 'run: npm run test:text', 'node packages/text/bench/browser.mjs --check'],
    'clipboard-engines': ['run: node tests/clipboard-engines.mjs', 'node packages/data/acceptance/generate.mjs --out dist/data/acceptance',
      'ACCEPTANCE_DIR=dist/data/acceptance node packages/data/tests/acceptance-engines.mjs'],
    'text-engines': ['node packages/text/tests/print-firefox.mjs'],
    'text-bench-engines': ['node packages/text/bench/browser.mjs --check --output dist/text-bench/ci-results.json', 'name: text-benchmark-engines']
  };
  for (const [job, commands] of Object.entries(gates)) for (const command of commands) assert.ok(jobs[job].includes(command), `${job}: ${command}`);
  // What the three suite commands of the workflow run: the unit suite, then the browser chain.
  assert.match(script('package.json', 'test'), /^npm run build && node --test tests\/\S+\.test\.mjs/);
  for (const pkg of ['data', 'text']) {
    assert.equal(script('package.json', `test:${pkg}`), `npm --prefix packages/${pkg} test && npm --prefix packages/${pkg} run test:browser`);
    assert.equal(script(`packages/${pkg}/package.json`, 'test'), 'node --test tests/*.test.mjs', `packages/${pkg}: the unit suite takes every tests/*.test.mjs`);
  }
});

test('every test file is run by a suite or by the workflow', () => {
  // npm test (the test job) names its files one by one; the packages' unit suites take a glob (checked above).
  const missing = (suite, files) => files.filter(file => !new RegExp(`(^|\\s)${file.replace(/[.*/]/g, '\\$&')}(\\s|$)`).test(suite));
  assert.deepEqual(missing(script('package.json', 'test'), list('tests', name => name.endsWith('.test.mjs'))), []);
  for (const pkg of ['data', 'text']) {
    // Data runs its list through the pool runner (below); Text chains its scripts in the npm script.
    const chain = pkg === 'data' ? DATA_BROWSER_SCRIPTS.map(name => `node tests/${name}`).join(' && ') : script(`packages/${pkg}/package.json`, 'test:browser');
    const files = list(`packages/${pkg}/tests`, name => name.endsWith('-browser.mjs'));
    assert.ok(files.length >= 14, `packages/${pkg}: ${files.length} browser scripts`);
    assert.deepEqual(missing(chain, files.map(file => `tests/${path.basename(file)}`)), []);
  }
  // The rule itself (review of the CI changes): a file named only by another script, or as part of another name, is missing.
  assert.deepEqual(missing('node --test tests/a.test.mjs tests/b.test.mjs && node tests/c-browser.mjs', ['tests/a.test.mjs', 'tests/b.test.mjs']), []);
  assert.deepEqual(missing('node --test tests/xa.test.mjs tests/a.test.mjsx', ['tests/a.test.mjs']), ['tests/a.test.mjs']);
  assert.deepEqual(missing(script('package.json', 'test').replace(' tests/tools.test.mjs', ''), ['tests/tools.test.mjs']), ['tests/tools.test.mjs'], 'still named by test:regression, which CI does not run');
  assert.match(script('package.json', 'test:regression'), / tests\/tools\.test\.mjs /);
});

test('scripts that take their engines from a variable run in an engines job, which sets it for the whole job and checks it last', () => {
  const taking = [...list('tests', name => name.endsWith('.mjs')), ...list('packages/text/tests', name => name.endsWith('.mjs')),
    ...list('packages/text/bench', name => name.endsWith('.mjs')), ...list('packages/data/tests', name => name.endsWith('.mjs'))]
    .filter(file => !file.endsWith('.test.mjs') && /\bengineList\(/.test(read(file)));
  assert.ok(taking.length >= 22, `${taking.length} scripts`);
  for (const file of taking) {
    const job = file.startsWith('packages/text/bench/') ? 'text-bench-engines' : file.startsWith('packages/text/') ? 'text-engines' : 'clipboard-engines';
    assert.ok(jobs[job].includes(`node ${file}`), `${file} is not run by ${job}`);
  }
  // No script reads an engines variable on its own: it would escape the record.
  for (const file of [...list('tests', n => n.endsWith('.mjs')), ...list('packages/text/tests', n => n.endsWith('.mjs')), ...list('packages/data/tests', n => n.endsWith('.mjs'))])
    assert.doesNotMatch(read(file), /process\.env\.\w+_ENGINES/, file);
  assert.deepEqual(jobEnv('text-engines'), { TEXT_ENGINES: 'firefox,webkit' });
  assert.deepEqual(jobEnv('text-bench-engines'), { TEXT_ENGINES: 'firefox,webkit' });
  assert.ok(!jobs['text-engines'].includes('packages/text/bench/'), 'the benchmark runs once, in its own job');
  assert.deepEqual(jobEnv('clipboard-engines'), { SLIDES_ENGINES: 'firefox,webkit', SAVE_ENGINES: 'firefox,webkit' });
  for (const job of ['text-engines', 'text-bench-engines', 'clipboard-engines']) {
    assert.doesNotMatch(jobs[job], /^ {8,}\w+_ENGINES:/m, `${job}: no engines variable in the env: of a step`);
    assert.match(jobs[job].replace(/(\n *#.*|\s)+$/, ''), /\n {8}run: node tests\/helpers\/engines\.mjs firefox webkit$/, `${job}: the last step checks the engines that ran`);
  }
  // The three Slides clipboard scripts share CLIPBOARD_ENGINES with tests/clipboard-engines.mjs, which keeps
  // its three engines: the variable is on their command lines.
  for (const name of ['slides-clipboard', 'slides-charts-clipboard', 'slides-slide-clipboard'])
    assert.ok(jobs['clipboard-engines'].includes(`CLIPBOARD_ENGINES=firefox,webkit node tests/${name}.mjs`), name);
  assert.doesNotMatch(jobs['clipboard-engines'], /CLIPBOARD_ENGINES=\S+ node tests\/clipboard-engines\.mjs/);
  // Their Chromium run, and that of the other scripts this job runs in two engines, is in npm test and npm run test:data.
  for (const name of ['slides-clipboard', 'slides-charts-clipboard', 'slides-slide-clipboard', 'slides-tables', 'save-in-place-slides'])
    assert.match(script('package.json', 'test'), new RegExp(`&& node tests/${name}\\.mjs( |$)`), `npm test runs ${name} in Chromium`);
  assert.ok(DATA_BROWSER_SCRIPTS.includes('save-in-place-browser.mjs'));
});

test('the blind-kit score tests are left out of the Data and Text jobs only, and run in their own', () => {
  const setting = Object.entries(jobs).filter(([, text]) => text.includes('BLIND_KIT')).map(([name]) => name);
  assert.deepEqual(setting.sort(), ['data-phase-a', 'text']);
  assert.ok(!workflow.slice(0, workflow.indexOf('\njobs:\n')).includes('BLIND_KIT'));
  for (const pkg of ['data', 'text']) assert.match(read(`packages/${pkg}/tests/blind-kit.test.mjs`), /process\.env\.BLIND_KIT === "own-job"/);
});

test('a merge to main keeps its run, and every action is pinned to a commit', () => {
  assert.match(workflow, /\n {2}group: tests-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}\n/);
  const uses = [...workflow.matchAll(/uses: (\S+)/g), ...read('.github/actions/playwright/action.yml').matchAll(/uses: (\S+)/g)].map(m => m[1]);
  assert.ok(uses.length > 20);
  for (const action of uses) assert.match(action, /^(\.\/\.github\/actions\/[\w-]+|actions\/[\w-]+(\/[\w-]+)?@[0-9a-f]{40})$/, action);
});

test('engineList reads the variable or the default and records what it gives only in CI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engines-')), record = path.join(dir, 'sub/run.tsv');
  const script = path.join(ROOT, 'packages/text/tests/saving-browser.mjs');
  assert.deepEqual(engineList('TEXT_ENGINES', 'chromium', { env: {}, script, record }), ['chromium']);
  assert.deepEqual(engineList('TEXT_ENGINES', 'chromium', { env: { TEXT_ENGINES: '' }, script, record }), ['chromium']);
  assert.deepEqual(engineList('TEXT_ENGINES', 'chromium,firefox,webkit', { env: {}, script, record }), ['chromium', 'firefox', 'webkit']);
  assert.ok(!fs.existsSync(record), 'nothing is recorded outside CI');
  assert.deepEqual(engineList('TEXT_ENGINES', 'chromium', { env: { CI: 'true', TEXT_ENGINES: 'firefox, webkit' }, script, record }), ['firefox', 'webkit']);
  assert.deepEqual(engineList('SAVE_ENGINES', 'chromium', { env: { CI: 'true' }, script: path.join(ROOT, 'tests/save-in-place-slides.mjs'), record }), ['chromium']);
  assert.equal(fs.readFileSync(record, 'utf8'), 'packages/text/tests/saving-browser.mjs\tfirefox,webkit\ntests/save-in-place-slides.mjs\tchromium\n');
  fs.rmSync(dir, { recursive: true });
});

test('the engines check fails for a script that ran without a required engine, and for an empty record', () => {
  const good = 'a.mjs\tfirefox,webkit\nb.mjs\tchromium,firefox,webkit\n';
  assert.deepEqual(review(good, ['firefox', 'webkit']).problems, []);
  assert.equal(review(good, ['firefox', 'webkit']).rows.length, 2);
  assert.deepEqual(review(good + 'c.mjs\tchromium\n', ['firefox', 'webkit']).problems, ['c.mjs ran chromium: firefox and webkit missing']);
  assert.deepEqual(review('c.mjs\tchromium,webkit\n', ['firefox', 'webkit']).problems, ['c.mjs ran chromium, webkit: firefox missing']);
  assert.deepEqual(review('', ['firefox']).problems, ['no browser script recorded its engines']);
  // As the last step of a job: a script that lost its variable, then the same job with it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engines-cli-'));
  fs.mkdirSync(path.join(dir, 'tests/helpers'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tests/helpers/engines.mjs'), path.join(dir, 'tests/helpers/engines.mjs'));
  fs.writeFileSync(path.join(dir, 'tests/one.mjs'), "import { engineList } from './helpers/engines.mjs';\nconsole.log(engineList('TEXT_ENGINES').join());\n");
  const node = (args, env) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, CI: 'true', ...env } });
  const check = () => node(['tests/helpers/engines.mjs', 'firefox', 'webkit']);
  assert.equal(check().status, 1, 'no record');
  assert.equal(node(['tests/one.mjs'], {}).stdout, 'chromium\n');
  let r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error title=Browser engines::tests\/one\.mjs ran chromium: firefox and webkit missing/);
  fs.rmSync(path.join(dir, 'dist'), { recursive: true });
  assert.equal(node(['tests/one.mjs'], { TEXT_ENGINES: 'firefox,webkit' }).stdout, 'firefox,webkit\n');
  r = check();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 browser script\(s\), each in firefox and webkit\./);
  assert.equal(node(['tests/helpers/engines.mjs']).status, 2, 'no engine named');
  fs.rmSync(dir, { recursive: true });
});

test('the Data browser scripts run through the pool runner, from one explicit list that cannot fall behind the folder', () => {
  assert.equal(script('packages/data/package.json', 'test:browser'), 'node tests/browser-pool.mjs');
  assert.deepEqual(dataBrowserProblems(), [], 'the list and packages/data/tests agree');
  // The rule itself: a script left out, a name that is not a file, a duplicate, a serial one not listed.
  assert.deepEqual(dataBrowserProblems(['a-browser.mjs'], [], ['a-browser.mjs', 'b-browser.mjs', 'helper.mjs']), ['b-browser.mjs is not in SCRIPTS']);
  assert.deepEqual(dataBrowserProblems(['a-browser.mjs', 'gone.mjs', 'a-browser.mjs'], ['x.mjs'], ['a-browser.mjs']),
    ['gone.mjs is listed but is not in tests/', 'a-browser.mjs is listed twice', 'x.mjs is serial but not listed']);
  // The three 100k-row scripts with time limits run alone, after the pool.
  assert.deepEqual([...DATA_BROWSER_SERIAL].sort(), ['conditional-edge-browser.mjs', 'data-bars-edge-browser.mjs', 'grid-browser.mjs']);
  assert.match(read('packages/data/tests/browser-pool.mjs'), /DATA_BROWSER_JOBS \?\? 3/);
});
