// Builds the U02 shell mock-ups: one self-contained HTML page per variant and
// product, plus index.html. Usage: node docs/mockups/shell/build.mjs
// Screenshots and measurements: node docs/mockups/shell/screenshots.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { VARIANTS, PRODUCTS, panelsFor, canvasFor, menus } from "./src/variants.mjs";
import { esc } from "./src/parts.mjs";

const here = (p) => new URL(p, import.meta.url);
const css = readFileSync(here("src/shell.css"), "utf8");
const js = readFileSync(here("src/shell.js"), "utf8");
const defaultCharte = readFileSync(here("../../../src/theme/default.css"), "utf8");

// Built-in chartes: placeholders until TH01 designs and checks them.
export const THEMES = {
  document: { bg: "#FFFFFF", ink: "#1F1A33", acc: "#5B3B8C", mid: "#8E6BBF", lig: "#D3C4E8", alert: "#C2521C", tint: "#F3F0F8", callout: "#EEE8F6", bd: "#DCD5E6", t2: "#625A70" },
  blue: { ink: "#0B1C2C", acc: "#14517A", mid: "#4F7FA3", lig: "#AFC5D4", alert: "#C2521C", tint: "#ECEFF2", callout: "#E9EEF2", bd: "#D7DDE3", t2: "#5A6670" },
  red: { ink: "#2A1215", acc: "#A3192E", mid: "#CF5F6F", lig: "#EBB9C0", alert: "#B45309", tint: "#F8EEEF", callout: "#F5E7E9", bd: "#E6D3D6", t2: "#6E5A5D" },
  green: { ink: "#10241A", acc: "#1E6B47", mid: "#4F9A72", lig: "#B9D9C6", alert: "#C2521C", tint: "#EEF4F0", callout: "#E6F0EA", bd: "#D2E0D7", t2: "#56665C" },
  black: { ink: "#111111", acc: "#2B2B2B", mid: "#6E6E6E", lig: "#C4C4C4", alert: "#C62828", tint: "#F1F1F1", callout: "#ECECEC", bd: "#D9D9D9", t2: "#616161" },
};
const FONTS = {
  arial: "Arial, Helvetica, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Verdana, sans-serif",
  trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
};
const tokens = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";");
const themeCSS =
  Object.entries(THEMES)
    .filter(([k]) => k !== "document")
    .map(([k, t]) => `html[data-theme=${k}]{${tokens(t)}}`)
    .join("\n") +
  "\n" +
  Object.entries(THEMES)
    .map(([k, t]) => `.th-${k}{${Object.entries(t).map(([n, v]) => `--t-${n}:${v}`).join(";")}}`)
    .join("\n") +
  "\n" +
  Object.entries(FONTS)
    .map(([k, v]) => `html[data-font=${k}]{--doc-font:${v}}`)
    .join("\n");
