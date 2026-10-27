// Entry point of the html-slides engine (MIT). Bundled into one script by tools/build.mjs
// and copied into every deck: <script id="engine" data-version="…">.
import * as M from './model.js';
import * as C from '../../packages/shared/charts/index.mjs';
import * as V from './view.js';
import * as E from './editor.js';
import { slideCommands } from './commands.js';
import { mountShell } from './shell.js';

function boot() {
  const main = document.getElementById('deck');
  if (!main || window.deckEngine) return;
  M.state.main = main;
  M.state.bodyClass = document.body.getAttribute('class') || '';
  M.captureShell(); // before any injection: only these nodes are saved
  M.syncLook(); // the deck's theme and font, before charts read the charte tokens
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

  // A theme or font change (or its undo) redraws every chart in the new colours and font, before
  // the thumbnails are rebuilt from the slides.
  let look = M.look();
  M.on('deck', () => {
    M.syncLook();
    if (M.look() === look) return;
    look = M.look();
    charts().forEach(C.renderChart);
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
    const commands = slideCommands(save);
    const shell = mountShell(commands);
    const side = V.sidebar({ goSlide: E.goSlide, dupSlide: E.duplicateSlide, delSlide: E.deleteSlide, moveSlideTo: E.moveSlideTo,
      newSlideItems: shell.newSlideItems });
    ready.then(() => side.rebuild()); // editing opened before the charts finished loading
    V.fit();
    E.init({ save, toggleEdit: E.toggleEdit, help: V.helpPanel, resizeCharts: C.resizeCharts });
    // The shell shows the selection, the current slide, history and the save state.
    for (const ev of ['dirty', 'selection', 'editing', 'change', 'replaced', 'deck']) M.on(ev, () => commands.changed());
    M.on('draft-error', () => V.banner('The browser cannot store the draft. Save the file to keep your changes.', [], 6000));
    M.on('current', sl => { side.highlight(sl); commands.changed(); });
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
    // A restored structure has new slide elements: the current slide is found again by its id,
    // otherwise (it was removed) the slide at the centre of the screen becomes current.
    const cur = M.state.current;
    if (cur && !cur.isConnected) {
      const again = document.getElementById(cur.id);
      if (again?.matches('main#deck > section.slide')) E.setCurrent(again); else E.currentSlide();
    } else if (cur) M.emit('current', cur);
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
