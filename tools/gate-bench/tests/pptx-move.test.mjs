// The .pptx side of the scripted move, on a package written by hand in this file (fictional
// content). Needs the system's zip and unzip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPackage, deckOutline, slideShapes, moveDeck, checkMoves, writeParts, TOLERANCE } from '../lib/pptx.mjs';
import { parse, descendants, splice } from '../lib/xml.mjs';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const W = 12192000, H = 6858000;
const xfrm = (x, y, cx, cy) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const box = (id, name, geometry, text) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${geometry}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${text === null ? '' : `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>`}</p:sp>`;
const title = text => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const frame = (id, name, x, y, cx, cy, data) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm><a:graphic><a:graphicData uri="x">${data}</a:graphicData></a:graphic></p:graphicFrame>`;
const chart = '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/>';
const table = '<a:tbl><a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Fees</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>';
const slide = shapes => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
const rels = list => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

const SLIDE1 = slide([
  title('Three messages for the committee (fictional)'),
  box(3, 'Card back', xfrm(6096000, 4000000, 4000000, 1200000), null),
  box(4, 'Card text', xfrm(6196000, 4100000, 3800000, 1000000), 'Decision requested: release the training budget &amp; start'),
  box(5, 'Message 1', xfrm(600000, 1600000, 5000000, 600000), 'Schedule: 7 sites are live'),
  box(6, 'Page background', xfrm(0, 0, W, H), null),
  frame(7, 'Chart 6', 600000, 2400000, 5000000, 3000000, chart)
].join(''));
const SLIDE2 = slide([title('Fees total 246,000 (fictional)'), frame(3, 'Table 2', 700000, 1700000, 9000000, 2500000, table), box(4, 'Note', xfrm(700000, 4500000, 3000000, 500000), 'Payment in three parts')].join(''));
const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(600000, 400000, 10000000, 900000)}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`;

function build(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-pptx-test-'));
  const files = {
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', 'slides/slide2.xml']]),
    'ppt/slides/slide1.xml': SLIDE1,
    'ppt/slides/slide2.xml': SLIDE2,
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'chart', '../charts/chart1.xml']]),
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': LAYOUT,
    ...extra
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'src', name)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', name), text);
  }
  const file = path.join(dir, 'deck.pptx');
  execFileSync('zip', ['-X', '-r', '-q', file, '.'], { cwd: path.join(dir, 'src') });
  return { dir, file };
}
const MOVE = { dx: -0.02, dy: -0.02, targets: [
  { slide: 1, kind: 'text', contains: 'Decision requested', label: 'the decision box' },
  { slide: 1, kind: 'chart', label: 'the chart' },
  { slide: 2, kind: 'table', label: 'the table' }
] };
const DX = Math.round(-0.02 * W), DY = Math.round(-0.02 * H);
const offsets = (file, part) => Object.fromEntries(slideShapes(openPackage(file), part).shapes.map(shape => [shape.name, shape.box && [shape.box.x, shape.box.y]]));

test('the outline gives the slides in order and the slide size', () => {
  const { file } = build();
  assert.deepEqual(deckOutline(openPackage(file)), { slides: ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'], width: W, height: H });
});

test('a title placeholder without geometry takes the layout\'s', () => {
  const { file } = build();
  const shape = slideShapes(openPackage(file), 'ppt/slides/slide1.xml').shapes[0];
  assert.deepEqual(shape.box, { x: 600000, y: 400000, cx: 10000000, cy: 900000 });
  assert.equal(shape.inherited, true);
});

test('the move shifts the named shapes, their backing shape, and nothing else', () => {
  const { dir, file } = build();
  const moved = path.join(dir, 'moved.pptx');
  const result = moveDeck(file, moved, MOVE);
  assert.deepEqual(result.targets.map(target => target.resolved), [true, true, true]);
  assert.deepEqual(result.targets[0].shapes.map(shape => shape.name), ['Card text', 'Card back'], 'the text and the card behind it, not the page background');
  const before = offsets(file, 'ppt/slides/slide1.xml'), after = offsets(moved, 'ppt/slides/slide1.xml');
  for (const name of ['Card text', 'Card back', 'Chart 6']) assert.deepEqual(after[name], [before[name][0] + DX, before[name][1] + DY], name);
  for (const name of ['Title 1', 'Message 1', 'Page background']) assert.deepEqual(after[name], before[name], name);
  assert.deepEqual(offsets(moved, 'ppt/slides/slide2.xml')['Table 2'], [700000 + DX, 1700000 + DY]);
  assert.deepEqual(offsets(file, 'ppt/slides/slide2.xml')['Table 2'], [700000, 1700000], 'the source file is untouched');
  // Only the offsets changed in the slide part.
  const strip = text => text.replace(/<a:off [^>]*\/>/g, '<a:off/>');
  assert.equal(strip(openPackage(moved).read('ppt/slides/slide1.xml')), strip(SLIDE1));
  assert.equal(openPackage(moved).read('ppt/slideLayouts/slideLayout1.xml'), LAYOUT);
});

test('moving an inherited placeholder writes its own geometry', () => {
  const { dir, file } = build();
  const moved = path.join(dir, 'moved.pptx');
  const result = moveDeck(file, moved, { dx: 0.05, dy: 0, targets: [{ slide: 2, kind: 'text', contains: 'Fees total', label: 'the title' }] });
  assert.equal(result.targets[0].resolved, true);
  const source = openPackage(moved).read('ppt/slides/slide2.xml');
  assert.match(source, /<p:spPr><a:xfrm><a:off x="1209600" y="400000"\/><a:ext cx="10000000" cy="900000"\/><\/a:xfrm><\/p:spPr>/);
  assert.equal(checkMoves(moved, result).kept, true);
});

test('a target that is not on the slide is reported, not guessed', () => {
  const { dir, file } = build();
  const result = moveDeck(file, path.join(dir, 'moved.pptx'), { dx: 0.02, dy: 0.02, targets: [
    { slide: 2, kind: 'chart', label: 'a chart that does not exist' }, { slide: 9, kind: 'table', label: 'no such slide' }, { slide: 1, kind: 'text', contains: 'no such words', label: 'x' }] });
  assert.deepEqual(result.targets.map(target => target.resolved), [false, false, false]);
  const check = checkMoves(path.join(dir, 'moved.pptx'), result);
  assert.deepEqual([check.applied, check.notApplied, check.kept], [0, 3, null], 'nothing applied: nothing measured');
});

test('after the edits: kept, lost, and found again under another identity', () => {
  const { dir, file } = build();
  const moved = path.join(dir, 'moved.pptx');
  const result = moveDeck(file, moved, MOVE);
  assert.equal(checkMoves(moved, result).kept, true, 'an untouched file keeps its moves');

  const edit = (name, change) => {
    const edited = path.join(dir, `${name}.pptx`);
    fs.copyFileSync(moved, edited);
    const pkg = openPackage(edited);
    writeParts(edited, change(pkg));
    return checkMoves(edited, result);
  };
  // A text edit elsewhere and a resized chart: the corner did not move.
  let check = edit('text', pkg => ({ 'ppt/slides/slide1.xml': pkg.read('ppt/slides/slide1.xml').replace('7 sites are live', '8 sites are live').replace('cx="5000000" cy="3000000"', 'cx="5200000" cy="3100000"') }));
  assert.equal(check.kept, true);
  // The chart is put back on the grid: lost.
  check = edit('reset', pkg => ({ 'ppt/slides/slide1.xml': pkg.read('ppt/slides/slide1.xml').replace(`<a:off x="${600000 + DX}" y="${2400000 + DY}"/>`, '<a:off x="600000" y="2400000"/>') }));
  assert.equal(check.kept, false);
  assert.deepEqual(check.targets.map(target => target.kept), [true, false, true]);
  // Within the tolerance, and just outside it.
  const nudge = emu => edit(`nudge${emu}`, pkg => ({ 'ppt/slides/slide2.xml': pkg.read('ppt/slides/slide2.xml').replace(`<a:off x="${700000 + DX}"`, `<a:off x="${700000 + DX + emu}"`) }));
  assert.equal(nudge(Math.floor(TOLERANCE.x * W)).kept, true);
  assert.equal(nudge(Math.ceil(TOLERANCE.x * W) + 1).kept, false);
  // The deck is rebuilt: other ids and names, same text and positions.
  check = edit('rebuilt', pkg => ({ 'ppt/slides/slide1.xml': pkg.read('ppt/slides/slide1.xml').replace('id="4" name="Card text"', 'id="14" name="TextBox 13"').replace('id="3" name="Card back"', 'id="13" name="Shape 12"') }));
  assert.equal(check.targets[0].shapes[0].how, 'same kind and same text');
  assert.equal(check.targets[0].shapes[1].found, false, 'a shape without text and without its identity cannot be found again');
  assert.equal(check.kept, false);
  // A slide is inserted before: the parts keep their names, the order changes.
  check = edit('inserted', pkg => ({
    'ppt/presentation.xml': pkg.read('ppt/presentation.xml').replace('<p:sldId id="256" r:id="rId2"/>', '<p:sldId id="258" r:id="rId4"/><p:sldId id="256" r:id="rId2"/>'),
    'ppt/_rels/presentation.xml.rels': pkg.read('ppt/_rels/presentation.xml.rels').replace('</Relationships>', '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/></Relationships>'),
    'ppt/slides/slide3.xml': slide(title('A new slide (fictional)'))
  }));
  assert.equal(check.kept, true);
  // The table is deleted: lost.
  check = edit('deleted', pkg => {
    const source = pkg.read('ppt/slides/slide2.xml');
    const node = descendants(parse(source), 'p:graphicFrame')[0];
    return { 'ppt/slides/slide2.xml': splice(source, [{ start: node.start, end: node.end, text: '' }]) };
  });
  assert.deepEqual(check.targets.map(target => target.kept), [true, true, false]);
});

test('a chart rebuilt on a renamed slide part is found by its slide', () => {
  const { dir, file } = build();
  const moved = path.join(dir, 'moved.pptx');
  const result = moveDeck(file, moved, MOVE);
  const edited = path.join(dir, 'renamed.pptx');
  fs.copyFileSync(moved, edited);
  const pkg = openPackage(edited);
  writeParts(edited, {
    'ppt/_rels/presentation.xml.rels': pkg.read('ppt/_rels/presentation.xml.rels').replace('slides/slide1.xml', 'slides/slide9.xml'),
    'ppt/slides/slide9.xml': pkg.read('ppt/slides/slide1.xml').replace('id="7" name="Chart 6"', 'id="70" name="Chart 69"'),
    'ppt/slides/_rels/slide9.xml.rels': pkg.read('ppt/slides/_rels/slide1.xml.rels')
  });
  const check = checkMoves(edited, result);
  assert.equal(check.targets[1].shapes[0].how, 'the only one of its kind on the most similar slide');
  assert.equal(check.targets[1].kept, true);
});

// ---- cases found by the cross-lineage review of pull request #134 ----
const PIC = (id, name, x, y, cx, cy) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr>${xfrm(x, y, cx, cy)}</p:spPr></p:pic>`;
const body = (idx, spPr) => `<p:sp><p:nvSpPr><p:cNvPr id="${10 + idx}" name="Body ${idx}"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${idx}"/></p:nvPr></p:nvSpPr>${spPr}<p:txBody><a:bodyPr/><a:p><a:r><a:t>Body number ${idx}</a:t></a:r></a:p></p:txBody></p:sp>`;
const layoutWith = shapes => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sldLayout>`;

test('a placeholder inherits from the layout placeholder with the same index, not the first of its type', () => {
  const { file } = build({
    'ppt/slides/slide2.xml': slide(body(2, '<p:spPr/>')),
    'ppt/slideLayouts/slideLayout1.xml': layoutWith(body(1, `<p:spPr>${xfrm(1000000, 500000, 4000000, 3000000)}</p:spPr>`) + body(2, `<p:spPr>${xfrm(7000000, 500000, 4000000, 3000000)}</p:spPr>`))
  });
  assert.equal(slideShapes(openPackage(file), 'ppt/slides/slide2.xml').shapes[0].box.x, 7000000);
});

test('a transform without offset is completed in place, and attributes are kept', () => {
  const layout = layoutWith(body(1, `<p:spPr>${xfrm(1000000, 500000, 4000000, 3000000)}</p:spPr>`) + body(2, `<p:spPr>${xfrm(7000000, 500000, 4000000, 3000000)}</p:spPr>`));
  const moving = (spPr, contains) => {
    const { dir, file } = build({ 'ppt/slides/slide2.xml': slide(body(1, spPr)), 'ppt/slideLayouts/slideLayout1.xml': layout });
    const moved = path.join(dir, 'moved.pptx');
    const result = moveDeck(file, moved, { dx: 0.05, dy: 0, targets: [{ slide: 2, kind: 'text', contains, label: 'a placeholder' }] });
    assert.equal(result.targets[0].resolved, true);
    assert.equal(checkMoves(moved, result).kept, true);
    return openPackage(moved).read('ppt/slides/slide2.xml');
  };
  const geometry = '<a:off x="1609600" y="500000"/><a:ext cx="4000000" cy="3000000"/>';
  let source = moving('<p:spPr><a:xfrm rot="5400000"/></p:spPr>', 'Body number 1');
  assert.ok(source.includes(`<p:spPr><a:xfrm rot="5400000">${geometry}</a:xfrm></p:spPr>`), 'a self-closing transform keeps its rotation');
  assert.equal(source.match(/<a:xfrm/g).length, 1, 'one transform, not two');
  source = moving('<p:spPr><a:xfrm flipH="1"></a:xfrm><a:noFill/></p:spPr>', 'Body number 1');
  assert.ok(source.includes(`<p:spPr><a:xfrm flipH="1">${geometry}</a:xfrm><a:noFill/></p:spPr>`), 'an empty transform is filled');
  source = moving('<p:spPr bwMode="auto"/>', 'Body number 1');
  assert.ok(source.includes(`<p:spPr bwMode="auto"><a:xfrm>${geometry}</a:xfrm></p:spPr>`), 'a self-closing holder keeps its attributes');
});

test('a chart or a table is not guessed among several candidates', () => {
  const target = { dx: 0.02, dy: 0.02, targets: [{ slide: 2, kind: 'chart', label: 'the chart' }] };
  const resolved = shapes => { const { dir, file } = build({ 'ppt/slides/slide2.xml': slide(shapes) }); return moveDeck(file, path.join(dir, 'moved.pptx'), target).targets[0]; };
  const background = PIC(20, 'Background', 0, 0, W, H), picture = PIC(21, 'Chart picture', 600000, 2000000, 5000000, 3000000);
  assert.deepEqual(resolved(background + picture).shapes.map(shape => shape.name), ['Chart picture'], 'the chart drawn as a picture, not the page background');
  assert.equal(resolved(background).resolved, false, 'a background alone is not a chart');
  assert.equal(resolved(picture + PIC(22, 'Logo', 11000000, 200000, 800000, 400000)).resolved, false, 'two pictures: not guessed');
  assert.equal(resolved(frame(23, 'Chart A', 0, 0, 100, 100, chart) + frame(24, 'Chart B', 0, 0, 100, 100, chart)).resolved, false, 'two charts: not guessed');
  assert.deepEqual(resolved(background + picture + frame(25, 'Chart 1', 600000, 2000000, 5000000, 3000000, chart)).shapes.map(shape => shape.name), ['Chart 1'], 'a chart object wins over pictures');
  const { dir, file } = build({ 'ppt/slides/slide2.xml': slide(frame(26, 'T1', 0, 0, 100, 100, table) + frame(27, 'T2', 0, 0, 100, 100, table)) });
  assert.equal(moveDeck(file, path.join(dir, 'moved.pptx'), { dx: 0.02, dy: 0.02, targets: [{ slide: 2, kind: 'table', label: 'the table' }] }).targets[0].resolved, false, 'two tables: not guessed');
});

test('a shape whose text and name were both edited is found by its identifier', () => {
  const { dir, file } = build();
  const moved = path.join(dir, 'moved.pptx');
  const result = moveDeck(file, moved, { dx: -0.02, dy: -0.02, targets: [{ slide: 1, kind: 'text', contains: 'Schedule: 7 sites', label: 'a message' }] });
  const edited = path.join(dir, 'edited.pptx');
  fs.copyFileSync(moved, edited);
  writeParts(edited, { 'ppt/slides/slide1.xml': openPackage(edited).read('ppt/slides/slide1.xml').replace('name="Message 1"', 'name="Text 9"').replace('Schedule: 7 sites are live', 'Schedule: 8 sites are live') });
  const check = checkMoves(edited, result);
  assert.deepEqual([check.kept, check.targets[0].shapes[0].how], [true, 'same identifier in the same slide part']);
});

test('a file that is not a readable presentation is the file\'s failure, not an error of the bench', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-pptx-test-'));
  fs.writeFileSync(path.join(dir, 'broken.pptx'), 'this is not a zip archive');
  assert.throws(() => moveDeck(path.join(dir, 'broken.pptx'), path.join(dir, 'moved.pptx'), MOVE), error => error.code === 'UNREADABLE');
  const { file } = build({ 'ppt/slides/slide2.xml': '<p:sld><p:cSld><p:spTree></p:cSld></p:sld>' });
  assert.throws(() => moveDeck(file, path.join(dir, 'moved2.pptx'), MOVE), error => error.code === 'UNREADABLE', 'a slide part that is not well-formed');
});