// The document's own charte: the html-slides default file with the fictional organisation colours.
const documentCharte = defaultCharte.replace(/:root\{[\s\S]*?--font:/, `:root{\n  ${tokens(THEMES.document).replaceAll(";", ";\n  ")};\n  --font:`);

const DEFAULTS = {
  a: { slides: { panel: "settings" }, data: { panel: "styles" }, text: { panel: "comments" } },
  b: { slides: { panel: "none", tab: "document" }, data: { panel: "styles", tab: "home" }, text: { panel: "comments", tab: "review" } },
  c: { slides: { panel: "settings" }, data: { panel: "styles" }, text: { panel: "comments" } },
};

export function file(v, p) {
  return `${v}-${p}.html`;
}

export function page(v, p) {
  const d = DEFAULTS[v][p];
  const shell = VARIANTS[v].build(p, { tab: d.tab });
  const title = `Shell ${VARIANTS[v].short} · ${PRODUCTS[p].name}`;
  return `<!doctype html>
<html lang="en" data-theme="blue" data-font="arial">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — html-office mock-up</title>
<meta name="description" content="Static mock-up for task U02 (variant ${v.toUpperCase()}, ${PRODUCTS[p].name}). Fictional content. Not product code.">
<style id="charte">${documentCharte}</style>
<style>${css}
${themeCSS}</style></head>
<body class="v-${v} p-${p}" data-variant="${v}" data-default="${d.panel}"${d.tab ? ` data-tab="${d.tab}"` : ""} data-panel="none">
<div class="app ${shell.overlay ? "overlay-panels" : ""}">
${shell.top}
<div class="work">${canvasFor(p)}<aside class="panels" aria-label="Side panel">${panelsFor(p, v)}</aside>${shell.rail ?? ""}${shell.pill}</div>
${shell.bottom}
</div>
${menus(p)}
<script>${js}</script>
</body></html>
`;
}

// ---------- index ----------
const CONCEPT = {
  a: {
    lead: "The working hypothesis of ADR-011 §7: a <b>menu bar</b> (identity, File/Edit/Insert/Format… menus, Save) above an <b>IronCalc-style icon toolbar</b>; Data adds its formula bar. Slides and Text get <b>floating settings</b> at the bottom right; Data has its <b>sheet tabs</b> with a settings button at the end.",
    where: [
      ["Top rows", "Row 1: product mark, title and save state, menus, Save (and Present). Row 2: one flat icon toolbar, grouped by separators; in Slides it follows the selection as today’s context bar does."],
      ["Formula bar (Data)", "Third row: name box, fx, value, scenario selector and calculation state."],
      ["Bottom", "Slides and Text: floating pill (Theme & font, slide/page count, zoom). Data: sheet tabs with groups, settings button at the right end."],
      ["Document settings", "Drawer opened from the pill or the sheet bar, and from File › Document settings."],
      ["Side panels", "Overlay drawer on the right (IronCalc’s right-drawer pattern): cell styles, regional settings, comments, document settings."],
      ["Narrow width", "Menus collapse into ☰; the toolbar scrolls with overflow arrows; panels become bottom sheets; the pill spans the width."],
    ],
    pros: ["Closest to IronCalc’s toolbar and R05: Data reuses most of the paid-for components.", "Every command is findable twice: menus are complete, the toolbar holds the frequent ones.", "Smallest change for Slides, which already has a top bar and a context bar."],
    cons: ["Two command surfaces to keep consistent (menus and toolbar).", "Icon-only toolbar relies on tooltips; harder for first-time users.", "The floating pill can cover content at the bottom right."],
  },
  b: {
    lead: "A <b>classic tabbed ribbon</b>: row 1 holds identity, tabs (Home, Insert, product tab, Document, View) and quick access; row 2 shows the active tab as <b>labelled groups</b>. Document settings get their own <b>Document tab</b>. Every product has a <b>status bar</b> at the bottom, which in Data carries the sheet tabs.",
    where: [
      ["Top rows", "Row 1: product mark, title and save state, tabs, Undo/Redo, Save (and Present). Row 2: the active tab’s groups with captions (70 px)."],
      ["Formula bar (Data)", "Third row, as in A."],
      ["Bottom", "Status bar everywhere: Data sheet tabs plus selection sum and count; Slides slide number and zoom; Text page, words, format and view switch."],
      ["Document settings", "Document tab inside the ribbon: theme cards, font, plus Data locale or Text page format."],
      ["Side panels", "Docked on the right, pushing the canvas: cell styles, regional settings, comments, outline."],
      ["Narrow width", "Tabs become a select; each group collapses to one button with a menu; panels become bottom sheets; the status bar shortens."],
    ],
    pros: ["Most familiar to Office users; labels make commands discoverable without tooltips.", "Document settings visible in one place for all products.", "Status bar gives a consistent home for counts, sums and view modes."],
    cons: ["Tallest chrome: least grid and slide area at 1440 × 900.", "Commands hidden behind tabs; one more click for many actions.", "Furthest from IronCalc: Data reuses fewer R05 components; Slides changes most."],
  },
  c: {
    lead: "A <b>single toolbar row</b> with the most-used formatting and a “⋯” overflow, plus a <b>vertical side rail</b> on the right that opens docked panels (Insert, Styles, Regional, Comments, Outline, Document, Help). Data keeps its formula bar and sheet tabs; Slides and Text have <b>nothing at the bottom</b>.",
    where: [
      ["Top rows", "One row: identity, frequent formatting, ⋯ for the rest, Save, ☰ for File and Help."],
      ["Formula bar (Data)", "Second row."],
      ["Bottom", "Data: sheet tabs. Slides and Text: none."],
      ["Document settings", "Rail › Document: theme and font, with product extras."],
      ["Side panels", "Rail-driven docked panels; Insert becomes a panel of tiles."],
      ["Narrow width", "The rail becomes a bottom navigation bar; panels open as sheets above it; the toolbar keeps a few essentials and ⋯."],
    ],
    pros: ["Most canvas height; one row of chrome in Slides and Text.", "One predictable place for every panel, which scales to future panels (charts, pivots).", "Works well on narrow screens (bottom navigation)."],
    cons: ["Rarely used formatting sits behind ⋯ menus.", "Rail costs 64 px of width on every screen.", "Less like IronCalc and Excel; Insert as a panel is unusual for Data."],
  },
};
const CRITERIA = [
  ["Rows of chrome above the canvas", { a: "2 (Data 3)", b: "2, ribbon 70 px (Data 3)", c: "1 (Data 2)" }],
  ["Bottom area", { a: "Floating pill / Data sheet tabs", b: "Status bar in all three", c: "Data sheet tabs only" }],
  ["Document settings", { a: "Pill or sheet-bar button → drawer", b: "Document ribbon tab", c: "Rail → Document panel" }],
  ["Side panels", { a: "Overlay drawer", b: "Docked, pushes canvas", c: "Docked from rail" }],
  ["Commands visible without a click", { a: "Most formatting (icons)", b: "Active tab only (labelled)", c: "Frequent formatting; rest in ⋯" }],
  ["Keyboard model", { a: "Menubar + one toolbar", b: "Tablist + toolbar per tab", c: "Toolbar + rail" }],
  ["Reuse of R05 IronCalc components", { a: "High (toolbar, drawer)", b: "Low (native ribbon)", c: "Medium (drawer panels)" }],
  ["Change from today", { a: "Slides small; Data replaces tabbed ribbon", b: "Slides large; Data close to today’s ribbon", c: "Slides medium; Data large" }],
];

export function index(measure = {}) {
  const m = (v, p, w) => measure[`${v}-${p}-${w}`];
  const fig = (v, p) => `<figure class="shot">
<a href="${file(v, p)}" title="Open the live mock-up"><img src="screenshots/${v}-${p}-1440.jpg" alt="Variant ${v.toUpperCase()}, ${PRODUCTS[p].name}, 1440 px wide" loading="lazy" width="1440" height="900"></a>
<a href="${file(v, p)}" class="narrow" title="Open the live mock-up"><img src="screenshots/${v}-${p}-375.jpg" alt="Variant ${v.toUpperCase()}, ${PRODUCTS[p].name}, 375 px wide" loading="lazy" width="375" height="812"></a>
<figcaption><a href="${file(v, p)}">${PRODUCTS[p].name}</a>${m(v, p, 1440) ? ` · canvas ${m(v, p, 1440).canvas}px at 1440×900${p === "data" ? `, ${m(v, p, 1440).rows} grid rows` : ""}` : ""}</figcaption></figure>`;
  const extra = (v) => `<div class="extras">
<figure><a href="${file(v, "data")}#regional"><img src="screenshots/${v}-data-regional-1440.jpg" alt="Variant ${v.toUpperCase()}, Data, regional settings" loading="lazy" width="1440" height="900"></a><figcaption>Data · regional settings</figcaption></figure>
<figure><a href="${file(v, "data")}#settings"><img src="screenshots/${v}-data-settings-1440.jpg" alt="Variant ${v.toUpperCase()}, Data, document settings" loading="lazy" width="1440" height="900"></a><figcaption>Data · document settings</figcaption></figure>
<figure><a href="${file(v, "text")}#settings"><img src="screenshots/${v}-text-settings-1440.jpg" alt="Variant ${v.toUpperCase()}, Text, document settings" loading="lazy" width="1440" height="900"></a><figcaption>Text · document settings</figcaption></figure>
<figure><a href="${file(v, "data")}#styles"><img src="screenshots/${v}-data-styles-375.jpg" alt="Variant ${v.toUpperCase()}, Data, cell styles at 375 px" loading="lazy" width="375" height="812" class="tall"></a><figcaption>Data · cell styles at 375 px</figcaption></figure>
</div>`;
  const measureRows = ["slides", "data", "text"]
    .map(
      (p) =>
        `<tr><th scope="row">${PRODUCTS[p].name}</th>${["a", "b", "c"]
          .map((v) => {
            const w = m(v, p, 1440),
              n = m(v, p, 375);
            if (!w) return "<td>—</td>";
            const fmt = (x) => `${x.canvas}px (${Math.round((x.canvas / x.vh) * 100)}%)${p === "data" ? ` · ${x.rows} rows` : p === "slides" ? ` · slide ${x.stage}px wide` : ""}`;
            return `<td>${fmt(w)}<br><span class="mute">375: ${fmt(n)}</span></td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editor shell mock-ups</title>
<meta name="description" content="U02: three layout variants of the shared html-office editor shell, each shown for Slides, Data and Text, for the user’s choice in U03.">
<style>
:root{--ink:#1d2a35;--mute:#5f6b75;--line:#dde1e6;--bg:#f6f7f9;--card:#fff;--acc:#2563eb;color-scheme:light}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg)}
header,main{max-width:1500px;margin:0 auto;padding:0 24px}header{padding-top:28px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:20px;margin:40px 0 12px}h3{font-size:16px;margin:0 0 8px}
p{max-width:78ch}.mute{color:var(--mute)}a{color:var(--acc)}
.note{background:#fff8e1;border:1px solid #f0d77a;border-radius:8px;padding:10px 14px;max-width:none}
.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}
.col{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.col>p{font-size:14px}
.shot{margin:14px 0 0;display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:start}
.shot img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px;background:#fff}
.shot figcaption{grid-column:1/-1;font-size:12.5px;color:var(--mute)}.shot figcaption a{font-weight:600}
dl{font-size:13.5px;margin:14px 0 0}dt{font-weight:600;margin-top:8px}dd{margin:2px 0 0;color:#36434e}
.pc{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;font-size:13.5px}.pc ul{margin:4px 0 0;padding-left:18px}.pc h4{margin:0;font-size:13px}
.extras{display:grid;grid-template-columns:1fr 1fr 1fr 90px;gap:10px;margin-top:14px}
.extras figure{margin:0}.extras img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block}
.extras figcaption{font-size:12px;color:var(--mute)}
table.cmp{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
.cmp th,.cmp td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.cmp thead th{background:#eef1f4}
.detail{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}
footer{max-width:1500px;margin:40px auto;padding:0 24px;color:var(--mute);font-size:13px}
@media (max-width:1000px){.cols{grid-template-columns:1fr}.extras{grid-template-columns:1fr 1fr}.pc{grid-template-columns:1fr}}
@media (max-width:520px){header,main{padding:0 16px}.shot{grid-template-columns:1fr 56px}.cmp{font-size:12.5px}.cmp th,.cmp td{padding:6px}}
</style></head><body>
<header><p class="mute">html-office · task U02 · 22 October 2026</p>
<h1>Editor shell mock-ups</h1>
<p>Three layout variants of the shared editor shell, each shown for Slides, Data and Text with their real command sets and fictional content (the Community Learning P&amp;L from <code>packages/data/fixtures/pnl.json</code>). The audit, command inventory and constraints are in the <a href="../../HTML-OFFICE-SHELL-BRIEF.md">design brief (U01)</a>.</p>
<p class="note"><b>Decision (U03, 22 October 2026): the user chose variant A — menu bar + icon toolbar.</b> B and C stay here for reference. Click any screenshot to open the live mock-up: menus, panels, theme and font switching work; nothing else does. Built-in theme colours are placeholders until TH01.</p>
</header>
<main>
<h2>Side by side</h2>
<p class="mute">Each card shows 1440 × 900 with the default panel open, and 375 × 812 with no panel.</p>
<div class="cols">${["a", "b", "c"]
    .map((v) => `<section class="col" aria-labelledby="h-${v}"><h3 id="h-${v}">${esc(VARIANTS[v].name)}</h3><p>${CONCEPT[v].lead}</p>${["slides", "data", "text"].map((p) => fig(v, p)).join("")}</section>`)
    .join("")}</div>

<h2>Comparison</h2>
<table class="cmp"><thead><tr><th scope="col">Criterion</th>${["a", "b", "c"].map((v) => `<th scope="col">${esc(VARIANTS[v].name)}</th>`).join("")}</tr></thead><tbody>
${CRITERIA.map(([c, r]) => `<tr><th scope="row">${c}</th>${["a", "b", "c"].map((v) => `<td>${r[v]}</td>`).join("")}</tr>`).join("\n")}
</tbody></table>
<h3 style="margin-top:22px">Measured canvas height</h3>
<p class="mute">Height left for the slide, grid or page, with no panel open, measured in Chromium at 1440 × 900 and 375 × 812 (share of the viewport). Data counts fully visible grid rows, including the header row.</p>
<table class="cmp"><thead><tr><th scope="col">Product</th>${["a", "b", "c"].map((v) => `<th scope="col">${esc(VARIANTS[v].short)}</th>`).join("")}</tr></thead><tbody>${measureRows}</tbody></table>

<h2>Variant details</h2>
${["a", "b", "c"]
    .map(
      (v) => `<section class="detail" aria-labelledby="d-${v}"><h3 id="d-${v}">${esc(VARIANTS[v].name)}</h3><p>${CONCEPT[v].lead}</p>
<dl>${CONCEPT[v].where.map(([k, d]) => `<dt>${k}</dt><dd>${d}</dd>`).join("")}</dl>
<div class="pc"><div><h4>For</h4><ul>${CONCEPT[v].pros.map((x) => `<li>${x}</li>`).join("")}</ul></div><div><h4>Against</h4><ul>${CONCEPT[v].cons.map((x) => `<li>${x}</li>`).join("")}</ul></div></div>
${extra(v)}
<p class="mute">Live: ${["slides", "data", "text"].map((p) => `<a href="${file(v, p)}">${PRODUCTS[p].name}</a>`).join(" · ")}</p></section>`,
    )
    .join("\n")}

<h2>Common to every variant</h2>
<ul>
<li>Shell chrome uses neutral greys; only the canvas and the colour swatches follow the document charte, so switching theme never recolours buttons.</li>
<li>Colour pickers offer only the closed token vocabulary of ADR-012 (6 text colours, 7 fills); Data has no font size; Slides keeps size steps.</li>
<li>Document settings are the same panel content in all products: theme (4 built-ins plus the document charte) and font (6 system fonts), plus Slides footer, Data regional settings or Text page format.</li>
<li>Planned commands appear dimmed with a “planned” tag in menus, so the mock-ups show where they will live without pretending they exist.</li>
<li>Toolbars use one tab stop with arrow keys; menus and panels close with Escape and return focus; print hides all chrome.</li>
</ul>
<h2>Questions for U03</h2>
<ol>
<li>Which variant, or which combination (for example A’s toolbar with C’s rail)?</li>
<li>Bottom of Slides and Text: floating settings, a status bar, or nothing?</li>
<li>Side panels: overlay (A) or docked (B, C)? Can two be open at once?</li>
<li>For Data, keep IronCalc’s components restyled to the shell, or replace them with shared native code?</li>
<li>Keep the Slides reading-mode pill as the shared “floating settings” pattern?</li>
</ol>
</main>
<footer>Generated by <code>docs/mockups/shell/build.mjs</code>; screenshots and measurements by <code>screenshots.mjs</code>. Static mock-ups only: no product code. Icons drawn for these mock-ups.</footer>
</body></html>
`;
}

export function buildAll() {
  for (const v of Object.keys(VARIANTS)) for (const p of Object.keys(PRODUCTS)) writeFileSync(here(file(v, p)), page(v, p));
  const mPath = here("screenshots/measurements.json");
  const measure = existsSync(mPath) ? JSON.parse(readFileSync(mPath, "utf8")) : {};
  writeFileSync(here("index.html"), index(measure));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildAll();
