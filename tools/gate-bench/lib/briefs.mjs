// Reads the briefs of docs/gate/briefs/. A brief file has three parts: the text given to the
// generating session, the three edits given to the editing session, and the scripted move, which
// only the bench reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const BRIEFS = path.join(ROOT, 'docs/gate/briefs');

const between = (text, name, file) => {
  const match = text.match(new RegExp(`<!-- gate:${name}:start -->\\n([\\s\\S]*?)\\n<!-- gate:${name}:end -->`));
  if (!match) throw new Error(`${file}: the gate:${name} markers are missing`);
  return match[1].trim();
};

export function listBriefs() {
  return fs.readdirSync(BRIEFS).filter(name => /^\d\d-[\w-]+\.md$/.test(name)).sort()
    .map(name => ({ subject: Number(name.slice(0, 2)), slug: name.slice(3, -3), file: path.join(BRIEFS, name) }));
}

export function loadBrief(subject) {
  const entry = listBriefs().find(item => item.subject === Number(subject));
  if (!entry) throw new Error(`no brief for subject ${subject}`);
  const text = fs.readFileSync(entry.file, 'utf8');
  const heading = text.match(/^# Brief (\d+) — (.+) \((\d+) slides\)$/m);
  if (!heading || Number(heading[1]) !== entry.subject) throw new Error(`${entry.file}: the first heading must be "# Brief ${entry.subject} — … (N slides)"`);
  const fence = text.slice(text.indexOf('## Scripted move')).match(/```json\n([\s\S]*?)\n```/);
  if (!fence) throw new Error(`${entry.file}: the scripted move is missing`);
  const move = JSON.parse(fence[1]);
  if (typeof move.dx !== 'number' || typeof move.dy !== 'number' || !Array.isArray(move.targets) || !move.targets.length) throw new Error(`${entry.file}: the scripted move needs dx, dy and targets`);
  for (const target of move.targets) {
    if (!Number.isInteger(target.slide) || !['chart', 'table', 'text'].includes(target.kind) || !target.label) throw new Error(`${entry.file}: a target needs slide, kind and label`);
    if (target.kind === 'text' && !target.contains) throw new Error(`${entry.file}: a text target needs "contains"`);
  }
  return { ...entry, title: heading[2], slides: Number(heading[3]), brief: between(text, 'brief', entry.file), edits: between(text, 'edits', entry.file), move };
}

// What a counter is given: what the final presentation should contain, and what was moved on purpose.
export function expectedContent(brief) {
  return [
    `# Expected content — ${brief.title}`,
    '',
    'The presentation was produced from the brief below, then changed by the three edits that follow it. The pages you see are the result after the edits: where an edit changes something of the brief, the edit is what is expected.',
    '',
    brief.brief,
    '',
    brief.edits,
    '',
    '## Elements moved on purpose before the edits',
    '',
    'Their author shifted these elements by hand, slightly up and to the left (slide numbers are those of the brief, before the edits):',
    '',
    ...brief.move.targets.map(target => `- Slide ${target.slide}: ${target.label}.`),
    ''
  ].join('\n');
}
