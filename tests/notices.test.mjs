import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { groupNotices, formatNotices, bundledPackages, packageAt, packageEntries } from '../packages/shared/notices.mjs';
import { noticeBlocks, noticeProblems } from '../packages/shared/notices-check.mjs';
import { withOffline } from '../plugin/skills/html-slides/tools/lib.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIT = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const body = MIT.slice(MIT.indexOf('Permission'));
const format = entries => formatNotices(groupNotices(entries), { title: 'Notices' });
const engineComment = js => /^\/\*! [^\n]*\n([\s\S]*?)\*\//.exec(js)[1];

test('a licence text is stored once with every package and copyright holder it covers', () => {
  const rewrapped = body.replace(/\n/g, ' ').replace(/\. /g, '.\n\n');
  const variant = body.replace('shall be included', 'shall be included (including the next paragraph)');
  const entries = [
    { label: 'a@1.0.0/LICENSE', text: `MIT License\n\nCopyright (c) 2020 A\n\n${body}` },
    { label: 'b@2.0.0/LICENSE-MIT', text: `Copyright (c) 2021 B\nCopyright (c) 2022 B2\n\n${rewrapped}` },
    // Different wording is never merged, however small the difference.
    { label: 'd@4.0.0/LICENSE', text: `Copyright (c) D\n\n${variant}` },
  ];
  const notices = format(entries), blocks = noticeBlocks(notices);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].packages, ['a@1.0.0', 'b@2.0.0']);
  assert.deepEqual(blocks[0].holders.get('b@2.0.0'), ['Copyright (c) 2021 B', 'Copyright (c) 2022 B2']);
  assert.deepEqual(blocks[1].holders.get('d@4.0.0'), ['Copyright (c) D']);
  assert.deepEqual(noticeProblems(entries, notices), []);
  // The checker binds wording and holders to their package: swapped labels fail.
  const swapped = [{ ...entries[0], label: 'd@4.0.0/LICENSE' }, entries[1], { ...entries[2], label: 'a@1.0.0/LICENSE' }];
  assert.ok(noticeProblems(swapped, notices).some(p => /^a@1\.0\.0.*including the next paragraph/.test(p)));
  assert.ok(noticeProblems(swapped, notices).some(p => /^d@4\.0\.0.*Copyright \(c\) 2020 A/.test(p)));
});

test('other sections stay together and point to the licence texts lifted out of them, whole or embedded', () => {
  const entries = [
    { label: 'a@1.0.0/LICENSE', text: `Copyright (c) A\n\n${body}` },
    { label: 'a@1.0.0/NOTICE', text: `a\nCopyright 2015 A\n\nIncludes sub.\n\n=====\n\nsub from https://example.org\n\n=====\n\nCopyright (c) 2010 Sub\n\n${body}` },
    { label: 'c@1.0.0/COPYING', text: `LICENSE: dual.\nAUTHORS-MIT:\n${body.replace(/^/gm, '    ')}\nCOPYRIGHT:\n    Copyright (C) 2017 C` },
  ];
  const notices = format(entries), blocks = noticeBlocks(notices);
  const n = blocks.findIndex(block => /^Permission/.test(block.text)) + 1;
  assert.equal(blocks.filter(block => block.text.includes('Permission is hereby')).length, 1);
  const texts = blocks.map(block => block.text);
  assert.ok(texts.includes(`a\nCopyright 2015 A\n\nIncludes sub.\n\nsub from https://example.org\n\nCopyright (c) 2010 Sub\n\n[MIT License text: see ${n}.]`));
  assert.ok(texts.includes(`LICENSE: dual.\nAUTHORS-MIT:\n    [MIT License text: see ${n}.]\n\nCOPYRIGHT:\n    Copyright (C) 2017 C`), texts.join('\n---\n'));
  assert.deepEqual(blocks[n - 1].packages, ['a@1.0.0', 'c@1.0.0']);
  assert.deepEqual(noticeProblems(entries, notices), []);
  assert.match(noticeProblems([{ label: 'x@1.0.0/LICENSE', text: 'Unlisted words.' }], notices)[0], /not listed/);
  assert.match(noticeProblems(entries, notices.replace('Includes sub.', ''))[0], /missing line: Includes sub\./);
  // Two different MIT wordings in one composite notice are not a duplicate.
  const variant = body.replace('shall be included', 'shall be included (including the next paragraph)');
  const composite = [{ label: 'e@1.0.0/NOTICE', text: `e\n\n=====\n\n${body}\n\n=====\n\n${variant}` }];
  assert.deepEqual(noticeProblems(composite, format(composite)), []);
  const twice = notices + `\n== 9. Notice ==\n  z@1.0.0\n\nPreamble.\n\n${body}\n`;
  assert.ok(noticeProblems(entries, twice).some(p => /stored twice/.test(p)));
});

