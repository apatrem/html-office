// Construit le moteur (un seul script), le thème, le gabarit, et les copie dans le plugin.
// Usage : node tools/build.mjs
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
const trustPath = path.join(assets, 'trusted-scripts.json');
const trusted = fs.existsSync(trustPath) ? JSON.parse(fs.readFileSync(trustPath, 'utf8')) : {};
const trust = (key, source) => { const hash = createHash('sha256').update(source.trim()).digest('hex'); trusted[key] = [...new Set([...(trusted[key] || []), hash])]; };

const version = JSON.parse(fs.readFileSync(P('package.json'), 'utf8')).version;
const res = await build({
  entryPoints: [P('src/engine/main.js')], bundle: true, minify: true, format: 'iife',
  define: { __ENGINE_VERSION__: JSON.stringify(version) },
  target: ['chrome110', 'edge110', 'safari16', 'firefox115'], write: false, legalComments: 'none',
  banner: { js: `/*! html-slides ${version} — MIT — Copyright (c) 2026 Pierre Supau.
 * Includes Moveable, Selecto and their dependencies — MIT — Copyright (c) 2018-2020 Daybrush ;
 * @egjs/agent, @egjs/children-differ, @egjs/list-differ — MIT — Copyright (c) 2015-present NAVER Corp.
 * MIT licence: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom
 * the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice
 * shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
 * ANY KIND, EXPRESS OR IMPLIED. Details: THIRD_PARTY_NOTICES.md. */` }
});
const engine = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
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
fs.copyFileSync(P('src/theme/charte-pierre.css'), path.join(assets, 'charte-pierre.css'));
const guide = documentation(root, version);
fs.writeFileSync(path.join(assets, 'documentation.html'), guide.html + '\n');
fs.writeFileSync(path.join(assets, 'guide.md'), guide.text + '\n');
fs.writeFileSync(path.join(assets, 'template.html'), fs.readFileSync(P('src/template.html'), 'utf8').replaceAll('{{VERSION}}', version).replace('{{DOCUMENTATION}}', guide.html));
const ec = ecBytes.toString('utf8').replace(/<\/script/gi, '<\\/script');
// Les réponses CDN/tests utilisent les octets originaux ; seul le script intégré au HTML est échappé.
fs.writeFileSync(path.join(assets, 'echarts.min.js'), ecBytes);
trust('engine', engine); trust('echarts', ec);
fs.writeFileSync(trustPath, JSON.stringify(trusted, null, 2) + '\n');
fs.writeFileSync(path.join(assets, 'VERSION'), version + '\n');
console.log(`engine ${version}: ${(engine.length / 1024).toFixed(1)} KB; theme: ${(theme.length / 1024).toFixed(1)} KB`);
