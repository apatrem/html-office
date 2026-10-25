// Shared clipboard module (ADR-013, X02a): envelope, carriers, limits, table
// model, inert HTML reader and writers. Browser engines run the same reader
// in packages/data/tests/clipboard-engines.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseInert } from './helpers/inert-dom.mjs';
import {
  SCHEMA, MIME, LEGACY_MIME, LIMITS, ClipboardError,
  decodeEnvelope, validateTable, readTable, readClipboard, findEnvelope,
  tableHTML, writeClipboard, excelFormat, toTSV, tableText,
} from '../packages/shared/clipboard/index.mjs';

const fixture = name => readFileSync(new URL(`../packages/shared/clipboard/fixtures/${name}.html`, import.meta.url), 'utf8');
const read = html => readTable(parseInert(html));
// A DataTransfer as a paste event exposes it.
const transfer = flavours => ({ types: Object.keys(flavours), getData: type => flavours[type] ?? '' });
const options = { parse: parseInert, maxCells: 2000000 };
const table = {
  rows: [
    [{ text: 'Region', header: true }, { text: '2026', header: true, colspan: 2 }, { covered: true }],
    [{ text: 'North' }, { text: '1 234,5 €', value: { type: 'number', value: 1234.5 }, format: { kind: 'currency', currency: 'EUR', digits: 1 } },
      { text: '12 %', value: { type: 'number', value: 0.12 }, format: { kind: 'percent', digits: 0 }, bold: true, color: 'alert' }],
  ],
  headerRows: 1,
  totalRows: [],
  columns: [{ align: 'left', width: 30 }, { align: 'right', width: 35 }, { align: 'right', width: 35 }],
};
const envelope = { schema: SCHEMA, kind: 'table', source: { product: 'data', locale: 'fr-FR' }, table };

test('Excel for macOS: class-rule bold, colspan title, links, line breaks and displayed numbers', () => {
  const { table: t, dropped } = read(fixture('excel-macos'));
  validateTable(t);
  assert.equal(t.rows.length, 5);
  assert.equal(t.rows[0].length, 6);
  assert.deepEqual(t.rows[0].slice(0, 4), [{ text: 'Quarterly sales', colspan: 3, align: 'center' }, { covered: true }, { covered: true }, null]);
  assert.deepEqual(t.rows[1][0], { text: 'Region', bold: true });
  assert.deepEqual(t.rows[2][0], { text: 'North', link: { url: 'https://example.com/north' } });
  // Excel pads positive numbers for the ")" of negatives; the space is not text.
  assert.deepEqual(t.rows[2][1], { text: '1,235', align: 'right' });
  assert.equal(t.rows[2][4].text, '0012');
  assert.equal(t.rows[2][5].text, 'Line one\nline two');
  assert.deepEqual(t.rows[3][0], { text: 'South & West' });
  assert.equal(t.rows[3][1].text, '(5,000)');
  assert.deepEqual(t.rows[4][0], { text: 'Total', italic: true });
  assert.equal(t.headerRows, undefined);
  assert.equal(dropped.links, 0);
});

test('Google Sheets (French): inline bold, narrow no-break spaces and in-cell links', () => {
  const { table: t } = read(fixture('sheets-fr'));
  validateTable(t);
  assert.deepEqual(t.rows[0].map(c => c.bold), [true, true, true, true]);
  assert.deepEqual(t.rows[1].map(c => c.text), ['Nord', '1\u202f234,50', '12\u00a0%', '01/02/2026']);
  assert.deepEqual(t.rows[1][0].link, { url: 'https://example.com/nord' });
});

test('Word for macOS: paragraphs, mixed runs, unsafe and multiple links, trailing empty paragraph', () => {
  const { table: t, dropped } = read(fixture('word-macos'));
  validateTable(t);
  assert.deepEqual(t.rows[0][1], { text: 'Amount', bold: true, align: 'right' });
  assert.deepEqual(t.rows[1][0], { text: 'Revenue growth', runs: [{ text: 'Revenue ' }, { text: 'growth', bold: true }] });
  assert.equal(t.rows[1][2].text, 'First paragraph\nSecond paragraph');
  assert.deepEqual(t.rows[2][2].runs, [{ text: 'See this and ' }, { text: 'that', link: { url: 'https://example.org/a' } }]);
  // javascript: is never a link; its text stays.
  assert.equal(dropped.links, 1);
});

