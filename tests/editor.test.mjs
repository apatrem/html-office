// Test de bout en bout de l'éditeur (Playwright, navigateur sans interface), à une échelle < 1.
// Usage : node tests/editor.test.mjs [deck.html]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadPlaywright, ASSETS, upgrade } from '../plugin/skills/html-slides/tools/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'decks/community-garden.html'));
const tmp = path.join(path.dirname(file), '.test-copy.html');
const saved = path.join(path.dirname(file), '.test-saved.html');
const copyDeck = f => fs.writeFileSync(tmp, upgrade(fs.readFileSync(f,'utf8')));
copyDeck(file);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC') + ' ' + m); if (!c) fails++; };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.route(/echarts@[^/]+\/dist\/echarts(\.min)?\.js/, r => opts.offline ? r.abort()
    : r.fulfill({ path: path.join(ASSETS, 'echarts.min.js'), contentType: 'application/javascript', headers:{'access-control-allow-origin':'*'} }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(pathToFileURL(tmp).href);
  await page.waitForFunction(() => window.deckEngine);
  await page.evaluate(() => window.deckEngine.ready);
  return { ctx, page, errs };
}
const attr = (page, sel, a) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n), [sel, a]);
const pos = async (page, sel) => {
  const st = await attr(page, sel, 'style') || '';
  return Object.fromEntries([...st.matchAll(/--(\w):(-?[\d.]+)/g)].map(m => [m[1], Number(m[2])]));
};
async function dragBy(page, sel, dx, dy, { alt = false, at = [30, 15] } = {}) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + at[0], b.y + at[1]);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(b.x + at[0] + dx / 2, b.y + at[1] + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + at[0] + dx, b.y + at[1] + dy, { steps: 4 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

// 0. Détacher une slide ne doit rien changer à son rendu (typographie, retours à la ligne, positions)
for (const deck of [file, path.join(ROOT, 'decks/catalogue.html')]) {
  copyDeck(deck);
  const o = await open();
  const diffs = await o.page.evaluate(() => {
    const out = [];
    const props = ['fontSize', 'fontWeight', 'fontStyle', 'color', 'letterSpacing', 'textTransform', 'lineHeight', 'backgroundColor'];
    document.querySelectorAll('main#deck > section.slide').forEach(slide => {
      const items = [...slide.children].filter(el => el.dataset.id);
      const all = items.flatMap(el => [el, ...el.querySelectorAll('*:not(svg *):not([data-ui] *)')]).filter(n => !n.closest('[data-ui], svg'));
      const k = slide.getBoundingClientRect().width / 1280, sr = slide.getBoundingClientRect();
      const snap = () => all.map(n => { const cs = getComputedStyle(n), r = n.getBoundingClientRect();
        return { st: props.map(p => cs[p]).join('|'), x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, h: r.height / k }; });
      const a = snap();
      const pos = items.map(el => { const r = el.getBoundingClientRect(); return [el, (r.left - sr.left) / k, (r.top - sr.top) / k, Math.ceil(r.width / k - 0.01) + 1, Math.ceil(r.height / k - 0.01)]; });
      slide.setAttribute('data-detached', '');
      pos.forEach(([el, x, y, w, h]) => el.setAttribute('style', `--x:${Math.round(x)};--y:${Math.round(y)};--w:${w};--h:${h}`));
      const b = snap();
      a.forEach((v, i) => {
        const n = all[i], w = b[i], tag = `${slide.id} ${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}`;
        if (v.st !== w.st) out.push(`${tag} : style ${v.st} → ${w.st}`);
        else if (Math.abs(v.h - w.h) > 1.5) out.push(`${tag} : hauteur ${v.h.toFixed(0)} → ${w.h.toFixed(0)} (retour à la ligne)`);
        else if (Math.abs(v.x - w.x) > 1.5 || Math.abs(v.y - w.y) > 1.5) out.push(`${tag} : position (${v.x.toFixed(0)},${v.y.toFixed(0)}) → (${w.x.toFixed(0)},${w.y.toFixed(0)})`);
      });
    });
    return out;
  });
  ok(diffs.length === 0, `détacher ne change pas le rendu (${path.basename(deck)})` + (diffs.length ? ' :\n      ' + diffs.slice(0, 12).join('\n      ') : ''));
  await o.ctx.close();
}
copyDeck(file);

let { ctx, page, errs } = await open();
await page.keyboard.press('e');
const s = Number(await page.evaluate(() => getComputedStyle(document.getElementById('deck')).getPropertyValue('--s')));
ok(s < 1, `échelle réduite pour le test (${s})`);
ok(await page.evaluate(() => document.body.classList.contains('hs-editing')), 'mode édition activé par E');

// 1. Déplacement libre (Alt) : 100 px à l'écran = 100 / échelle en coordonnées de slide
await page.locator('#s04').scrollIntoViewIfNeeded();
await dragBy(page, '#s04 > h1', 100, 0, { alt: true });
ok(await page.evaluate(() => document.querySelector('#s04').hasAttribute('data-detached')), 'slide détachée au premier déplacement');
let p = await pos(page, '#s04 > h1');
ok(near(p.x, 64 + 100 / s, 2), `déplacement exact malgré l'échelle (x = ${p.x}, attendu ${(64 + 100 / s).toFixed(0)})`);

// 2. Déplacement aimanté : la position tombe sur la grille de 8 px ou sur un repère
await dragBy(page, '#s04 > h1', -37, 13);
p = await pos(page, '#s04 > h1');
ok(Number.isInteger(p.x) && Number.isInteger(p.y), `déplacement aimanté (x = ${p.x}, y = ${p.y})`);

// 3. Un simple clic ne détache pas la slide
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > .body').click();
ok(await page.evaluate(() => !document.querySelector('#s05').hasAttribute('data-detached')), 'simple clic : la slide garde son layout');
ok(await page.evaluate(() => document.querySelectorAll('.moveable-control-box .moveable-control').length >= 8), 'poignées Moveable affichées');

// 4. Annuler / rétablir
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
ok(await page.evaluate(() => !document.querySelector('#s04').hasAttribute('data-detached')), 'annuler ×2 : la slide retrouve son layout');
await page.keyboard.press('Control+Shift+z');
ok(await page.evaluate(() => document.querySelector('#s04').hasAttribute('data-detached')), 'rétablir : le déplacement revient');

// 5. Redimensionnement par la poignée est
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > h1').click();
const w0 = (await pos(page, '#s04 > h1')).w;
await page.locator('.moveable-control.moveable-e').first().waitFor({state:'visible'});
const hb = await page.locator('.moveable-control.moveable-e').first().boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x - 60, hb.y + hb.height / 2, { steps: 6 });
await page.mouse.up();
const w1 = (await pos(page, '#s04 > h1')).w;
ok(w1 < w0 - 50, `redimensionnement (largeur ${w0} → ${w1})`);

// 6. Sélection au rectangle puis déplacement de groupe
await page.keyboard.press('Escape');
await page.locator('#s08').scrollIntoViewIfNeeded();
const sb = await page.locator('#s08').boundingBox();
await page.mouse.move(sb.x + 8 * s, sb.y + 200 * s);
await page.mouse.down();
await page.mouse.move(sb.x + 600 * s, sb.y + 400 * s, { steps: 6 });
await page.mouse.move(sb.x + 1272 * s, sb.y + 560 * s, { steps: 6 });
await page.mouse.up();
const selected = await page.evaluate(() => window.deckEngine.selection());
ok(selected.length >= 2, 'rectangle selects the table and its commentary');
const before = await page.evaluate(() => {
  const slide = document.querySelector('#s08'), sr = slide.getBoundingClientRect(), scale = sr.width / 1280;
  return ['table', '.callout'].map(sel => ({y: (slide.querySelector(sel).getBoundingClientRect().top - sr.top) / scale}));
});
await dragBy(page, '#s08 > table', 0, 40, { alt: true, at: [40, 40] });
const after = [await pos(page, '#s08 > table'), await pos(page, '#s08 > .callout')];
ok(after[0].y > before[0].y + 30 && after[1].y > before[1].y + 30, `déplacement de groupe (tableau y ${after[0].y}, encadré y ${after[1].y})`);

// 7. Mise en forme d'éléments : taille, fond, gras, effacer
await page.keyboard.press('Escape');
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > .body').click();
const tb = sel => page.locator(`.hs-toolbar button[title^="${sel}"]`).first();
await tb('Increase text size').click();
await tb('Tinted fill').click();
await tb('Bold').click();
let cls = await attr(page, '#s05 > .body', 'class');
ok(/fs-/.test(cls) && /bg-tint/.test(cls) && /t-bold/.test(cls), `taille, fond et gras appliqués (${cls})`);
await tb('Clear formatting').click();
cls = await attr(page, '#s05 > .body', 'class');
ok(!/fs-|bg-|t-bold/.test(cls), `mise en forme effacée (${cls})`);

// 8. Couleur sur une partie du texte
await page.locator('#s05 > .body').dblclick();
await page.evaluate(() => {
  const p = document.querySelector('#s05 > .body p:nth-of-type(2)');
  const t = p.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 8);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await tb('Alert').click();
await page.keyboard.press('Escape');
const html = await page.evaluate(() => document.querySelector('#s05 > .body').innerHTML);
ok(/<span class="c-alert">A shared<\/span>/.test(html), 'couleur de la charte appliquée à un mot');
ok(await page.evaluate(() => !document.querySelector('#s05 > .body').hasAttribute('contenteditable')), 'sortie du mode texte');

// 9. Texte en place
await page.locator('#s05 > .body').dblclick();
await page.keyboard.press('Control+End');
await page.keyboard.type(' Ajout test.');
await page.keyboard.press('Escape');
ok((await page.locator('#s05 > .body').textContent()).includes('Ajout test.'), 'texte modifié en place');

// 10. Panneau de données du waterfall
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > figure.chart').click({ position: { x: 300, y: 200 } });
await page.locator('.hs-toolbar button', { hasText: 'Data' }).click();
ok(await page.locator('.hs-panel').isVisible(), 'panneau de données ouvert');
await page.locator('.hs-panel table tr').nth(2).locator('input').nth(1).fill('40');
await page.locator('.hs-panel button', { hasText: 'Apply' }).click();
const items = await page.evaluate(() => JSON.parse(document.querySelector('#s04 figure.chart > script').textContent).items);
ok(items[1].value === 40, 'données du graphique mises à jour (34 → 40)');

// 10b. Slides : nouvelle, dupliquer, supprimer, monter, mise en page, pied de page, annulation
const nSlides = () => page.evaluate(() => document.querySelectorAll('main#deck > section.slide').length);
const n0 = await nSlides();
await page.locator('#s02').scrollIntoViewIfNeeded();
await page.locator('#s02 > .body').click();
await page.keyboard.press('Escape');
ok((await page.locator('.hs-toolbar .hs-cur').textContent()) === 'Slide 2', 'slide courante affichée dans la barre (Slide 2)');
await page.locator('.hs-side .hs-add').click();
await page.locator('.hs-menu button', { hasText: 'Section divider' }).click();
let order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id + ':' + (s.dataset.layout || '')));
ok(await nSlides() === n0 + 1 && order[2].endsWith(':section'), `nouvelle slide « Intercalaire » insérée après la slide 2 (${order[2]})`);
const newId = order[2].split(':')[0];
ok(await page.evaluate(id => document.querySelector('#' + id + ' > .hs-foot span:last-child')?.textContent === '3', newId), 'numéros de page recalculés');
await page.keyboard.press('Control+z');
ok(await nSlides() === n0, 'annuler : la nouvelle slide disparaît');
await page.locator('#s04').scrollIntoViewIfNeeded();
await page.locator('#s04 > .stack').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Escape');
await page.locator('.hs-ctx button[title="Duplicate the current slide"]').click();
await page.waitForTimeout(200);
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
const dup = order[order.indexOf('s04') + 1];
ok(await nSlides() === n0 + 1 && await page.evaluate(id => document.querySelector('#' + id + ' figure.chart')?.classList.contains('live'), dup), `slide dupliquée avec son graphique (${dup})`);
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].map(e => e.dataset.id));
ok(new Set(ids).size === ids.length, 'identifiants uniques après duplication');
// miniatures : une par slide, glisser-déposer pour réordonner
await page.waitForTimeout(100);
const nThumbs = await page.locator('.hs-side .hs-thumb').count();
ok(nThumbs === n0 + 1, `miniatures à gauche (${nThumbs})`);
const thumbOf = id => page.locator('.hs-side .hs-thumb').nth(order.indexOf(id));
await thumbOf(dup).dragTo(thumbOf('s04'), { targetPosition: { x: 80, y: 10 } });
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
ok(order.indexOf(dup) === order.indexOf('s04') - 1, 'slide déplacée par glisser-déposer de sa miniature');
await page.keyboard.press('Control+z');
order = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].map(s => s.id));
ok(order.indexOf(dup) === order.indexOf('s04') + 1, 'annuler : ordre d\'origine');
await page.locator('.hs-side .hs-thumb').nth(2).click();
ok((await page.locator('.hs-ctx .hs-cur').textContent()) === 'Slide 3', 'clic sur une miniature : slide 3 courante');
await page.locator('.hs-side .hs-thumb').nth(order.indexOf(dup)).click();
await page.locator('.hs-ctx button[title="Delete the current slide"]').click();
ok(await nSlides() === n0, 'slide supprimée');
await page.locator('#s05').scrollIntoViewIfNeeded();
await page.locator('#s05 > h1').click();
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Layout', exact: true }).click();
await page.locator('.hs-menu button', { hasText: 'Panel 1/3' }).click();
ok(await attr(page, '#s05', 'data-layout') === 'panel-13', 'mise en page changée (panneau 1/3)');
await page.keyboard.press('Control+z');
ok(await attr(page, '#s05', 'data-layout') === 'default', 'annuler : mise en page d\'origine');
await page.locator('.hs-ctx button', { hasText: 'Footer' }).click();
await page.locator('.hs-panel input').first().fill('Mon pied de page');
await page.locator('.hs-panel input[type=checkbox]').check();
await page.locator('.hs-panel button', { hasText: 'Apply' }).click();
ok(await page.evaluate(() => document.getElementById('deck').dataset.footer) === 'Mon pied de page'
  && await page.evaluate(() => !document.querySelector('#s05 > .hs-foot') && document.querySelector('#s04 > .hs-foot span').textContent === 'Mon pied de page'),
  'pied de page modifié, masqué sur la slide courante');

