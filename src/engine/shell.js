// Variant A editor shell of html-slides (ADR-011 §7, U04-Slides), built from the shared
// native components: a file bar with menus, one toolbar that follows the selection, and a
// floating settings bar that replaces the reading-mode pill, and the document-settings side panel
// (theme, font, footer). Every control runs a command registered in commands.js; menus list
// disabled commands, never inert ones.
import { h, button } from '../../packages/shared/shell/dom.mjs';
import { menubar, menuButton, openMenu } from '../../packages/shared/shell/menu.mjs';
import { toolbar, group } from '../../packages/shared/shell/toolbar.mjs';
import { openPopover, closePopover, openPopoverState } from '../../packages/shared/shell/popover.mjs';
import { swatchGroup, colourButton, TEXT_COLOURS, FILLS } from '../../packages/shared/shell/pickers.mjs';
import { drawer as createDrawer } from '../../packages/shared/shell/drawer.mjs';
import { documentBody } from '../../packages/shared/shell/panels.mjs';
import { state, slides } from './model.js';
import { LAYOUTS, CHART_TYPES, SHAPES, ELEMENTS } from './templates.js';
import { context, editingMode, stopText, textContext, resumeText } from './editor.js';
import { squeeze } from './view.js';

// Menu icons (16 px strokes), as in the previous Slides menus
const tpl = document.createElement('template');
const svg = d => {
  tpl.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return tpl.content.firstChild;
};
const SHAPE_ICON = {
  rect: '<rect x="2" y="4" width="12" height="8"/>', round: '<rect x="2" y="4" width="12" height="8" rx="2.5"/>', ellipse: '<ellipse cx="8" cy="8" rx="6" ry="5"/>',
  triangle: '<path d="M8 3l6 10H2z"/>', diamond: '<path d="M8 2l6 6-6 6-6-6z"/>', hexagon: '<path d="M5 3h6l3 5-3 5H5L2 8z"/>',
  parallelogram: '<path d="M5 4h9l-3 8H2z"/>', pentagon: '<path d="M2 4h9l3 4-3 4H2z"/>', chevron: '<path d="M2 4h9l3 4-3 4H2l3-4z"/>',
  'arrow-r': '<path d="M2 6h7V3l5 5-5 5v-3H2z"/>', 'arrow-l': '<path d="M14 6H7V3L2 8l5 5v-3h7z"/>',
  'arrow-u': '<path d="M6 14V7H3l5-5 5 5h-3v7z"/>', 'arrow-d': '<path d="M6 2v7H3l5 5 5-5h-3V2z"/>'
};
const ARRANGE = [
  ['Align left', 'align', 'left', '<path d="M2 2v12M5 5h8M5 10h5"/>'], ['Centre horizontally', 'align', 'hcenter', '<path d="M8 2v12M3 5h10M5 10h6"/>'],
  ['Align right', 'align', 'right', '<path d="M14 2v12M3 5h8M6 10h5"/>'], '-',
  ['Align top', 'align', 'top', '<path d="M2 2h12M5 5v8M10 5v5"/>'], ['Centre vertically', 'align', 'vcenter', '<path d="M2 8h12M5 3v10M10 5v6"/>'],
  ['Align bottom', 'align', 'bottom', '<path d="M2 14h12M5 3v8M10 6v5"/>'], '-',
  ['Distribute horizontally', 'distribute', 'x', '<path d="M2 2v12M14 2v12"/><rect x="6" y="5" width="4" height="6"/>'],
  ['Distribute vertically', 'distribute', 'y', '<path d="M2 2h12M2 14h12"/><rect x="5" y="6" width="6" height="4"/>'], '-',
  ['Bring forward', 'zorder', 1, '<rect x="2" y="2" width="8" height="8" stroke-dasharray="2 2"/><rect x="6" y="6" width="8" height="8" fill="currentColor" fill-opacity=".25"/>', ']'],
  ['Send backward', 'zorder', -1, '<rect x="6" y="6" width="8" height="8" stroke-dasharray="2 2"/><rect x="2" y="2" width="8" height="8" fill="currentColor" fill-opacity=".25"/>', '[']
];
const ALIGN = [['ta-l', 'Align text left', 'alignL'], ['ta-c', 'Centre text', 'alignC'], ['ta-r', 'Align text right', 'alignR']];
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = k => (mac ? '⌘' : 'Ctrl+') + k;

