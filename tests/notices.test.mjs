import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { groupNotices, formatNotices, bundledPackages, packageEntries } from '../packages/shared/notices.mjs';
import { noticeBlocks, noticeProblems } from '../packages/shared/notices-check.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIT = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const body = MIT.slice(MIT.indexOf('Permission'));
const format = entries => formatNotices(groupNotices(entries), { title: 'Notices' });

test('a licence text is stored once with every package and copyright holder it covers', () => {
  const rewrapped = body.replace(/\n/g, ' ').replace(/\. /g, '.\n\n');
  const entries = [
    { label: 'a@1.0.0/LICENSE', text: `MIT License\n\nCopyright (c) 2020 A\n\n${body}` },
    { label: 'b@2.0.0/LICENSE-MIT', text: `Copyright (c) 2021 B\nCopyright (c) 2022 B2\n\n${rewrapped}` },
    { label: 'c@3.0.0', licence: 'MIT', text: 'Copyright (c) C' },
    // Different wording is never merged, however small the difference.
    { label: 'd@4.0.0/LICENSE', text: `Copyright (c) D\n\n${body.replace('shall be included', 'shall be included (including the next paragraph)')}` },
  ];
  const notices = format(entries), blocks = noticeBlocks(notices);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].packages, ['a@1.0.0', 'b@2.0.0', 'c@3.0.0']);
  for (const line of ['Copyright (c) 2020 A', 'Copyright (c) 2021 B', 'Copyright (c) 2022 B2', 'Copyright (c) C', 'Copyright (c) D'])
    assert.ok(notices.includes('    ' + line + '\n'), line);
  assert.deepEqual(noticeProblems(entries, notices), []);
  assert.throws(() => format([{ label: 'e@1.0.0', licence: 'MIT', text: 'Copyright (c) E' }]), /no MIT licence text/);
});

test('a file\'s other sections stay together and point to the licence texts lifted out of them', () => {
  const entries = [
    { label: 'a@1.0.0/LICENSE', text: `Copyright (c) A\n\n${body}` },
    { label: 'a@1.0.0/NOTICE', text: `a\nCopyright 2015 A\n\nIncludes sub.\n\n=====\n\nsub from https://example.org\n\n=====\n\nCopyright (c) 2010 Sub\n\n${body}` },
  ];
  const notices = format(entries), blocks = noticeBlocks(notices);
  const n = blocks.findIndex(block => /^Permission/.test(block.text)), mit = blocks[n], notice = blocks[1 - n];
  assert.equal(notice.text, `a\nCopyright 2015 A\n\nIncludes sub.\n\nsub from https://example.org\n\nCopyright (c) 2010 Sub\n\n[MIT License text: see ${n + 1}.]`);
  assert.deepEqual(noticeProblems(entries, notices), []);
  assert.match(noticeProblems([{ label: 'x@1.0.0/LICENSE', text: 'Unlisted words.' }], notices)[0], /not listed/);
  assert.match(noticeProblems(entries, notices.replace('Includes sub.', ''))[0], /missing line: Includes sub\./);
  assert.match(noticeProblems(entries, notices + '\n== 3. MIT License ==\n  z@1.0.0\n\n' + mit.text + '\n')[0], /stored twice/);
});

test('the engine embeds the notices of html-slides and of every package bundled in it, each text once', async () => {
  const { metafile } = await build({ entryPoints: [path.join(root, 'src/engine/main.js')], bundle: true, write: false, metafile: true, format: 'iife', logLevel: 'silent' });
  const packages = bundledPackages([metafile]);
  assert.ok(packages.length >= 19, 'Moveable, Selecto and their dependencies are bundled');
  const engine = fs.readFileSync(path.join(root, 'plugin/skills/html-slides/assets/engine.js'), 'utf8');
  const notices = /^\/\*! [^\n]*\n([\s\S]*?)\*\//.exec(engine)[1];
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const entries = [{ label: `html-slides@${version}/LICENSE`, text: MIT }, ...packageEntries(packages)];
  assert.deepEqual(noticeProblems(entries, notices), []);
  assert.equal(notices.split('Permission is hereby granted, free of charge').length, 2, 'the MIT text is stored once');
  assert.doesNotMatch(notices, /THIRD_PARTY_NOTICES|Details:/, 'complete in the file, not behind a reference');
});

test('ECharts, loaded or embedded separately, keeps its licence header and shipped licence', () => {
  const assets = path.join(root, 'plugin/skills/html-slides/assets');
  assert.match(fs.readFileSync(path.join(assets, 'echarts.min.js'), 'utf8').slice(0, 600), /Licensed to the Apache Software Foundation[\s\S]*Apache License, Version 2\.0/);
  assert.match(fs.readFileSync(path.join(assets, 'ECHARTS-LICENSE.txt'), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /ECharts \(Apache License 2\.0/);
});