// 10c. Insertion d'éléments
const before5 = await page.evaluate(() => document.querySelectorAll('#s05 > [data-id]').length);
await page.locator('.hs-top button', { hasText: 'Block' }).click();
await page.locator('.hs-menu button', { hasText: 'Tinted box' }).click();
await page.keyboard.type('Nouvelle boîte');
await page.keyboard.press('Escape');
const box = await page.evaluate(() => { const b = [...document.querySelectorAll('#s05 > .box')].pop(); return b && { t: b.textContent, d: document.querySelector('#s05').hasAttribute('data-detached'), st: b.getAttribute('style') }; });
ok(box && box.t === 'Nouvelle boîte' && box.d && /--x/.test(box.st), `boîte insérée, positionnée et saisie (${box && box.st})`);
await page.locator('.hs-top button', { hasText: 'Chart' }).click();
await page.locator('.hs-menu button', { hasText: 'Waterfall' }).click();
ok(await page.locator('.hs-panel').isVisible(), 'graphique inséré : panneau de données ouvert');
await page.locator('.hs-panel button', { hasText: 'Cancel' }).click();
ok(await page.evaluate(() => !!document.querySelector('#s05 > figure.chart[data-type=waterfall].live')), 'cascade insérée et dessinée');
page.once('dialog', d => d.accept('Logo de test'));
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 100; c.getContext('2d').fillRect(0, 0, 200, 100);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.deckEngine.insertImageFile(new File([blob], 'logo.png', { type: 'image/png' }));
});
const img = await page.evaluate(() => { const i = document.querySelector('#s05 > img[data-asset]'); return i && { alt: i.alt, w: i.naturalWidth, a: JSON.parse(document.getElementById('assets').textContent)[i.dataset.asset]?.type }; });
ok(img && img.alt === 'Logo de test' && img.w === 200 && /image\/(webp|jpeg)/.test(img.a), `image insérée et intégrée (${img && img.a})`);
ok(await page.evaluate(() => document.querySelectorAll('#s05 > [data-id]').length) === before5 + 3, 'boîte, graphique et image ajoutés (la slide avait déjà une source)');

