// Commands of the Slides editor (U04-Slides), registered on the shared command/state API.
// The shell only runs them and reads their enabled state; keyboard shortcuts stay in editor.js.
import { createCommands } from '../../packages/shared/shell/commands.mjs';
import { state, slides, undo, redo, GROUPS } from './model.js';
import * as E from './editor.js';
import { present, helpPanel, formatPanel } from './view.js';

export function slideCommands(save) {
  const c = createCommands(), R = c.register;
  const edit = E.editingMode, els = () => E.context().els;
  const current = () => (state.current && state.current.isConnected ? state.current : null);
  const any = () => edit() && els().length > 0;
  // Element commands end typing first: the element itself becomes the selection.
  const onEls = fn => (...a) => { E.stopText(); return fn(...a); };

  R('edit', E.toggleEdit);
  R('present', () => { document.activeElement?.blur?.(); present(true); });
  R('print', () => window.print());
  R('save', save);
  R('help', helpPanel);
  R('guide', formatPanel, () => !!document.getElementById('html-slides-guide'));
  // Text being typed is committed first, so history steps over it in order.
  R('undo', () => { E.stopText(); E.clearSel(); undo(); }, () => edit() && state.undo.length > 0);
  R('redo', () => { E.stopText(); E.clearSel(); redo(); }, () => edit() && state.redo.length > 0);

  R('insert', E.insertElement, edit);
  R('insert-shape', E.insertShape, edit);
  R('insert-image', E.insertImage, edit);
  R('insert-chart', E.insertChart, edit);

  R('new-slide', E.newSlide, edit);
  R('layout', E.setLayout, edit);
  R('reset-layout', E.relayout, () => edit() && !!current()?.hasAttribute('data-detached'));
  R('footer', E.footerPanel, edit);
  R('theme', E.setTheme, edit);
  R('font', E.setFont, edit);
  R('duplicate-slide', E.duplicateSlide, edit);
  R('delete-slide', E.deleteSlide, () => edit() && slides().length > 1);

  // Formatting keeps typing: a text selection takes bold, italic and colours.
  for (const [id, fn] of [['bold', E.bold], ['italic', E.italic], ['size', E.size], ['text-align', E.textAlign],
    ['color', E.color], ['fill', E.fill]]) R(id, fn, any);
  const formatted = el => [...el.classList].some(k => Object.values(GROUPS).some(re => re.test(k)));
  R('clear-format', E.clearFormat, () => any() && (E.context().typing || els().some(formatted)));
  R('align', onEls(E.align), any);
  R('distribute', onEls(E.distribute), () => edit() && els().length >= 3);
  R('zorder', onEls(E.zorder), any);
  R('duplicate', onEls(E.duplicateSel), any);
  R('delete', onEls(E.removeSel), any);
  R('chart-data', E.dataPanel, () => edit() && E.context().chart);
  for (const op of ['row+', 'row-', 'col+', 'col-']) R('table' + op, () => E.tableOp(op), () => edit() && E.context().table && E.tableCan(op));
  return c;
}
