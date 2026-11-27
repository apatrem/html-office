// The .pptx side of the scripted move (ADR-016 §3): find the shapes a brief names, shift their
// offsets in the slide XML as a person dragging them in PowerPoint would, and later check that
// they are still where the move left them. Reads and rewrites the package with the system's
// `unzip` and `zip`; only the slide parts that change are replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, child, descendants, inner, decode, splice } from './xml.mjs';

const SHAPE_TAGS = ['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp'];
// The tolerance of the html-slides checker (1.5 px on a 1,280 × 720 slide), as a fraction.
export const TOLERANCE = { x: 1.5 / 1280, y: 1.5 / 720 };

export function openPackage(file) {
  const run = args => execFileSync('unzip', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const entries = run(['-Z1', file]).split('\n').filter(Boolean);
  const cache = new Map();
  return {
    file,
    entries,
    has: name => entries.includes(name),
    read(name) {
      if (!entries.includes(name)) return null;
      // unzip reads [ ] * ? in a name as a pattern.
      if (!cache.has(name)) cache.set(name, run(['-p', file, name.replace(/[[\]*?\\]/g, '\\$&')]));
      return cache.get(name);
    }
  };
}

// Replaces parts of the package in place. `parts`: { 'ppt/slides/slide3.xml': '<xml…>' }.
export function writeParts(file, parts) {
  const names = Object.keys(parts);
  if (!names.length) return;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-pptx-'));
  try {
    for (const name of names) {
      fs.mkdirSync(path.dirname(path.join(stage, name)), { recursive: true });
      fs.writeFileSync(path.join(stage, name), parts[name]);
    }
    execFileSync('zip', ['-X', '-q', path.resolve(file), ...names], { cwd: stage });
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

const resolvePart = (base, target) => (target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(base), target)));
const relsOf = part => path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');

function relationships(pkg, part) {
  const source = pkg.read(relsOf(part));
  if (!source) return [];
  return parse(source).children.filter(node => node.name === 'Relationship' && node.attrs.TargetMode !== 'External')
    .map(node => ({ id: node.attrs.Id, type: node.attrs.Type ?? '', target: resolvePart(part, node.attrs.Target) }));
}

// Slides in presentation order, and the slide size in EMU.
export function deckOutline(pkg) {
  const source = pkg.read('ppt/presentation.xml');
  if (!source) throw new Error('not a presentation: ppt/presentation.xml is missing');
  const root = parse(source);
  const rels = new Map(relationships(pkg, 'ppt/presentation.xml').map(rel => [rel.id, rel.target]));
  const size = child(root, 'p:sldSz');
  if (!size) throw new Error('ppt/presentation.xml has no slide size');
  const slides = descendants(child(root, 'p:sldIdLst') ?? { children: [] }, 'p:sldId').map(node => rels.get(node.attrs['r:id'])).filter(Boolean);
  return { slides, width: Number(size.attrs.cx), height: Number(size.attrs.cy) };
}

export const normalise = text => String(text ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
  .replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

function textOf(source, node) {
  return descendants(node, 'a:p').map(p => descendants(p, 'a:t').map(t => decode(inner(source, t))).join('')).filter(Boolean).join('\n');
}

function geometry(node) {
  const holder = node.name === 'p:graphicFrame' ? node : node.name === 'p:grpSp' ? child(node, 'p:grpSpPr') : child(node, 'p:spPr');
  const xfrm = holder && child(holder, node.name === 'p:graphicFrame' ? 'p:xfrm' : 'a:xfrm');
  const off = xfrm && child(xfrm, 'a:off');
  const ext = xfrm && child(xfrm, 'a:ext');
  if (!off || !ext) return { holder, off: null, box: null };
  return { holder, off, box: { x: Number(off.attrs.x), y: Number(off.attrs.y), cx: Number(ext.attrs.cx), cy: Number(ext.attrs.cy) } };
}

function describe(source, node) {
  const nv = node.children.find(c => /^p:nv\w+Pr$/.test(c.name));
  const cNvPr = nv && child(nv, 'p:cNvPr');
  const ph = nv && descendants(nv, 'p:ph')[0];
  const chart = descendants(node, 'c:chart')[0] ?? descendants(node, 'cx:chart')[0];
  const geo = geometry(node);
  return {
    node, tag: node.name, id: cNvPr?.attrs.id ?? null, name: cNvPr?.attrs.name ?? '',
    placeholder: ph ? { type: ph.attrs.type ?? 'body', idx: ph.attrs.idx ?? null } : null,
    text: textOf(source, node), chart: !!chart, table: descendants(node, 'a:tbl').length > 0,
    picture: node.name === 'p:pic', holder: geo.holder, off: geo.off, box: geo.box, inherited: false
  };
}

function shapeTree(source) {
  const root = parse(source);
  const tree = child(child(root, 'p:cSld'), 'p:spTree');
  if (!tree) throw new Error('slide without a shape tree');
  return tree.children.filter(node => SHAPE_TAGS.includes(node.name)).map(node => describe(source, node));
}

// A placeholder without its own geometry takes the layout's, then the master's.
function inheritedBox(pkg, part, placeholder, depth = 0) {
  if (depth > 1) return null;
  const parent = relationships(pkg, part).find(rel => /\/(slideLayout|slideMaster)$/.test(rel.type));
  const source = parent && pkg.read(parent.target);
  if (!source) return null;
  const titles = ['title', 'ctrTitle'];
  const same = shape => shape.placeholder && ((placeholder.idx !== null && shape.placeholder.idx === placeholder.idx)
    || shape.placeholder.type === placeholder.type || (titles.includes(placeholder.type) && titles.includes(shape.placeholder.type)));
  const match = shapeTree(source).find(same);
  return match?.box ?? inheritedBox(pkg, parent.target, placeholder, depth + 1);
}

// Every top-level shape of a slide part, with its text, kind and box in EMU.
export function slideShapes(pkg, part) {
  const source = pkg.read(part);
  if (!source) throw new Error(`${part} is missing`);
  const shapes = shapeTree(source);
  for (const shape of shapes) {
    shape.part = part;
    if (!shape.box && shape.placeholder) { shape.box = inheritedBox(pkg, part, shape.placeholder); shape.inherited = !!shape.box; }
  }
  return { source, shapes };
}

const area = box => box.cx * box.cy;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.cx <= b.x + b.cx && a.y + a.cy <= b.y + b.cy;

// The shapes that one target of a brief designates on a slide, as a person would grab them: the
// shape that carries the text (or the chart, or the table), what sits on it, and its backing shape
// with what that carries.
export function resolveTarget(shapes, target, slideArea) {
  const placed = shapes.filter(shape => shape.box);
  let anchor = null;
  if (target.kind === 'chart') {
    const charts = placed.filter(shape => shape.chart);
    const pictures = placed.filter(shape => shape.picture).sort((a, b) => area(b.box) - area(a.box));
    anchor = charts[0] ?? pictures[0] ?? null;
    return anchor ? [anchor] : [];
  }
  if (target.kind === 'table') {
    anchor = placed.find(shape => shape.table) ?? null;
    return anchor ? [anchor] : [];
  }
  if (target.kind !== 'text') throw new Error(`unknown target kind ${target.kind}`);
  const wanted = normalise(target.contains);
  anchor = placed.filter(shape => normalise(shape.text).includes(wanted)).sort((a, b) => area(a.box) - area(b.box))[0] ?? null;
  if (!anchor) return [];
  // A backing shape: a shape without text that encloses the anchor and is not a page background.
  const backing = placed.filter(shape => shape !== anchor && !shape.text && shape.tag !== 'p:cxnSp' && inside(anchor.box, shape.box)
    && area(shape.box) <= 4 * area(anchor.box) && area(shape.box) < 0.6 * slideArea).sort((a, b) => area(a.box) - area(b.box))[0] ?? null;
  const frame = backing ?? anchor;
  const carried = placed.filter(shape => shape !== frame && shape !== anchor && shape.tag !== 'p:cxnSp' && inside(shape.box, frame.box));
  return [anchor, ...(backing ? [backing] : []), ...carried];
}

function offsetEdit(shape, x, y) {
  if (shape.off) return { start: shape.off.start, end: shape.off.end, text: `<a:off x="${x}" y="${y}"/>` };
  // An inherited placeholder gets its own geometry, as PowerPoint writes it when the shape is dragged.
  const xfrm = `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${shape.box.cx}" cy="${shape.box.cy}"/></a:xfrm>`;
  const holder = shape.holder;
  if (!holder || shape.tag === 'p:graphicFrame') throw new Error(`shape ${shape.id} has no geometry to move`);
  if (holder.selfClosing) return { start: holder.start, end: holder.end, text: `<${holder.name}>${xfrm}</${holder.name}>` };
  return { start: holder.openEnd, end: holder.openEnd, text: xfrm };
}

const record = shape => ({ part: shape.part, tag: shape.tag, id: shape.id, name: shape.name, text: shape.text, chart: shape.chart, table: shape.table });

// Applies a brief's move to a copy of the deck. Returns one entry per target, with the shapes
// moved and their boxes before and after, as fractions of the slide.
export function moveDeck(source, destination, move) {
  if (path.resolve(source) !== path.resolve(destination)) fs.copyFileSync(source, destination);
  const pkg = openPackage(destination);
  const outline = deckOutline(pkg);
  const dx = Math.round(move.dx * outline.width);
  const dy = Math.round(move.dy * outline.height);
  const edits = new Map();
  const taken = new Set();
  const results = move.targets.map(target => {
    const part = outline.slides[target.slide - 1];
    const result = { ...target, resolved: false, shapes: [] };
    if (!part) return { ...result, reason: `the deck has no slide ${target.slide}` };
    const { shapes } = slideShapes(pkg, part);
    const texts = shapes.map(shape => shape.text).filter(Boolean);
    const chosen = resolveTarget(shapes, target, outline.width * outline.height).filter(shape => !taken.has(`${part}#${shapes.indexOf(shape)}`));
    if (!chosen.length) return { ...result, reason: 'no matching shape on the slide' };
    for (const shape of chosen) {
      taken.add(`${part}#${shapes.indexOf(shape)}`);
      const after = { ...shape.box, x: shape.box.x + (target.dx !== undefined ? Math.round(target.dx * outline.width) : dx), y: shape.box.y + (target.dy !== undefined ? Math.round(target.dy * outline.height) : dy) };
      if (!edits.has(part)) edits.set(part, []);
      edits.get(part).push(offsetEdit(shape, after.x, after.y));
      result.shapes.push({ ...record(shape), before: fraction(shape.box, outline), after: fraction(after, outline), slideTexts: texts });
    }
    return { ...result, resolved: true };
  });
  const parts = {};
  for (const [part, list] of edits) parts[part] = splice(pkg.read(part), list);
  writeParts(destination, parts);
  return { width: outline.width, height: outline.height, slides: outline.slides.length, targets: results };
}

const fraction = (box, outline) => ({ x: box.x / outline.width, y: box.y / outline.height, w: box.cx / outline.width, h: box.cy / outline.height });

function overlap(a, b) {
  const A = new Set(a.map(normalise)), B = new Set(b.map(normalise));
  const shared = [...A].filter(text => B.has(text)).length;
  return A.size + B.size === 0 ? 0 : shared / (A.size + B.size - shared);
}

// Finds a moved shape again after the edits. In order: the same shape in the same slide part; a
// shape of the same kind with the same text anywhere; for a chart or a table, the only one of its
// kind on the slide that resembles the original most.
function findAgain(deck, moved) {
  const kind = shape => (shape.chart ? 'chart' : shape.table ? 'table' : shape.tag);
  const sameKind = shape => kind(shape) === kind(moved) && shape.box;
  const here = (deck.get(moved.part) ?? []).filter(shape => sameKind(shape) && shape.id === moved.id);
  const text = normalise(moved.text);
  const exact = here.filter(shape => shape.name === moved.name || normalise(shape.text) === text);
  if (exact.length === 1) return { shape: exact[0], how: 'same shape in the same slide part' };
  const all = [...deck.values()].flat().filter(sameKind);
  if (text) {
    const twins = all.filter(shape => normalise(shape.text) === text);
    if (twins.length) return { shape: twins.sort((a, b) => distance(a, moved) - distance(b, moved))[0], how: 'same kind and same text' };
  }
  if (moved.chart || moved.table) {
    const scored = [...deck.entries()].map(([part, shapes]) => ({ part, own: shapes.filter(sameKind), score: overlap(shapes.map(shape => shape.text).filter(Boolean), moved.slideTexts ?? []) }))
      .filter(entry => entry.own.length === 1 && entry.score >= 0.5).sort((a, b) => b.score - a.score);
    if (scored.length) return { shape: scored[0].own[0], how: 'the only one of its kind on the most similar slide' };
  }
  return null;
}
const distance = (shape, moved) => Math.hypot(shape.fraction.x - moved.after.x, shape.fraction.y - moved.after.y);

// After the edits: is every moved shape still where the move left it?
export function checkMoves(file, moveResult) {
  const pkg = openPackage(file);
  const outline = deckOutline(pkg);
  const deck = new Map(outline.slides.map(part => {
    const { shapes } = slideShapes(pkg, part);
    for (const shape of shapes) if (shape.box) shape.fraction = fraction(shape.box, outline);
    return [part, shapes];
  }));
  const targets = moveResult.targets.map(target => {
    if (!target.resolved) return { slide: target.slide, label: target.label, applied: false, kept: null };
    const shapes = target.shapes.map(moved => {
      const found = findAgain(deck, moved);
      if (!found) return { name: moved.name, found: false, kept: false };
      const dx = found.shape.fraction.x - moved.after.x;
      const dy = found.shape.fraction.y - moved.after.y;
      return { name: moved.name, found: true, how: found.how, part: found.shape.part, dx, dy, kept: Math.abs(dx) <= TOLERANCE.x && Math.abs(dy) <= TOLERANCE.y };
    });
    return { slide: target.slide, label: target.label, applied: true, kept: shapes.every(shape => shape.kept), shapes };
  });
  return summary(targets);
}

export function summary(targets) {
  const applied = targets.filter(target => target.applied);
  // No target could be applied: nothing was measured, and a person has to look (kept is null).
  return { applied: applied.length, notApplied: targets.length - applied.length, kept: applied.length ? applied.every(target => target.kept) : null, targets };
}