// 10d. Image retirée par annulation : absente du fichier enregistré, de retour après rétablir
const assetOf = () => page.evaluate(() => document.querySelector('#s05 > img[data-asset]')?.dataset.asset);
const aid = await assetOf();
const hasAsset = id => page.evaluate(id => id in JSON.parse(window.deckEngine.serialize().match(/<script id="assets" type="application\/json">([\s\S]*?)<\/script>/)[1]), id);
ok(await hasAsset(aid), 'image présente dans le fichier enregistré');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
ok(!(await assetOf()) && !(await hasAsset(aid)), 'image annulée : retirée du fichier enregistré');
await page.keyboard.press('Control+Shift+z');
ok((await assetOf()) === aid && await page.evaluate(() => document.querySelector('#s05 > img').naturalWidth === 200), 'rétablir : l\'image revient (gardée en mémoire)');

// 10e. Formes
await page.keyboard.press('Escape');
const pad0 = await page.evaluate(() => document.getElementById('deck').style.paddingTop);
await page.locator('.hs-top button', { hasText: 'Shape' }).click();
await page.locator('.hs-menu button', { hasText: 'Chevron' }).click();
const shape = await page.evaluate(() => { const e = [...document.querySelectorAll('#s05 > .shape')].pop(); return e && { k: e.dataset.shape, st: e.getAttribute('style'), clip: getComputedStyle(e).clipPath, sel: window.deckEngine.selection().includes(e.dataset.id) }; });
ok(shape && shape.k === 'chevron' && /--w:216/.test(shape.st) && shape.clip.startsWith('polygon') && shape.sel, `chevron inséré et sélectionné (${shape && shape.st})`);
ok(await page.evaluate(() => document.getElementById('deck').style.paddingTop) === pad0, 'la barre contextuelle ne décale pas les slides');
await page.locator('.hs-ctx button[title="Mid blue fill"]').click();
await page.locator('#s05 > .shape').last().dblclick();
await page.keyboard.type('Phase 1');
await page.keyboard.press('Escape');
const sh2 = await page.evaluate(() => { const e = [...document.querySelectorAll('#s05 > .shape')].pop(); return { c: e.className, t: e.textContent }; });
ok(/bg-mid/.test(sh2.c) && sh2.t === 'Phase 1', `forme remplie et légendée (${sh2.c} « ${sh2.t} »)`);

