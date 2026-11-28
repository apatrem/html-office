// The five briefs of ADR-016 §4: their shape, and that the same text can be given to both formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listBriefs, loadBrief, expectedContent } from '../lib/briefs.mjs';
import { generationPrompt, editPrompt, FORMATS } from '../lib/session.mjs';

const SUBJECTS = [[1, 8], [2, 8], [3, 8], [4, 5], [5, 5]];
const briefs = SUBJECTS.map(([subject]) => loadBrief(subject));
const slideHeadings = text => [...text.matchAll(/^### Slide (\d+) — /gm)].map(match => Number(match[1]));
const general = text => text.slice(text.indexOf('### General requirements'), text.indexOf('### Slide 1')).split('\n').filter(line => line.startsWith('- '));

test('five briefs, with the slide counts of the ADR', () => {
  assert.deepEqual(listBriefs().map(entry => entry.subject), [1, 2, 3, 4, 5]);
  for (const [index, [subject, slides]] of SUBJECTS.entries()) {
    const brief = briefs[index];
    assert.equal(brief.slides, slides, `subject ${subject}`);
    assert.deepEqual(slideHeadings(brief.brief), Array.from({ length: slides }, (_, i) => i + 1), `subject ${subject}: one section per slide, in order`);
    assert.match(brief.brief, new RegExp(`Exactly ${slides} slides`));
  }
});

test('every slide has a title that is a sentence, without a final full stop', () => {
  for (const brief of briefs) {
    const titles = [...brief.brief.matchAll(/^Title: (.+)$/gm)].map(match => match[1]);
    assert.equal(titles.length, brief.slides, `subject ${brief.subject}: one title per slide`);
    for (const title of titles) {
      assert.ok(title.split(' ').length >= 7, `"${title}" states a message`);
      assert.ok(!/[.:;]$/.test(title), `"${title}" has no final punctuation`);
    }
  }
});

test('the general requirements are the same in the five briefs', () => {
  const neutral = brief => general(brief.brief).map(line => line.replace(/Exactly \d+ slides/, 'Exactly N slides').replace(/the footer "[^"]+"/, 'the footer "…"'));
  for (const brief of briefs) assert.deepEqual(neutral(brief), neutral(briefs[0]), `subject ${brief.subject}`);
  assert.equal(neutral(briefs[0]).length, 7);
});

test('every organisation is declared fictional and every figure illustrative', () => {
  for (const brief of briefs) {
    assert.match(brief.brief, /\(a fictional /, `subject ${brief.subject} introduces a fictional organisation`);
    assert.match(brief.brief, /Source: illustrative data \(fictional example\)/);
    assert.match(brief.brief, /footer "[^"]*\(fictional\)[^"]*"/);
    assert.match(fs.readFileSync(brief.file, 'utf8'), /\*\*Fictional\*\*/);
  }
});

test('a brief names no feature of either format', () => {
  const words = /\b(html|pptx|powerpoint|keynote|css|class(es)?|layouts?|placeholders?|masters?|echarts|pptxgenjs|python|svg|w-\d+|data-[a-z]+)\b/i;
  for (const brief of briefs) for (const part of ['brief', 'edits']) {
    const hit = brief[part].match(words);
    assert.equal(hit, null, `subject ${brief.subject}, ${part}: "${hit?.[0]}"`);
  }
});

test('three edits per brief', () => {
  for (const brief of briefs) {
    assert.deepEqual([...brief.edits.matchAll(/^(\d)\. \*\*/gm)].map(match => Number(match[1])), [1, 2, 3], `subject ${brief.subject}`);
    assert.match(brief.edits, /A new slide after slide \d/, `subject ${brief.subject} adds a slide`);
    assert.match(brief.edits, /Slide numbers are those of the deck before these changes/);
  }
});

test('the scripted move names elements that the brief asks for', () => {
  for (const brief of briefs) {
    assert.ok(Math.abs(brief.move.dx) <= 0.05 && Math.abs(brief.move.dy) <= 0.05 && brief.move.dx !== 0, 'a small displacement');
    assert.ok(brief.move.targets.length >= 3);
    const sections = brief.brief.split(/^### Slide \d+ — .*$/m).slice(1);
    for (const target of brief.move.targets) {
      const section = sections[target.slide - 1];
      assert.ok(section, `subject ${brief.subject}: slide ${target.slide} exists`);
      if (target.kind === 'text') {
        assert.ok(section.includes(target.contains), `subject ${brief.subject}, slide ${target.slide}: "${target.contains}" is in the brief`);
        const title = section.match(/^Title: (.+)$/m)[1];
        assert.ok(!title.includes(target.contains), 'the marker is not in the title');
        assert.equal(section.split(target.contains).length, 2, `"${target.contains}" appears once on its slide`);
      } else if (target.kind === 'chart') assert.equal((section.match(/\bchart, title "/g) ?? []).length, 1, `subject ${brief.subject}, slide ${target.slide}: exactly one chart`);
      else assert.equal((section.match(/^Table/gm) ?? []).length, 1, `subject ${brief.subject}, slide ${target.slide}: exactly one table`);
    }
    assert.equal(new Set(brief.move.targets.map(target => `${target.slide}/${target.kind}/${target.contains ?? ''}`)).size, brief.move.targets.length);
  }
});

test('both formats receive the same brief and the same edits; only the sentence that names the format differs', () => {
  for (const brief of briefs) {
    const [a, b] = Object.keys(FORMATS).map(format => generationPrompt(format, brief));
    assert.ok(a.endsWith(brief.brief + '\n') && b.endsWith(brief.brief + '\n'));
    const lines = prompt => prompt.split('\n');
    const differing = lines(a).filter((line, index) => line !== lines(b)[index]);
    assert.equal(differing.length, 2, 'the opening sentence and the file name');
    const [c, d] = Object.keys(FORMATS).map(format => editPrompt(format, brief));
    assert.ok(c.endsWith(brief.edits + '\n') && d.endsWith(brief.edits + '\n'));
    assert.ok(!generationPrompt('pptx', brief).includes(brief.edits.slice(0, 80)), 'the generating session does not see the edits');
    assert.ok(!a.includes('Scripted move') && !c.includes('"targets"'), 'no session sees the scripted move');
  }
});

test('the expected content given to the counter holds the brief, the edits and the moved elements, and no format', () => {
  for (const brief of briefs) {
    const text = expectedContent(brief);
    assert.ok(text.includes(brief.brief) && text.includes(brief.edits));
    for (const target of brief.move.targets) assert.ok(text.includes(`Slide ${target.slide}: ${target.label}.`));
    assert.doesNotMatch(text, /html|pptx|powerpoint/i);
  }
});
