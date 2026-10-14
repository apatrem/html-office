// Gabarits de l'éditeur : nouvelles slides (une par mise en page) et éléments à insérer.
// Tout est écrit avec les classes du catalogue, comme le ferait Claude.

export const LAYOUTS = [
  ['default', 'Title only'], ['top-left', 'Impact title'], ['mid-left', 'Left title'], ['section', 'Section divider'],
  ['quote', 'Quote'], ['panel-14', 'Panel 1/4'], ['panel-13', 'Panel 1/3'], ['panel-12', 'Panel 1/2'],
  ['panel-23', 'Panel 2/3'], ['three-lines', 'Three lines'], ['cover', 'Cover'], ['end', 'End']
];

const TITLE = '<h1>Message title: a sentence stating the takeaway</h1>';
const TRACKER = '<p class="tracker">Section</p>';
const BODY = '<div class="body"><p>Text: start with the conclusion, then the arguments.</p></div>';
const PANEL = '<div class="stack in-panel"><p class="kpi">42 %</p><p class="body">Key figure label</p></div>';

const SLIDES = {
  'default': `${TRACKER}${TITLE}${BODY}`,
  'top-left': `${TRACKER}<h1>An impact message in one line</h1><div class="cards cols-3"><div class="card"><h3>Point 1</h3>Short text.</div><div class="card"><h3>Point 2</h3>Short text.</div><div class="card"><h3>Point 3</h3>Short text.</div></div>`,
  'mid-left': `${TRACKER}<h1>Message on the left</h1><p class="lead">An introductory sentence.</p><ul class="body"><li>First point</li><li>Second point</li><li>Third point</li></ul>`,
  'section': '<p class="num">0X</p><p class="tracker">Part X</p><h1>Section title</h1><p class="lead">What the section shows, in one sentence</p>',
  'quote': '<blockquote>A short quote supporting the message.</blockquote><p class="author">Author, role</p>',
  'panel-14': `${PANEL}${TRACKER}${TITLE}${BODY}`,
  'panel-13': `${PANEL}${TRACKER}${TITLE}${BODY}`,
  'panel-12': `${PANEL}${TRACKER}${TITLE}${BODY}`,
  'panel-23': `${PANEL}${TRACKER}${TITLE}${BODY}`,
  'three-lines': `${TRACKER}${TITLE}<div class="band"><p>Finding 1</p><p>A sentence and its supporting figure.</p></div><div class="band"><p>Finding 2</p><p>A sentence and its supporting figure.</p></div><div class="band"><p>Finding 3</p><p>A sentence and its supporting figure.</p></div>`,
  'cover': '<p class="kicker">Topic · Example</p><h1>Document message title</h1><p class="lead">Subtitle — discussion draft</p><p class="tracker">Discussion draft · Illustrative example</p><div class="cartouche"><div><span>Topic</span>Name</div><div><span>Date</span>YYYY-MM-DD</div><div class="acc"><span>Revision</span>A</div></div>',
  'end': '<h1>Presentation title</h1><p class="lead">Contact details</p><p class="tracker">Discussion draft · Illustrative example</p>'
};
export const slideHTML = layout => `<section class="slide" data-layout="${layout}">${SLIDES[layout] || SLIDES.default}</section>`;

const SAMPLE = {
  column: { title: 'Chart title', unit: 'Unit', categories: ['2022', '2023', '2024', '2025'], series: [{ name: 'Series 1', values: [10, 12, 15, 18] }] },
  hbar: { title: 'Chart title', unit: 'Unit', categories: ['A', 'B', 'C', 'D'], series: [{ name: 'Series 1', values: [40, 30, 20, 10] }], highlight: 0 },
  stacked: { title: 'Chart title', unit: 'Unit', categories: ['2023', '2024', '2025'], series: [{ name: 'Part 1', values: [5, 6, 7] }, { name: 'Part 2', values: [3, 3, 4] }] },
  line: { title: 'Chart title', unit: 'Unit', categories: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'], series: [{ name: 'Series 1', values: [10, 11, 13, 12, 14, 16, 15, 18] }] },
  waterfall: { title: 'Chart title', unit: 'Unit', items: [{ label: 'Start', value: 100, total: true }, { label: 'Increase', value: 20 }, { label: 'Decrease', value: -8 }, { label: 'End', total: true }] },
  bubble: { title: 'Chart title', unit: 'Bubble size: unit', xLabel: 'Horizontal axis', yLabel: 'Vertical axis', points: [{ name: 'A', x: 1, y: 3, size: 2 }, { name: 'B', x: 2, y: 1, size: 1 }, { name: 'C', x: 3, y: 2, size: 3 }] },
  gantt: { title: 'Schedule', tasks: [{ name: 'Step 1', start: '2026-11', end: '2027-01', group: 'Phase 1' }, { name: 'Step 2', start: '2027-02', end: '2027-05', group: 'Phase 2' }, { name: 'Milestone', start: '2027-06' }] }
};
export const CHART_TYPES = [['column', 'Columns'], ['hbar', 'Horizontal bars'], ['stacked', 'Stacked bars'], ['line', 'Lines'],
  ['waterfall', 'Waterfall'], ['bubble', 'Bubbles'], ['gantt', 'Gantt']];

// [libellé, html, largeur, hauteur]
export const ELEMENTS = {
  text: ['Text box', '<div class="body"><p>Text</p></div>', 400, 64],
  box: ['Box', '<div class="box"><h3>Title</h3><p>Text</p></div>', 336, 152],
  tint: ['Tinted box', '<div class="box bg-tint"><h3>Title</h3><p>Text</p></div>', 336, 152],
  callout: ['Callout', '<div class="callout">Key takeaway.</div>', 480, 64],
  kpi: ['Key figure', '<p class="kpi">42 %<small>Figure label</small></p>', 280, 136],
  arrowR: ['Thin arrow →', '<div class="arrow">→</div>', 64, 48],
  arrowD: ['Thin arrow ↓', '<div class="arrow">↓</div>', 64, 48],
  rule: ['Rule', '<div class="rule"></div>', 400, 8],
  table: ['Table', '<table class="t"><tr><th>Item</th><th class="n">Value</th><th class="n">Share</th></tr><tr><td>Row 1</td><td class="n">0</td><td class="n">0 %</td></tr><tr><td>Row 2</td><td class="n">0</td><td class="n">0 %</td></tr><tr class="tot"><td>Total</td><td class="n">0</td><td class="n">100 %</td></tr></table>', 560, 176]
};
// Formes : <div class="shape" data-shape="…">texte facultatif</div>. [clé, libellé, largeur, hauteur]
export const SHAPES = [
  ['rect', 'Rectangle', 192, 104], ['round', 'Rounded rectangle', 192, 104], ['ellipse', 'Ellipse', 136, 136],
  ['triangle', 'Triangle', 152, 128], ['diamond', 'Diamond', 152, 128], ['hexagon', 'Hexagon', 176, 112],
  ['parallelogram', 'Parallelogram', 200, 96], ['pentagon', 'Pentagon arrow', 216, 80], ['chevron', 'Chevron', 216, 80],
  ['arrow-r', 'Right arrow', 176, 88], ['arrow-l', 'Left arrow', 176, 88], ['arrow-u', 'Up arrow', 88, 152], ['arrow-d', 'Down arrow', 88, 152]
];
export const SHAPE_KEYS = SHAPES.map(s => s[0]);
export const shapeHTML = k => `<div class="shape" data-shape="${k}"></div>`;

export const chartHTML = type => `<figure class="chart" data-type="${type}"><script type="application/json">${JSON.stringify(SAMPLE[type])}</script></figure>`;
