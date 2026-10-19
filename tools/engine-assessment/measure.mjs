import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync, brotliCompressSync, constants} from 'node:zlib';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {encode} from 'gpt-tokenizer/encoding/o200k_base';
import {serialiseRows, comparable} from './measurement.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(root, name));
const manifest = JSON.parse(read('package.json'));
const sha256 = input => createHash('sha256').update(input).digest('hex');
const options = {bundle: true, minify: true, format: 'esm', platform: 'browser',
  target: 'es2022', legalComments: 'none', write: false};
const packages = Object.fromEntries(Object.keys(manifest.dependencies).map(name =>
  [name, JSON.parse(read(`node_modules/${name}/package.json`)).version]));
for (const [name, version] of Object.entries(packages)) assert.equal(version, manifest.dependencies[name], name);

function sizes(input, tokens = false) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return {bytes: bytes.length, sha256: sha256(bytes),
    gzipBytes: gzipSync(bytes, {level: 9}).length,
    brotliBytes: brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length,
    ...(tokens ? {tokens: encode(bytes.toString('utf8')).length} : {})};
}
const pm = Object.keys(packages).filter(name => name.startsWith('prosemirror-'));
const entries = Object.fromEntries(pm.map(name => [name, `export * from '${name}';`]));
entries.prosemirrorFull = pm.map((name, i) => `export * as module${i} from '${name}';`).join('\n');
entries.formulaJs = "export * from '@formulajs/formulajs';";
entries.echartsCustom = `
  import {use} from 'echarts/core';
  import {BarChart, LineChart, ScatterChart, CustomChart} from 'echarts/charts';
  import {GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, DatasetComponent} from 'echarts/components';
  import {SVGRenderer} from 'echarts/renderers';
  use([BarChart, LineChart, ScatterChart, CustomChart, GridComponent, LegendComponent,
    TooltipComponent, MarkLineComponent, DatasetComponent, SVGRenderer]);
  export * from 'echarts/core';`;
const bundles = Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([name, contents]) => {
  const result = await build({...options, stdin: {contents, resolveDir: root, sourcefile: 'entry.js'}});
  return [name, sizes(result.outputFiles[0].contents)];
})));

const config = JSON.parse(read('fixtures/raw-data.json'));
const rows = Array.from({length: config.rows}, (_, i) => {
  const visits = 10 + i % 90, price = 9.5 + (i % 10) * 0.5;
  const revenue = visits * price;
  return [`R-${i + 1}`, config.regions[i % config.regions.length],
    config.programmes[i % config.programmes.length], `2026-${String(1 + i % 12).padStart(2, '0')}-01`,
    visits, price, revenue, Math.round(revenue * 0.7 * 100) / 100];
});
const {csv, json} = serialiseRows(config.columns, rows);
const fixtureNames = ['fixtures/report.md', 'fixtures/report.html', 'fixtures/raw-data.json'];
const evidence = {
  schemaVersion: 1,
  environment: {node: process.version, zlib: process.versions.zlib, platform: process.platform, arch: process.arch},
  packages, build: options,
  inputs: Object.fromEntries([...fixtureNames, 'measure.mjs', 'measurement.mjs', 'package-lock.json']
    .map(name => [name, sha256(read(name))])),
  entries, bundles,
  assets: {
    ironcalcWasm: sizes(read('node_modules/@ironcalc/wasm/wasm_bg.wasm')),
    ironcalcWrapper: sizes(read('node_modules/@ironcalc/wasm/wasm.js')),
    echartsFull: sizes(read('node_modules/echarts/dist/echarts.min.js'))
  },
  readability: {
    markdown: sizes(read('fixtures/report.md'), true),
    html: sizes(read('fixtures/report.html'), true),
    rawData: {rows: rows.length, columns: config.columns.length, csv: sizes(csv, true), perCellJson: sizes(json, true)}
  }
};
const flags = process.argv.slice(2);
assert.ok(flags.length <= 1 && flags.every(flag => ['--write', '--check'].includes(flag)), 'Use --write or --check, or no flag');
const baseline = path.join(root, 'results.json');
if (flags.includes('--check')) {
  assert.deepEqual(comparable(evidence), comparable(JSON.parse(fs.readFileSync(baseline, 'utf8'))),
    'Assessment changed. Inspect the dependency/input/bundle differences before deliberately updating results.json.');
  console.log('Pinned inputs, bundle bytes/hashes and token counts match results.json (compression/environment are advisory).');
} else if (flags.includes('--write')) {
  fs.writeFileSync(baseline, JSON.stringify(evidence, null, 2) + '\n');
  console.log('Updated tools/engine-assessment/results.json');
} else console.log(JSON.stringify(evidence, null, 2));