// A menu closed by keyboard returns focus to its trigger (ARIA); after a pointer choice, focus
// leaves the chrome so that canvas keys (arrows, Delete, Enter) act on the slide again.
let pointer = false;
addEventListener('pointerdown', () => { pointer = true; }, true);
addEventListener('keydown', () => { pointer = false; }, true);
const leaveChrome = () => { const a = document.activeElement; if (a && a.closest && a.closest('.sh-root, .hs-side')) a.blur(); };

export function mountShell(cmd) {
  const run = (id, ...a) => () => cmd.run(id, ...a);
  // `typed`: the text being typed when a menu first opened (by pointer). Opening a menu takes focus,
  // which ends typing; commands that act on a text selection or on the caret's table cell resume
  // typing there first, provided that element is still the selection.
  let typed = null;
  const current = () => { const els = context().els; return !!typed && els.length === 1 && els[0] === typed.el; };
  const textRange = () => current() && !!typed.range && !typed.range.collapsed;
  function menuOpens() {
    if (!openPopoverState()?.pop.querySelector('[role=menu]')) typed = textContext(); // a new menu session
    stopText(); // enabled states must see the typing just committed (Undo)
  }
  const resume = () => { if (current()) resumeText(typed); };
  const item = (label, id, x = {}) => ({ label, ...x,
    disabled: !cmd.enabled(id) && !(x.withText && textRange()), // inline formatting in the text range
    onSelect: () => { if (pointer) leaveChrome(); if (x.resume) resume(); (x.onSelect || run(id, ...(x.args || [])))(); } });
  // A menu entry that opens a second menu, anchored where the first one was opened
  // (its menubar or toolbar trigger, which has focus back once the first menu closes).
  const sub = (label, id, list) => ({ label: label + '…', disabled: !cmd.enabled(id),
    onSelect: () => { const at = document.activeElement; openMenu(at && at.closest('.sh-root') ? at : B[id], list(), { label }); } });
  const currentLayout = () => (state.current && state.current.dataset.layout) || 'default';
  const shapeItems = () => [...SHAPES.map(([k, l]) => item(l, 'insert-shape', { args: [k], icon: svg(SHAPE_ICON[k]) })), '-',
    ...['arrowR', 'arrowD', 'rule'].map(k => item(ELEMENTS[k][0], 'insert', { args: [k] }))];
  const blockItems = () => ['box', 'tint', 'callout', 'kpi'].map(k => item(ELEMENTS[k][0], 'insert', { args: [k] }));
  const chartItems = () => CHART_TYPES.map(([k, l]) => item(l, 'insert-chart', { args: [k] }));
  const newSlideItems = () => LAYOUTS.map(([k, l]) => item(l, 'new-slide', { args: [k] }));
  const layoutItems = () => { const cur = currentLayout(); return LAYOUTS.map(([k, l]) => item(l, 'layout', { args: [k], checked: k === cur, radio: true })); };
  const arrangeItems = () => ARRANGE.map(a => (a === '-' ? a : item(a[0], a[1], { args: [a[2]], icon: svg(a[3]), shortcut: a[4] && key(a[4]) })));
  const tableItems = () => [item('Insert row below', 'tablerow+', { resume: true }), item('Delete row', 'tablerow-', { resume: true }),
    item('Insert column right', 'tablecol+', { resume: true }), item('Delete column', 'tablecol-', { resume: true })];
  const guide = () => (cmd.enabled('guide') ? [item('File format guide', 'guide')] : []);

  // Every command has a home in the menus; the toolbar repeats the frequent ones.
  // Opening a menu moves focus into it, which ends typing: record what was being typed.
  const menus = [
    { name: 'File', items: () => [item('Save', 'save', { shortcut: key('S') }), item('Print / PDF', 'print'), '-',
      item('Document settings…', 'theme', { onSelect: () => openSettings() }), ...(guide().length ? ['-', ...guide()] : [])] },
    { name: 'Edit', items: () => [item('Undo', 'undo', { shortcut: key('Z') }), item('Redo', 'redo', { shortcut: key('Shift+Z') }), '-',
      item('Duplicate', 'duplicate', { shortcut: key('D') }), item('Delete', 'delete', { shortcut: 'Del' }), '-',
      item('Edit chart data…', 'chart-data'), item('Clear formatting', 'clear-format', { resume: true, withText: true })] },
    { name: 'Insert', items: () => [item('Text box', 'insert', { args: ['text'] }), sub('Shape', 'insert-shape', shapeItems), sub('Block', 'insert', blockItems),
      item('Image…', 'insert-image'), item('Table', 'insert', { args: ['table'] }), sub('Chart', 'insert-chart', chartItems), '-', sub('New slide', 'new-slide', newSlideItems)] },
    { name: 'Format', items: () => {
      const l = look();
      return [item('Bold', 'bold', { shortcut: key('B'), checked: l.bold, resume: true }), item('Italic', 'italic', { shortcut: key('I'), checked: l.italic, resume: true }), '-',
        item('Smaller text', 'size', { args: [-1] }), item('Larger text', 'size', { args: [1] }), '-',
        ...ALIGN.map(([v, label]) => item(label, 'text-align', { args: [v], checked: l.align === v })), '-',
        item('Text colour…', 'color', { resume: true, onSelect: () => pick('text', null, !!typed && context().typing) }), item('Fill colour…', 'fill', { onSelect: () => pick('fill') }),
        item('Clear formatting', 'clear-format', { resume: true, withText: true })];
    } },
    { name: 'Slide', items: () => [{ heading: 'Layout' }, ...layoutItems(), '-', item('Reset layout', 'reset-layout'), item('Footer…', 'footer'), '-',
      item('Duplicate slide', 'duplicate-slide'), item('Delete slide', 'delete-slide')] },
    { name: 'Arrange', items: arrangeItems },
    { name: 'Table', items: tableItems },
    { name: 'View', items: () => [item('Edit mode', 'edit', { shortcut: 'E', checked: editingMode() }), item('Present', 'present', { shortcut: 'P' })] },
    { name: 'Help', items: () => [item('Keyboard shortcuts', 'help', { shortcut: '?' }), ...guide()] }
  ];
  const menubarMenus = menus.map(m => ({ name: m.name, items: () => { menuOpens(); return m.items(); } }));

  // ---- toolbar: history and insert, then the groups of the current selection ----
  const B = {}, binds = [];
  const bind = (b, id) => { binds.push([b, id]); return b; };
  const add = (name, id, spec, ...a) => (B[name] = bind(button({ ...spec, onClick: run(id, ...a) }), id));
  const dd = (name, id, spec, items) => (B[name] = bind(menuButton(button({ ...spec, caret: true }), () => { stopText(); return items(); }, spec.label), id));
  const ctx = (show, label, ...items) => { const g = group(label, ...items); g.dataset.show = show; return g; };
  const chip = h('span', { class: 'sh-chip' });
  B.color = bind(colourButton('text', e => pick('text', e)), 'color');
  B.fill = bind(colourButton('fill', e => pick('fill', e)), 'fill');
  const bar = toolbar('Slide and selection',
    group('History',
      add('undo', 'undo', { label: 'Undo', ic: 'undo', title: `Undo (${key('Z')})` }),
      add('redo', 'redo', { label: 'Redo', ic: 'redo', title: `Redo (${key('Shift+Z')})` })),
    group('Insert',
      add('text', 'insert', { label: 'Text box', ic: 'textbox', title: 'Add a text box' }, 'text'),
      dd('insert-shape', 'insert-shape', { label: 'Shape', ic: 'shape', title: 'Add a shape: rectangle, ellipse, triangle, chevron, arrow…' }, shapeItems),
      dd('insert', 'insert', { label: 'Block', ic: 'block', title: 'Add a box, callout, or key figure' }, blockItems),
      add('image', 'insert-image', { label: 'Image', ic: 'image', title: 'Add an image from disk (embedded in the file)' }),
      add('table', 'insert', { label: 'Table', ic: 'table', title: 'Add a table (editable rows and columns)' }, 'table'),
      dd('insert-chart', 'insert-chart', { label: 'Chart', ic: 'chart', title: 'Add a chart (replace the sample data)' }, chartItems)),
    chip,
    ctx('slide', 'Slide',
      dd('layout', 'layout', { label: 'Layout', ic: 'layout', text: 'Layout', title: 'Change the slide layout' }, layoutItems),
      add('reset-layout', 'reset-layout', { label: 'Reset layout', ic: 'reset', text: 'Reset layout', title: 'Remove manual positions and restore the automatic layout' }),
      add('footer', 'footer', { label: 'Footer', ic: 'footer', text: 'Footer', title: 'Footer text and visibility on this slide' }),
      add('duplicate-slide', 'duplicate-slide', { label: 'Duplicate slide', ic: 'copy', text: 'Duplicate slide', title: 'Duplicate the current slide' }),
      add('delete-slide', 'delete-slide', { label: 'Delete slide', ic: 'trash', text: 'Delete slide', title: 'Delete the current slide' }),
      h('span', { class: 'hs-hint' }, 'Click an element to format it · double-click to type')),
    ctx('el', 'Text',
      add('smaller', 'size', { label: 'Smaller text', glyph: 'A<sub>−</sub>' }, -1),
      add('larger', 'size', { label: 'Larger text', glyph: 'A<sup>+</sup>' }, 1),
      add('bold', 'bold', { label: 'Bold', glyph: '<b>B</b>', pressed: false, title: `Bold (${key('B')})` }),
      add('italic', 'italic', { label: 'Italic', glyph: '<i>I</i>', pressed: false, title: `Italic (${key('I')})` })),
    ctx('el', 'Colour', B.color, B.fill,
      add('clear', 'clear-format', { label: 'Clear formatting', ic: 'eraser', title: 'Clear formatting (restore catalogue defaults)' })),
    ctx('el', 'Alignment', ...ALIGN.map(([v, label, ic]) => add(v, 'text-align', { label, ic, pressed: false }, v))),
    ctx('el', 'Arrange', dd('arrange', 'align', { label: 'Arrange', ic: 'arrange', text: 'Arrange', title: 'Align, distribute, and change stacking order' }, arrangeItems)),
    ctx('chart', 'Chart', add('chart-data', 'chart-data', { label: 'Edit data', ic: 'chart', text: 'Edit data', title: 'Edit the selected chart data' })),
    ctx('table', 'Table',
      add('row+', 'tablerow+', { label: 'Insert row below', ic: 'rowAdd' }), add('row-', 'tablerow-', { label: 'Delete row', ic: 'rowDel' }),
      add('col+', 'tablecol+', { label: 'Insert column right', ic: 'colAdd' }), add('col-', 'tablecol-', { label: 'Delete column', ic: 'colDel' })),
    ctx('el', 'Element',
      add('duplicate', 'duplicate', { label: 'Duplicate element', ic: 'copy', title: `Duplicate the element (${key('D')})` }),
      add('delete', 'delete', { label: 'Delete element', ic: 'trash', title: 'Delete the element (Delete)' })));
  bar.classList.add('hs-tb');

  // Colour pickers: a pointer click leaves focus (and the text selection) where it is.
  // keep: leave focus in the text being typed (the menu resumed it).
  function pick(kind, e, keep) {
    const fill = kind === 'fill', b = fill ? B.fill : B.color, label = fill ? 'Fill colour' : 'Text colour';
    if (e && openPopoverState()?.trigger === b) return closePopover();
    const pointer = !!(e && e.detail) || !!keep, l = look();
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const pop = openPopover(b, [h('p', { class: 'sh-pop-h' }, label + ' · charte tokens'),
      swatchGroup(label, fill ? FILLS : TEXT_COLOURS, fill ? l.fill : l.color, t => {
        closePopover({ restore: !pointer });
        cmd.run(fill ? 'fill' : 'color', (fill ? 'bg-' : 'c-') + t);
      })], { label, cls: 'sh-pop-sw', focus: !pointer });
    if (pointer) pop.addEventListener('pointerdown', ev => ev.preventDefault());
  }
  // Formatting of the selection, as the toolbar shows it
  function look() {
    const els = context().els, first = els[0], all = c => els.length > 0 && els.every(el => el.classList.contains(c));
    const token = re => { const c = first && [...first.classList].find(x => re.test(x)); return c ? c.replace(re, '') : ''; };
    return { bold: all('t-bold'), italic: all('t-italic'), align: (ALIGN.find(([v]) => all(v)) || [''])[0], color: token(/^c-/) || 'ink', fill: token(/^bg-/) };
  }

  // ---- file bar ----
  const title = (document.title || 'Presentation').trim();
  const status = h('p', { role: 'status' });
  B.save = add('save', 'save', { label: 'Save', ic: 'save', text: 'Save', cls: 'sh-primary hs-save', title: `Save to file (${key('S')})` });
  const top = h('div', { class: 'sh-root hs-shell', 'data-ui': '' },
    h('div', { class: 'sh-row' },
      h('div', { class: 'sh-ident' }, h('span', { class: 'sh-mark', 'aria-hidden': 'true' }, 'S'),
        h('div', { class: 'sh-tt' }, h('span', { class: 'sh-title', title }, title), h('div', { class: 'sh-state' }, status))),
      h('div', { class: 'sh-wide' }, menubar('Presentation menu', menubarMenus)),
      h('span', { class: 'sh-spacer' }),
      add('present', 'present', { label: 'Present', ic: 'play', text: 'Present', cls: 'sh-ghost', title: 'Presentation mode (P)' }),
      B.save,
      add('done', 'edit', { label: 'Done', ic: 'check', text: 'Done', cls: 'sh-ghost', title: 'Exit edit mode (E)' }),
      h('span', { class: 'sh-only-narrow' }, menuButton(button({ label: 'Menu', ic: 'menu' }),
        () => { menuOpens(); return menus.flatMap((m, i) => [...(i ? ['-'] : []), { heading: m.name }, ...m.items()]); }, 'Menu'))),
    h('div', { class: 'sh-row sh-row2' }, bar));

  // ---- document settings (ADR-011 §7, TH02): theme and font of the deck, and its footer ----
  // The deck's own charte colours, read without a built-in overlay.
  const documentColours = (() => {
    const root = document.documentElement, theme = root.dataset.theme;
    delete root.dataset.theme;
    const cs = getComputedStyle(root), colours = Object.fromEntries(['ink', 'acc', 'mid', 'lig', 'alert'].map(t => [t, cs.getPropertyValue('--' + t).trim()]));
    if (theme) root.dataset.theme = theme;
    return colours;
  })();
  const deckLook = () => ({ theme: state.main.dataset.theme || 'document', font: state.main.dataset.font || 'document', footer: state.main.dataset.footer || '' });
  const footerLine = () => deckLook().footer ? 'Footer text: ' + deckLook().footer : 'No footer text; page numbers only.';
  const settings = () => ({ title: 'Document settings', subtitle: 'Theme and font apply to the whole deck',
    body: () => documentBody({ ...deckLook(), documentColours, onTheme: t => cmd.run('theme', t), onFont: f => cmd.run('font', f),
      fontNote: 'Body text only; titles keep the charte font.',
      extra: [h('h3', {}, 'Footer'), h('p', { class: 'sh-hint hs-footer-line' }, footerLine()),
        h('div', { class: 'sh-prow' }, button({ label: 'Footer…', ic: 'footer', text: 'Footer…', cls: 'sh-ghost', onClick: run('footer') }))] }) });
  const panel = createDrawer(h('div', { class: 'sh-root hs-drawer', 'data-ui': '' }));
  // Opened from a menu, the panel returns focus to the settings-bar button when it closes.
  const openSettings = () => { closePopover({ restore: false }); panel.open('settings', { ...settings(), trigger: B.settings }); };

  // ---- floating settings bar: file commands while reading, theme and slide position while editing ----
  const info = h('span', { class: 'sh-finfo', role: 'status' });
  B.settings = bind(panel.toggle(button({ label: 'Theme & font', ic: 'sliders', text: 'Theme & font', cls: 'hs-edit', title: 'Document settings: theme, font and footer' }),
    'settings', settings), 'theme');
  const float = h('div', { class: 'sh-root sh-float hs-float', role: 'group', 'aria-label': 'Presentation', 'data-ui': '' },
    add('edit', 'edit', { label: 'Edit', ic: 'pen', text: 'Edit', cls: 'hs-read', title: 'Edit mode (E)' }),
    add('present2', 'present', { label: 'Present', ic: 'play', text: 'Present', cls: 'hs-read hs-main', title: 'Presentation mode (P)' }),
    add('print', 'print', { label: 'Print or save as PDF', ic: 'print', cls: 'hs-read' }),
    B.save2 = add('save2', 'save', { label: 'Save', ic: 'save', cls: 'hs-read hs-save', title: `Save to file (${key('S')})` }),
    B.settings, info);
  // Clicking the chrome keeps focus (and the text being typed) in the slide.
  for (const el of [top, float]) el.addEventListener('pointerdown', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  document.body.append(top, float, panel.host);
  // Working on the canvas takes keyboard focus out of the chrome.
  state.main.addEventListener('pointerdown', leaveChrome, true);

  // Runs after every change, keystrokes included: text is only rewritten when it changes (status
  // lines are announced), and the toolbar is measured again only when its buttons change.
  const text = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  let shown = '';
  function sync() {
    const c = context(), on = editingMode(), focused = document.activeElement;
    for (const [b, id] of binds) b.disabled = !cmd.enabled(id);
    for (const g of bar.querySelectorAll('[data-show]'))
      g.hidden = !(g.dataset.show === c.kind || (g.dataset.show === 'chart' && c.chart) || (g.dataset.show === 'table' && c.table));
    const all = slides(), n = all.indexOf(state.current) + 1;
    text(chip, c.kind === 'slide' ? (n ? 'Slide ' + n : 'Slide') : c.typing ? 'Text' : c.els.length > 1 ? c.els.length + ' elements'
      : c.chart ? 'Chart' : c.table ? 'Table' : c.els[0].matches('img') ? 'Image' : c.els[0].matches('.shape') ? 'Shape' : 'Element');
    text(info, on && n ? `Slide ${n} of ${all.length}` : '');
    // The open panel follows undo and redo; it closes with edit mode.
    const inPanel = panel.host.contains(focused);
    if (panel.current() && !on) panel.close({ restore: false });
    else if (panel.current()) {
      const l = deckLook();
      for (const [sel, v] of [['.sh-themes > button', l.theme], ['.sh-fonts > button', l.font]])
        for (const b of panel.host.querySelectorAll(sel)) b.setAttribute('aria-checked', String(b.dataset.value === v));
      text(panel.host.querySelector('.hs-footer-line'), footerLine());
    }
    text(status, state.dirty ? 'Unsaved changes' : '');
    for (const b of [B.save, B.save2]) b.classList.toggle('dirty', !!state.dirty);
    const l = look();
    B.bold.setAttribute('aria-pressed', String(l.bold));
    B.italic.setAttribute('aria-pressed', String(l.italic));
    for (const [v] of ALIGN) B[v].setAttribute('aria-pressed', String(l.align === v));
    B.color.bar.style.background = `var(--${l.color})`;
    B.fill.bar.style.background = !l.fill || l.fill === 'none' ? 'transparent' : l.fill === 'tint' ? 'var(--callout)' : `var(--${l.fill === 'dark' ? 'ink' : l.fill})`;
    // A mode switch from the chrome hides the control that had focus: hand it to its counterpart.
    if (focused && focused !== document.body && (top.contains(focused) || float.contains(focused) || inPanel) && !focused.offsetParent)
      (on ? B.done : B.edit).focus({ preventScroll: true });
    const now = on + chip.textContent + binds.map(([b]) => +b.disabled).join('');
    if (now !== shown || bar.contains(focused) && focused.disabled) {
      shown = now;
      bar.refresh(focused);
      if (on) squeeze(bar);
    }
  }
  cmd.subscribe(sync);
  sync();
  return { newSlideItems };
}