test('a package without a licence file cites the canonical text with every holder of its banner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
  const pkg = (name, json, files) => {
    const d = path.join(dir, 'node_modules', name);
    fs.mkdirSync(path.join(d, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...json }));
    for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(d, file), text);
    return d;
  };
  const host = pkg('host', { dependencies: { vendored: '1.0.0', unused: '1.0.0' } }, {
    'dist/host.js': '/*\nCopyright (c) 2020 Host\nCopyright (c) 2021 Helper and\n  2022 Other\nname: host\nlicense: MIT\n*/\n' +
      '/*\nCopyright (c) NAVER\nname: inlined\nlicense: MIT\nversion: 2.0.0\n*/\n' +
      '/*! Copyright (c) Microsoft Corporation.\nLicensed under the Apache License, Version 2.0 (the "License"); */\nx();'
  });
  pkg('vendored', {}, { LICENSE: `Copyright (c) Vendor\n\n${body}` });
  // An installed copy of another version does not lend its licence file.
  pkg('inlined', { version: '3.0.0' }, { LICENSE: `Copyright (c) Someone else\n\n${body}` });
  // A dependency without a licence file is attributed from its own banner.
  pkg('unused', { main: 'dist/unused.js' }, { 'dist/unused.js': '/*\nCopyright (c) Unused\nname: unused\nlicense: MIT\n*/' });
  const entries = packageEntries([{ ...packageAt(host), files: [path.join(host, 'dist/host.js')] }]);
  const text = label => entries.find(e => e.label === label)?.text ?? '';
  assert.match(text('host@1.0.0'), /^Copyright \(c\) 2020 Host\nCopyright \(c\) 2021 Helper and 2022 Other\n\nPermission is hereby granted/);
  assert.ok(!entries.some(e => /Someone else/.test(e.text)));
  assert.match(text('unused@1.0.0'), /^Copyright \(c\) Unused\n\nPermission/);
  assert.match(text('inlined@2.0.0'), /^Copyright \(c\) NAVER\n\nPermission/);
  assert.match(text('vendored@1.0.0/LICENSE'), /Copyright \(c\) Vendor/);
  assert.match(text('host@1.0.0/dist/host.js#3'), /Microsoft Corporation/);
  assert.match(text('host@1.0.0/Apache-2.0'), /END OF TERMS AND CONDITIONS/);
  fs.writeFileSync(path.join(host, 'dist/host.js'), 'x();');
  assert.throws(() => packageEntries([{ ...packageAt(host), files: [path.join(host, 'dist/host.js')] }]), /no licence file/);
  fs.rmSync(dir, { recursive: true });
});

test('the engine embeds the notices of html-slides, every package bundled or inlined in it and ECharts, each text once', async () => {
  const { metafile } = await build({ entryPoints: [path.join(root, 'src/engine/main.js')], bundle: true, write: false, metafile: true, format: 'iife', logLevel: 'silent' });
  const packages = bundledPackages([metafile]);
  assert.ok(packages.length >= 19, 'Moveable, Selecto and their dependencies are bundled');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const echarts = packageAt(path.join(root, 'node_modules/echarts'), [path.join(root, 'node_modules/echarts/dist/echarts.min.js')]);
  const entries = [{ label: `html-slides@${version}/LICENSE`, text: MIT }, ...packageEntries([...packages, echarts])];
  // An offline deck, which embeds ECharts beside the engine, carries all of it.
  const engine = fs.readFileSync(path.join(root, 'plugin/skills/html-slides/assets/engine.js'), 'utf8');
  const example = fs.readFileSync(path.join(root, 'plugin/skills/html-slides/examples/community-garden.html'), 'utf8');
  const deck = withOffline(example.replace(/(<script id="engine"[^>]*>)[\s\S]*?(<\/script>)/, (_, open, close) => open + '\n' + engine + '\n' + close), true);
  assert.match(deck, /<script id="echarts">/);
  const notices = engineComment(/<script id="engine"[^>]*>\n?([\s\S]*?)<\/script>/.exec(deck)[1]);
  assert.deepEqual(noticeProblems(entries, notices), []);
  const listed = new Set(noticeBlocks(notices).flatMap(block => block.packages));
  for (const name of [...packages.map(p => `${p.name}@${p.version}`), 'echarts@6.1.0', 'zrender@6.1.0', 'keycode@2.2.1', '@egjs/component@3.0.2', '@cfcs/core@0.0.6'])
    assert.ok(listed.has(name), name);
  assert.match(notices, /This product includes software developed at\nThe Apache Software Foundation/);
  assert.equal(notices.split('Permission is hereby granted, free of charge').length, 2, 'the MIT text is stored once');
  assert.equal(notices.split('TERMS AND CONDITIONS FOR USE').length, 2, 'the Apache text is stored once');
  assert.doesNotMatch(notices, /THIRD_PARTY_NOTICES|Details:/, 'complete in the file, not behind a reference');
});