test('Google Docs: normal-weight wrapper, span weights, colspan and rowspan', () => {
  const { table: t } = read(fixture('docs'));
  validateTable(t);
  assert.deepEqual(t.rows[0], [{ text: 'Plan 2027', bold: true, colspan: 2, align: 'center' }, { covered: true }, { text: 'Owner', italic: true, rowspan: 2 }]);
  assert.deepEqual(t.rows[1], [{ text: 'Launch' }, { text: '2027-03-15', align: 'right' }, { covered: true }]);
  assert.deepEqual(t.rows[2][0], { text: 'Budget', link: { url: 'https://example.net/budget' } });
});

test('th and thead rows are header rows; mixed selections and several tables are not tables', () => {
  const { table: t } = read('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.equal(t.headerRows, 1);
  assert.equal(t.rows[0][0].header, true);
  assert.equal(read('<p>Intro</p><table><tr><td>1</td></tr></table>'), null);
  assert.equal(read('<table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>'), null);
  assert.equal(read('<b>no table</b>'), null);
  // Head content, comments and empty paragraphs are not text outside the table.
  assert.ok(read('<title>t</title><style>td{}</style><!-- c --><table><tr><td>1</td></tr></table><p>&nbsp;</p>'));
});

test('hostile HTML: scripts, handlers, hidden content and javascript: links are never content', () => {
  const { table: t, dropped } = read(`<table><tr>
    <td onclick="alert(1)">a<script>alert(2)</script><style>x{}</style></td>
    <td><a href="javascript:alert(3)">b</a><a href="data:text/html,x">c</a></td>
    <td><span style="display:none">secret</span>d<template>t</template></td>
    <td><img src="https://example.invalid/x.png" onerror="alert(4)">e</td></tr></table>`);
  assert.deepEqual(t.rows[0].map(c => c.text), ['a', 'bc', 'd', 'e']);
  assert.equal(t.rows[0][1].link, undefined);
  assert.equal(dropped.links, 2);
  assert.equal(JSON.stringify(t).includes('alert'), false);
});

test('deeply nested HTML is read without recursion', () => {
  const depth = 50000;
  const html = '<table><tr><td>' + '<span>'.repeat(depth) + 'deep' + '</span>'.repeat(depth) + '</td></tr></table>';
  assert.equal(read(html).table.rows[0][0].text, 'deep');
});

test('untrusted CSS is scanned in linear time', () => {
  const table = '<table><tr><td class="b">x</td></tr></table>';
  for (const css of ['x'.repeat(400000), '/*'.repeat(200000), '{'.repeat(400000), '.b{'.repeat(100000)]) {
    const start = performance.now();
    read(`<style>${css}</style>${table}`);
    assert.ok(performance.now() - start < 1000, css.slice(0, 4));
  }
  // Rules still apply after comments, HTML comment markers and at-rules.
  assert.equal(read(`<style><!-- /* c */ @page x{margin:0} .b{font-weight:700} --></style>${table}`).table.rows[0][0].bold, true);
});

test('spans are rejected before a grid is built', () => {
  const html = '<table><tr><td colspan="1000" rowspan="65534">x</td></tr>' + '<tr><td>y</td></tr>'.repeat(3000) + '</table>';
  const start = performance.now();
  assert.throws(() => readTable(parseInert(html), { maxCells: 2000000 }), /larger than 2,000,000 cells/);
  assert.ok(performance.now() - start < 2000);
  // HTML's own limits clamp larger spans.
  const { table: t } = read('<table><tr><td colspan="5000">x</td></tr></table>');
  assert.equal(t.rows[0][0].colspan, 1000);
});

test('table validator: all or nothing, allow-listed fields, spans and limits', () => {
  validateTable(structuredClone(table));
  const bad = [
    t => (t.rows[0][0].style = 'color:red'),
    t => (t.rows[0][0].color = '#f00'),
    t => (t.rows[1][0].link = { url: 'javascript:alert(1)' }),
    t => (t.rows[1][0].link = { url: 'https://example.com/' + 'x'.repeat(2048) }),
    t => (t.rows[0][2] = null),
    t => (t.rows[1][0] = { covered: true }),
    t => (t.rows[0][1].colspan = 3),
    t => (t.rows[1].pop()),
    t => (t.rows[1][1].value = { type: 'number', value: '12' }),
    t => (t.rows[1][0].runs = [{ text: 'Nor' }]),
    t => (t.rows[1][0] = JSON.parse('{"text":"x","__proto__":{"polluted":true}}')),
    t => (t.totalRows = [5]),
    t => (t.columns = [{ width: 50 }]),
    t => (t.extra = true),
    t => (t.rows[1][1].format = JSON.parse('{"kind":"number","__proto__":{"x":1}}')),
    t => (t.rows[1][1].format = { kind: 'number', digits: [2] }),
  ];
  for (const change of bad) {
    const t = structuredClone(table);
    change(t);
    assert.throws(() => validateTable(t), ClipboardError, change.toString());
  }
  assert.throws(() => validateTable(table, { maxCells: 5 }), /more than 5 cells/);
  assert.equal({}.polluted, undefined);
});

test('envelope: recognised, unknown major version skipped, malformed refused', () => {
  const text = JSON.stringify({ ...envelope, future: { anything: 1 } });
  const { envelope: e } = decodeEnvelope(text);
  assert.equal(e.kind, 'table');
  assert.equal(e.future, undefined, 'unknown members are ignored');
  assert.deepEqual(decodeEnvelope(JSON.stringify({ schema: 'html-office-clip/2', kind: 'hologram' })), { skipped: 'html-office-clip/2' });
  for (const broken of ['{', '[]', '{"kind":"table"}', JSON.stringify({ schema: SCHEMA, kind: 'table' }),
    JSON.stringify({ schema: SCHEMA, kind: 'image', table }), JSON.stringify({ ...envelope, table: { rows: [] } }),
    JSON.stringify({ ...envelope, source: { locale: 7 } })])
    assert.throws(() => decodeEnvelope(broken), ClipboardError, broken);
  assert.throws(() => decodeEnvelope(' '.repeat(LIMITS.json + 1)), /too large/);
});

test('reader precedence: custom type, HTML attribute, legacy range, HTML table, plain text', () => {
  const html = tableHTML(table, { envelope: JSON.stringify(envelope) });
  const range = { schema: 'html-office-range/1', origin: { row: 1, column: 1 }, cells: [[null]] };
  let r = readClipboard(transfer({ [MIME]: JSON.stringify(envelope), 'text/html': '<table data-html-office="{"><tr><td>x</td></tr></table>', 'text/plain': 'x' }), options);
  assert.equal(r.source, 'envelope');
  assert.equal(r.via, 'custom', 'the custom type wins; HTML is not even parsed');
  r = readClipboard(transfer({ 'text/html': html, 'text/plain': 'x' }), options);
  assert.deepEqual([r.source, r.via], ['envelope', 'html']);
  assert.deepEqual(r.envelope.table, table);
  r = readClipboard(transfer({ [LEGACY_MIME]: JSON.stringify(range), 'text/plain': 'x' }), options);
  assert.deepEqual([r.source, r.range], ['legacy', range]);
  r = readClipboard(transfer({ 'text/html': html.replace(/ data-html-office="[^"]*"/, ''), 'text/plain': 'x' }), options);
  assert.equal(r.source, 'table');
  assert.equal(r.table.rows[1][1].text, '1 234,5 €');
  r = readClipboard(transfer({ 'text/html': '<b>rich only</b>', 'text/plain': 'a\tb' }), options);
  assert.deepEqual([r.source, r.text], ['text', 'a\tb']);
  assert.equal(readClipboard(transfer({ 'text/html': '<b>x</b>' }), options).source, 'none');
});

test('a malformed html-office envelope aborts; an unknown version falls through with a notice', () => {
  const html = '<table><tr><td>1</td></tr></table>';
  assert.throws(() => readClipboard(transfer({ [MIME]: '{"schema":"html-office-clip/1","kind":"table","table":{"rows":"x"}}', 'text/html': html, 'text/plain': '1' }), options), ClipboardError);
  assert.throws(() => readClipboard(transfer({ 'text/html': '<table data-html-office="{&quot;schema&quot;:&quot;html-office-clip/1&quot;}"><tr><td>1</td></tr></table>', 'text/plain': '1' }), options), ClipboardError);
  const r = readClipboard(transfer({ [MIME]: '{"schema":"html-office-clip/9"}', 'text/html': html, 'text/plain': '1' }), options);
  assert.equal(r.source, 'table');
  assert.match(r.notices[0], /html-office-clip\/9/);
});

test('HTML over its limit is treated as absent; text over its limit is refused', () => {
  const big = '<table><tr><td>x</td></tr></table>' + ' '.repeat(LIMITS.html);
  assert.equal(readClipboard(transfer({ 'text/html': big, 'text/plain': 'x' }), options).source, 'text');
  assert.throws(() => readClipboard(transfer({ 'text/plain': 'x'.repeat(LIMITS.text + 1) }), options), /too large/);
});

test('HTML writer: semantic table, escaped envelope attribute, spans, links and exact-value hints', () => {
  const json = JSON.stringify({ ...envelope, note: '"quoted" <b>&amp;</b> \u2028' });
  const html = tableHTML(table, { envelope: json, locale: 'fr-FR' });
  assert.equal(findEnvelope(parseInert(html)), json, 'the attribute round-trips exactly');
  // Column alignment applies where a cell has none.
  assert.match(html, /<thead><tr><th style="text-align:left;">Region<\/th><th colspan="2" style="text-align:right;">2026<\/th><\/tr><\/thead><tbody>/);
  assert.match(html, /<\/tbody><\/table>$/);
  assert.match(html, /x:num="1234.5"/);
  assert.match(html, /data-sheets-value="\{&quot;1&quot;:3,&quot;3&quot;:1234.5\}"/);
  assert.match(html, /mso-number-format:'#,##0.0 &quot;€&quot;'/);
  assert.match(html, /<col style="width:30%">/);
  const linked = tableHTML({ rows: [[{ text: 'a <b> "c"\nd', link: { url: 'https://example.com/?a=1&b="2"' } }, { text: '0012', value: { type: 'text', value: '0012' } }]] });
  assert.match(linked, /<a href="https:\/\/example.com\/\?a=1&amp;b=&quot;2&quot;">a &lt;b&gt; "c"<br style="mso-data-placement:same-cell">d<\/a>/);
  assert.match(linked, /x:str style="mso-number-format:'\\@';"/, 'leading-zero text stays text in Excel');
  // The reader reads the writer's semantic table back.
  const back = read(tableHTML(table));
  assert.deepEqual(back.table.rows[0], [{ text: 'Region', bold: true, header: true, align: 'left' }, { text: '2026', bold: true, header: true, colspan: 2, align: 'right' }, { covered: true }]);
  // A table of header rows only stays a header and closes its <thead>.
  const heads = tableHTML({ rows: [[{ text: 'Only', header: true }]], headerRows: 1 });
  assert.match(heads, /<thead><tr><th>Only<\/th><\/tr><\/thead><\/table>$/);
  assert.equal(read(heads).table.headerRows, 1);
  assert.equal(tableHTML(table).includes('</body>'), false, 'no literal </body> in bundles');
});

test('Excel number formats for Data presets', () => {
  assert.equal(excelFormat({ kind: 'number', digits: 2 }, 'number'), '#,##0.00');
  assert.equal(excelFormat({ kind: 'number', digits: 0, negative: 'parentheses' }, 'number'), '#,##0;(#,##0)');
  assert.equal(excelFormat({ kind: 'percent', digits: 1 }, 'number'), '0.0%');
  assert.equal(excelFormat({ kind: 'currency', currency: 'USD', digits: 2 }, 'number', 'en-US'), '"$"#,##0.00');
  assert.equal(excelFormat({ kind: 'accounting', currency: 'EUR', digits: 0, scale: 'thousands' }, 'number', 'fr-FR'), '#,##0,"k" "€";(#,##0,"k" "€")');
  assert.equal(excelFormat({ kind: 'number', digits: 1, scale: 'millions', negative: 'red' }, 'number'), '#,##0.0,,"M";[Red]-#,##0.0,,"M"');
  assert.equal(excelFormat({ kind: 'date' }, 'date', 'fr-FR'), 'dd"/"mm"/"yyyy');
  assert.equal(excelFormat({ kind: 'date', dateStyle: 'long' }, 'date', 'en-US'), 'mmmm" "d", "yyyy');
  assert.equal(excelFormat(undefined, 'number'), null);
});

test('writeClipboard: every flavour from one copy, HTML left out above its limits', () => {
  const written = {};
  const data = { setData: (type, value) => (written[type] = value) };
  assert.deepEqual(writeClipboard(data, { envelope, table, text: 'a' }), { html: true });
  assert.deepEqual(Object.keys(written), [MIME, 'text/html', 'text/plain']);
  assert.deepEqual(JSON.parse(written[MIME]), envelope);
  const wide = { rows: [Array.from({ length: LIMITS.htmlCells + 1 }, () => ({ text: 'x' }))] };
  const only = {};
  writeClipboard({ setData: (type, value) => (only[type] = value) }, { envelope: { ...envelope, table: undefined, range: {} }, table: wide, text: 'x' });
  assert.deepEqual(Object.keys(only), [MIME, 'text/plain']);
  assert.throws(() => writeClipboard(data, { envelope, table, text: 'a', stringify: () => 'x'.repeat(LIMITS.json + 1) }), /too large/);
  assert.throws(() => writeClipboard(data, { envelope, table, text: 'x'.repeat(LIMITS.text + 1) }), /too large/);
});

test('TSV quoting as Excel writes it', () => {
  assert.equal(toTSV([['a', 'b\tc'], ['"q"', 'line\nbreak']]), 'a\t"b\tc"\n"""q"""\t"line\nbreak"');
  assert.equal(tableText(table), 'Region\t2026\t\nNorth\t1 234,5 €\t12 %');
});