// 10f. Tableau : lignes et colonnes
await page.keyboard.press('Escape');
await page.locator('.hs-top button', { hasText: 'Table' }).click();
await page.keyboard.press('Escape');
const tsel = '#s05 > table.t:last-of-type';
const dims = () => page.evaluate(s => { const t = [...document.querySelectorAll('#s05 > table.t')].pop(); return [t.rows.length, t.rows[0].cells.length, t.rows[2].cells[0].textContent]; }, tsel);
const d0 = await dims();
ok(await page.evaluate(() => document.querySelector('.hs-ctx').classList.contains('has-table')), 'tableau sélectionné : outils de tableau affichés');
await page.locator('#s05 > table.t').last().dblclick({ position: { x: 20, y: 40 } });
await page.evaluate(() => { const t = [...document.querySelectorAll('#s05 > table.t')].pop(); const c = t.rows[1].cells[0]; const r = document.createRange(); r.selectNodeContents(c); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await page.locator('.hs-ctx button[title^="Insert a row"]').click();
await page.keyboard.type('Nouvelle ligne');
const typed = (await dims())[2];
await page.locator('.hs-ctx button[title="Delete the current column"]').click();
await page.keyboard.press('Escape');
const d1 = await dims();
ok(d1[0] === d0[0] + 1 && d1[1] === d0[1] - 1 && typed === 'Nouvelle ligne', `ligne ajoutée sous la ligne courante et saisie, colonne supprimée (${d0.slice(0, 2)} → ${d1.slice(0, 2)}, « ${typed} »)`);
await page.keyboard.press('Control+z');
const d2 = await dims();
ok(d2[0] === d0[0] && d2[1] === d0[1], 'annuler : tableau d\'origine');
await page.keyboard.press('Control+Shift+z');

// 11. Sérialisation propre
const out = await page.evaluate(() => window.deckEngine.serialize());
const mainZone = out.match(/<main[\s\S]*?<\/main>/)[0];
// Le guide peut citer l'interface : vérifier les éléments enregistrés, pas les mots de sa documentation.
const runtimeNodes = await page.evaluate(html => {
  const d = new DOMParser().parseFromString(html,'text/html');
  return d.querySelectorAll('[data-ui],.hs-toolbar,.selecto-selection,[class*="moveable"],[class*="selecto"]').length;
}, out);
ok(runtimeNodes === 0, 'ni Moveable, ni Selecto, ni interface dans le fichier enregistré');
ok(!/contenteditable|class="[^"]*\blive\b/.test(mainZone) && !/<main[^>]*style=/.test(mainZone), 'pas d\'état d\'édition enregistré');
ok((mainZone.match(/<svg[^>]*class="render"/g) || []).length >= 4 && /<script id="engine"/.test(out), 'copies SVG et moteur présents');
ok((out.match(/<style\b/g) || []).length === 2, 'seules les feuilles de style d\'origine (charte, thème) sont enregistrées');

// 12. Enregistrement (repli par téléchargement), réouverture, vérificateur
await page.evaluate(() => { delete window.showSaveFilePicker; });
const dl = page.waitForEvent('download');
await page.keyboard.press('Control+s');
await (await dl).saveAs(saved);
const sv = fs.readFileSync(saved, 'utf8');
ok(sv.includes('Ajout test.') && sv.includes('"value":40') && sv.includes('c-alert'), `fichier enregistré complet (${(sv.length / 1024).toFixed(0)} Ko)`);
ok(errs.length === 0, 'aucune erreur JavaScript' + (errs.length ? ' : ' + errs.join(' | ') : ''));
await ctx.close();
let checkOut = '', checkPassed = true;
try { checkOut = execFileSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/check.mjs'), saved], { encoding: 'utf8' }); }
catch (e) { checkPassed=false;checkOut=(e.stdout || '')+(e.stderr || ''); }
ok(checkPassed, 'le fichier édité passe le vérificateur' + (!checkPassed ? ' : '+checkOut : ''));

fs.copyFileSync(saved, tmp);
({ ctx, page, errs } = await open());
ok(await page.evaluate(() => document.querySelector('#s05 > .body').textContent.includes('Ajout test.')), 'réouverture du fichier enregistré');
await page.keyboard.press('p');
await page.waitForTimeout(200);
const vis = await page.evaluate(() => [...document.querySelectorAll('main#deck > section.slide')].filter(s => getComputedStyle(s).display !== 'none').length);
ok(vis === 1, 'présentation : une seule slide visible');
await page.keyboard.press('Escape');
await ctx.close();

// 13. Hors connexion : copie SVG affichée
({ ctx, page, errs } = await open({ offline: true }));
await page.waitForTimeout(300);
const off = await page.evaluate(() => [...document.querySelectorAll('figure.chart')].map(f => !f.classList.contains('live') && (f.querySelector(':scope > svg.render')?.getBoundingClientRect().height || 0) > 80));
ok(off.every(Boolean), `hors connexion : ${off.length} graphiques affichés depuis leur copie SVG`);
await ctx.close();

await browser.close();
fs.rmSync(tmp); fs.rmSync(saved);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent.');
process.exit(fails ? 1 : 0);
