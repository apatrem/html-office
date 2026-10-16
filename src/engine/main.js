// Entry point of the html-slides engine (MIT). Bundled into one script by tools/build.mjs
// and copied into every deck: <script id="engine" data-version="…">.
import * as M from './model.js';
import * as C from './charts.js';
import * as V from './view.js';
import * as E from './editor.js';
import { SHAPES, ELEMENTS } from './templates.js';

function boot() {
  const main = document.getElementById('deck');
  if (!main || window.deckEngine) return;
  M.state.main = main;
  M.state.bodyClass = document.body.getAttribute('class') || '';
  M.captureShell(); // before any injection: only these nodes are saved
  const st = document.createElement('style');
  st.setAttribute('data-ui', '');
  st.textContent = V.UI_CSS;
  document.head.appendChild(st);
  if (V.isStatic()) document.body.classList.add('hs-static');

  M.ensureIds();
  M.captureBase();
  M.resolveAssets();
  V.chromeAll();
  V.fit();

  const charts = () => [...main.querySelectorAll('figure.chart')];
  charts().forEach(C.renderChart);
  const ready = (charts().length ? C.loadECharts() : Promise.resolve(null)).then(ec => {
    if (ec) charts().forEach(C.renderChart);
    else if (charts().length && !V.isStatic())
      V.banner('ECharts could not be loaded: cached charts are displayed, but data cannot be edited.', [], 8000);
    return !!ec;
  });

  const serialize = written => M.serialize(() => C.refreshCaches(main), written);

  let saveChain = Promise.resolve();
  function save() {
    saveChain = saveChain.then(saveOnce).catch(e => V.banner('Save failed: ' + e.message, [], 8000));
    return saveChain;
  }
  async function saveOnce() {
    E.stopText();
    const written = {};
    const html = serialize(written);
    const revision = M.state.revision;
    const name = decodeURIComponent(location.pathname.split('/').pop() || '') || 'deck.html';
    if (window.showSaveFilePicker) {
      try {
        if (!M.state.handle) M.state.handle = await window.showSaveFilePicker({
          suggestedName: name, types: [{ description: 'Deck HTML', accept: { 'text/html': ['.html'] } }] });
        const w = await M.state.handle.createWritable();
        await w.write(html);
        await w.close();
        const current = M.markSaved(revision, written);
        V.banner('Saved to ' + (M.state.handle.name || name) + '.' + (current ? '' : ' Newer changes still need saving.'), [], 4000);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        V.banner('Save failed: ' + e.message + '. Your changes and draft are retained.', [], 8000);
        return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    // The browser may still cancel the download, and this file is not overwritten: keep the draft.
    if (M.markDownloaded(revision)) V.banner('Copy downloaded; this file is unchanged and its draft is kept. Use Chrome or Edge to save directly to a file.', [], 8000);
    else V.banner('Copy downloaded; this file is unchanged and the browser could not store a draft, so changes remain unsaved here. Use Chrome or Edge to save directly to a file.', [], 10000);
  }

  if (!V.isStatic()) {
    let btns, side;
    const handlers = {
      toggleEdit: () => E.toggleEdit(),
      align: E.align, distribute: E.distribute, zorder: E.zorder, relayout: E.relayout,
      bold: E.bold, italic: E.italic, size: E.size, textAlign: E.textAlign, color: E.color, fill: E.fill,
      clearFormat: E.clearFormat, dupEl: E.duplicateSel, delEl: E.removeSel, table: E.tableOp,
      insert: E.insertElement, insertShape: E.insertShape, insertChart: E.insertChart, insertImage: E.insertImage,
      shapes: SHAPES, elements: ELEMENTS,
      newSlide: E.newSlide, dupSlide: E.duplicateSlide, delSlide: E.deleteSlide, moveSlide: E.moveSlide,
      moveSlideTo: E.moveSlideTo, goSlide: E.goSlide,
      setLayout: E.setLayout, currentLayout: () => (E.currentSlide() || {}).dataset?.layout || 'default', footer: E.footerPanel,
      data: E.dataPanel, undo: () => { E.clearSel(); M.undo(); }, redo: () => { E.clearSel(); M.redo(); }, save,
      help: V.helpPanel, resizeCharts: C.resizeCharts
    };
    btns = V.toolbar(handlers);
    side = V.sidebar(handlers);
    ready.then(() => side.rebuild()); // editing opened before the charts finished loading
    V.fit();
    E.init(handlers);
    M.on('dirty', d => btns.setDirty(d));
    M.on('draft-error', () => V.banner('The browser cannot store the draft. Save the file to keep your changes.', [], 6000));
    M.on('current', sl => { btns.setLabel('Slide ' + (M.slides().indexOf(sl) + 1)); side.highlight(sl); });
    M.on('selection', c => btns.setContext(c));
    M.on('editing', on => { if (on) side.rebuild(); });
    M.on('change', s => side.update(s));
    // Undo/redo replaces the slide: thumbnail links must also be
    // rebuilt towards the new elements of the document.
    M.on('replaced', () => side.rebuild());
    M.on('deck', () => side.rebuild());
    addEventListener('beforeunload', e => { if (M.state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    const draft = M.readDraft();
    if (draft) {
      const when = new Date(draft.t).toLocaleString('en-US');
      V.banner(draft.foreign
        ? `Unsaved changes from a different version of this file found (${when}). Restoring replaces the current content with that older draft.`
        : draft.foreign === null
          ? `Unsaved changes found (${when}). They were kept by an earlier version of the editor, which did not record the file version; check them after restoring.`
          : `Unsaved changes found (${when}).`, [
        [draft.foreign ? 'Restore older draft' : 'Restore', () => {
          M.restoreDraft(draft);
          E.currentSlide(); V.fit();
        }],
        ['Discard', M.dropDraft]
      ]);
    }
  }

  M.on('replaced', s => {
    const wasCurrent = M.state.current?.id === s.id;
    V.chrome(s); M.resolveAssets(s); s.querySelectorAll('figure.chart').forEach(C.renderChart); E.clearSel();
    if (wasCurrent) E.setCurrent(s);
  });
  M.on('change', s => { V.chrome(s); C.resizeCharts(s); });
  // deck structure changed (slide added, deleted, moved, undone): redraw everything
  M.on('deck', () => {
    M.resolveAssets(main);
    V.chromeAll();
    charts().filter(f => !f.classList.contains('live')).forEach(C.renderChart);
    E.clearSel();
    if (M.state.current && M.state.current.isConnected) M.emit('current', M.state.current);
  });
  addEventListener('resize', () => { V.fit(); });

  window.deckEngine = {
    version: M.VERSION,
    ready,
    serialize,
    charts: Object.keys(C.registry),
    validateCharts: () => charts().map(fig => ({ slide: M.slideOf(fig).id, id: fig.dataset.id, type: fig.dataset.type, errors: C.validate(fig) })),
    renderAll: () => charts().forEach(C.renderChart),
    selection: () => E.selection().map(el => el.dataset.id),
    insertImageFile: E.insertImageFile
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
