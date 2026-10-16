// Builds the engine (one script), the theme and the template, and copies them into the plugin.
// Usage: node tools/build.mjs [--release]
//   --release records this engine as the published engine of the package version.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { documentation } from './guide.mjs';
import { verifyECharts } from './echarts-integrity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(root, ...a);
const ecBytes = fs.readFileSync(P('node_modules/echarts/dist/echarts.min.js'));
verifyECharts(ecBytes, JSON.parse(fs.readFileSync(P('node_modules/echarts/package.json'),'utf8')).version);
const assets = P('plugin/skills/html-slides/assets');
fs.mkdirSync(P('dist'), { recursive: true });
fs.mkdirSync(assets, { recursive: true });
// The checker accepts published engines (so older decks can be checked and upgraded) and this build only.
const releasedPath = P('src/released-engines.json');
const released = JSON.parse(fs.readFileSync(releasedPath, 'utf8'));
const sha256 = source => createHash('sha256').update(source.trim()).digest('hex');

const version = JSON.parse(fs.readFileSync(P('package.json'), 'utf8')).version;
const res = await build({
  entryPoints: [P('src/engine/main.js')], bundle: true, minify: true, format: 'iife',
  define: { __ENGINE_VERSION__: JSON.stringify(version) },
  target: ['chrome110', 'edge110', 'safari16', 'firefox115'], write: false, legalComments: 'none',
  banner: { js: `/*! html-slides ${version} — MIT — Copyright (c) 2026 Pierre Supau.
 * @csstools/css-tokenizer — MIT — Copyright 2022 Romain Menke, Antonio Laguna <antonio@laguna.es>.
 * Includes Moveable, Selecto and their dependencies — MIT — Copyright (c) 2018-2020 Daybrush ;
 * @egjs/agent, @egjs/children-differ, @egjs/list-differ — MIT — Copyright (c) 2015-present NAVER Corp.
 * MIT licence: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom
 * the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice
 * shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
 * ANY KIND, EXPRESS OR IMPLIED. Details: THIRD_PARTY_NOTICES.md. */` }
});
// A literal HTML comment opener followed by the serializer's <script string can
// put the HTML parser into its double-escaped script state. Keep JS values intact.
const engine = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  .replace(/(["'])<!--\1/g, (_match, quote) => `${quote}\\x3c!--${quote}`);
if (process.argv.includes('--release')) {
  if (released[version] && released[version] !== sha256(engine))
    throw new Error(`Version ${version} was already released with a different engine: bump the version in package.json`);
  released[version] = sha256(engine);
  fs.writeFileSync(releasedPath, JSON.stringify(released, null, 2) + '\n');
}
const css = await build({ entryPoints: [P('src/theme/base.css')], minify: true, write: false, loader: { '.css': 'css' } });
const theme = css.outputFiles[0].text.trim();
await build({ entryPoints: [P('tools/validation.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: P('plugin/skills/html-slides/tools/validation.mjs'), minify: true, legalComments: 'eof' });
await build({ entryPoints: [P('src/format.js')], bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: P('plugin/skills/html-slides/tools/format.mjs'), minify: true });
await build({ entryPoints: [P('src/echarts.js')], bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: P('plugin/skills/html-slides/tools/echarts.mjs'), minify: true });

fs.writeFileSync(P('dist/engine.js'), engine);
fs.writeFileSync(path.join(assets, 'engine.js'), engine);
fs.writeFileSync(path.join(assets, 'theme.css'), theme);
fs.copyFileSync(P('src/theme/default.css'), path.join(assets, 'default.css'));
const guide = documentation(root, version);
fs.writeFileSync(path.join(assets, 'documentation.html'), guide.html + '\n');
fs.writeFileSync(path.join(assets, 'guide.md'), guide.text + '\n');
fs.writeFileSync(path.join(assets, 'template.html'), fs.readFileSync(P('src/template.html'), 'utf8').replaceAll('{{VERSION}}', version).replace('{{DOCUMENTATION}}', guide.html));
const ec = ecBytes.toString('utf8').replace(/<\/script/gi, '<\\/script');
// CDN and test responses use the original bytes; only the script embedded in HTML is escaped.
fs.writeFileSync(path.join(assets, 'echarts.min.js'), ecBytes);
const trusted = { engine: [...new Set([...Object.values(released), sha256(engine)])], echarts: [sha256(ec)] };
fs.writeFileSync(path.join(assets, 'trusted-scripts.json'), JSON.stringify(trusted, null, 2) + '\n');
fs.writeFileSync(path.join(assets, 'VERSION'), version + '\n');
console.log(`engine ${version}: ${(engine.length / 1024).toFixed(1)} KB; theme: ${(theme.length / 1024).toFixed(1)} KB`);
