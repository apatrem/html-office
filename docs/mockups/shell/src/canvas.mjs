// Product canvases (slide stage, grid, page) and side panels shared by every variant.
import { months, pnlRows, yearOne, fmt, columnChart, selected } from "./content.mjs";
import { icon, btn, esc } from "./parts.mjs";

// ---------- Slides ----------
const SLIDES = [
  ["Community Learning — year-one review", "cover"],
  [`Participants grew ${Math.round(yearOne.growth * 100)}% in year one, and every month made a profit`, "chart"],
  ["Fixed costs were covered from the first month", "bars"],
  ["2027 plan: 2% monthly growth keeps the programme self-funding", "kpi"],
  ["Next steps: confirm the venue and recruit two tutors", "text"],
];
export const slideCount = SLIDES.length;

function mini([title, kind], i) {
  const body =
    kind === "cover"
      ? '<i class="mn-cover"></i>'
      : kind === "chart" || kind === "bars"
        ? '<i class="mn-bars"><b></b><b></b><b></b><b></b><b></b></i>'
        : kind === "kpi"
          ? '<i class="mn-kpi"></i>'
          : '<i class="mn-lines"></i>';
  return `<li><button type="button" class="thumb${i === 1 ? " on" : ""}" aria-label="Slide ${i + 1}: ${esc(title)}" aria-current="${i === 1}"><span class="num">${i + 1}</span><span class="mini"><span class="mn-t">${esc(title)}</span>${body}</span></button></li>`;
}
export function thumbs() {
  return `<nav class="thumbs" aria-label="Slides"><ol>${SLIDES.map(mini).join("")}</ol>${btn({ ic: "plus", label: "New slide", text: "New slide", dd: true, menu: "m-newslide", cls: "add" })}</nav>`;
}
export function slideStage() {
  const values = months.slice(0, 12).map((m) => m.participants);
  const chart = columnChart({ values, labels: values.map((_, i) => `M${i + 1}`), highlight: [11], width: 620, height: 300, unit: "Monthly participants, year one" });
  return `<div class="stage-wrap"><section class="slide" aria-label="Slide 2 of ${SLIDES.length}">
<p class="sl-tracker">Year-one review</p>
<h1 class="sl-title">${esc(SLIDES[1][0])}</h1>
<div class="sl-cols"><figure class="sl-chart selected"><figcaption>Monthly participants, year one</figcaption>${chart}<span class="h h1"></span><span class="h h2"></span><span class="h h3"></span><span class="h h4"></span></figure>
<div class="sl-panel"><p class="sl-kpi">${fmt.eur(yearOne.net)}<small>net income, year one</small></p><p class="sl-body">Fixed costs of €1,500 a month were covered from month 1; the operating margin reached ${fmt.pct(months[11].margin)} by month 12.</p></div></div>
<p class="sl-foot"><span>Source: fictional management accounts · Community Learning</span><span>2</span></p>
</section></div>`;
}

// ---------- Data ----------
const COLS = Array.from({ length: 25 }, (_, i) => String.fromCharCode(65 + i));
export function grid() {
  const head = `<tr><th class="corner" aria-label="Select all"></th>${COLS.map((c) => `<th scope="col" class="${c === "C" ? "hsel" : ""}">${c}</th>`).join("")}</tr>`;
  const rows = [];
  rows.push(`<tr><th scope="row">1</th><td class="cs-header">Monthly P&amp;L</td>${months.map((m) => `<td class="cs-header num">${m.label}</td>`).join("")}</tr>`);
  pnlRows.forEach(([label, key, f, style], i) => {
    const r = i + 2;
    rows.push(
      `<tr><th scope="row" class="${r === 4 ? "hsel" : ""}">${r}</th><td class="cs-rowHeader">${label}</td>${months
        .map((m, j) => `<td class="num cs-${style}${r === 4 && j === 1 ? " active" : ""}">${f(m[key])}</td>`)
        .join("")}</tr>`,
    );
  });
  // Unwrapped text overflows into empty neighbours (ADR-012 §6); no merged cells.
  rows.push(`<tr><th scope="row">13</th><td class="cs-note overflow"><span>Forecast months grow participants by the Inputs!B2 rate.</span></td>${"<td></td>".repeat(24)}</tr>`);
  for (let r = 14; r <= 44; r++) rows.push(`<tr><th scope="row">${r}</th>${"<td></td>".repeat(25)}</tr>`);
  return `<div class="grid-wrap" tabindex="0" role="region" aria-label="Calculations sheet grid"><table class="grid"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table></div>`;
}
export function formulaBar({ scenario = true } = {}) {
  return `<div class="formula" role="group" aria-label="Formula bar">
<span class="mw"><button type="button" class="namebox" aria-label="Cell address ${selected.ref}" data-menu="m-goto" aria-haspopup="true" aria-expanded="false">${selected.ref}${icon("caret").replace('class="ic"', 'class="ic car"')}</button></span>
<span class="fx" aria-hidden="true">fx</span>
<span class="mw"><button type="button" class="b pick itype" aria-label="Input type: Formula" title="Input type" data-menu="m-itype" aria-haspopup="true" aria-expanded="false"><span class="lbl">Formula</span>${icon("caret").replace('class="ic"', 'class="ic car"')}</button></span>
<label class="fin"><span class="vh">Cell value</span><input value="${esc(selected.formula)}" spellcheck="false"></label>
${scenario ? `<span class="scen"><label for="scen">Scenario</label><select id="scen"><option>Base</option><option>Upside</option><option>Downside</option></select></span>` : ""}
<span class="calc ok" role="status" title="Results are current">${icon("check")}<span class="lbl">Calculated</span></span>
</div>`;
}
export function sheetTabs({ settings = false, stats = false } = {}) {
  const groups = [
    ["Summary", ["Summary"]],
    ["Inputs / Hypotheses", ["Inputs"]],
    ["Raw Data", ["Actuals"]],
    ["Calculations", ["Calculations"]],
  ];
  const g = groups
    .map(
      ([name, sheets]) =>
        `<div class="sg" role="group" aria-label="${esc(name)} sheet group"><button type="button" class="sg-name" aria-expanded="true" title="Collapse ${esc(name)}">${esc(name)}</button>${sheets
          .map((s) => `<button type="button" class="stab" aria-pressed="${s === "Calculations"}">${s}</button>`)
          .join("")}</div>`,
    )
    .join("");
  return `<nav class="sheets" aria-label="Sheets">${btn({ ic: "plus", label: "Add sheet", cls: "sm" })}${btn({ ic: "menu", label: "All sheets and groups", menu: "m-sheets", cls: "sm" })}<div class="sg-list">${g}</div>
<select class="sheet-select" aria-label="Sheet"><option>Summary</option><option>Inputs</option><option>Actuals</option><option selected>Calculations</option></select>
${stats ? `<span class="stats" role="status">Sum ${fmt.eur(months[1].revenue)} · Count 1</span>` : ""}
${settings ? `<span class="sheet-end">${btn({ ic: "sliders", label: "Document settings: theme, font, regional", panel: "settings", cls: "sm" })}</span>` : ""}</nav>`;
}

// ---------- Text ----------
export function page() {
  const y = yearOne;
  const rev = months.slice(0, 24).map((m) => m.revenue);
  const chart = columnChart({ values: rev, labels: rev.map((_, i) => (i % 3 === 0 ? `M${i + 1}` : "")), highlight: Array.from({ length: 12 }, (_, i) => i + 12), width: 640, height: 220, unit: "Monthly revenue" });
  return `<div class="desk"><article class="page" aria-label="Document page">
<p class="pg-run"><span>Community Learning · Business review and 2027 plan</span><span>Fictional example</span></p>
<h1 class="tx-h1"><span class="hn">1</span>Executive summary</h1>
<p class="tx-lead"><mark class="cm">Community Learning reached 155 monthly participants in its first year</mark>, up ${Math.round(y.growth * 100)}%, and made an operating profit every month.<sup class="fn">1</sup></p>
<p class="tx-body">Revenue for the year was ${fmt.eur(y.revenue)} against fixed costs of ${fmt.eur(y.fixed)}. Net income after tax was ${fmt.eur(y.net)}, which funds the 2027 plan without new borrowing (see <a class="xref" href="#t1">Table 1</a>).</p>
<div class="tx-callout"><strong>Key message.</strong> Holding the fee at €25 and growing participants by 2% a month keeps the programme self-funding through 2027.</div>
<p class="tx-cap" id="t1">Table 1 — First-year results</p>
<table class="tx-table"><thead><tr><th>Item</th><th class="n">Year one</th><th class="n">Per month</th></tr></thead><tbody>
<tr><td>Revenue</td><td class="n">${fmt.eur(y.revenue)}</td><td class="n">${fmt.eur(y.revenue / 12)}</td></tr>
<tr><td>Variable costs</td><td class="n">${fmt.eur(y.variable)}</td><td class="n">${fmt.eur(y.variable / 12)}</td></tr>
<tr><td>Fixed costs</td><td class="n">${fmt.eur(y.fixed)}</td><td class="n">${fmt.eur(y.fixed / 12)}</td></tr>
<tr><td>Tax</td><td class="n">${fmt.eur(y.tax)}</td><td class="n">${fmt.eur(y.tax / 12)}</td></tr>
<tr class="tot"><td>Net income</td><td class="n">${fmt.eur(y.net)}</td><td class="n">${fmt.eur(y.net / 12)}</td></tr></tbody></table>
<h1 class="tx-h1"><span class="hn">2</span>Outlook for 2027</h1>
<p class="tx-body">The forecast keeps fixed costs flat and assumes 2% monthly growth in participants. Figure 1 shows actual and forecast revenue.</p>
<figure class="tx-fig">${chart}<figcaption>Figure 1 — Monthly revenue, actual (months 1–12) and forecast (months 13–24)</figcaption></figure>
<h2 class="tx-h2"><span class="hn">2.1</span>Risks</h2>
<p class="tx-body">The main risk is venue capacity above 180 participants a month.</p>
</article></div>`;
}

// ---------- Side panels ----------
const STYLES = [
  ["normal", "Normal", "Default"],
  ["title", "Title", "Sheet or block title"],
  ["header", "Header", "Column header"],
  ["rowHeader", "Row label", "Row label"],
  ["assumption", "Assumption", "Input (Excel “Input”)"],
  ["calculation", "Calculation", "Calculated value"],
  ["output", "Output", "Key result"],
  ["total", "Total", "Total row"],
  ["note", "Note", "Comment or source"],
  ["alert", "Alert", "Value to watch"],
  ["hyperlink", "Hyperlink", "Applied to linked cells"],
];
const THEMES = [
  ["document", "Document charte", "Community Learning"],
  ["blue", "Blue", "Default"],
  ["red", "Red", ""],
  ["green", "Green", ""],
  ["black", "Black", "Greyscale + alert"],
];
const FONTS = [
  ["arial", "Arial", "default"],
  ["verdana", "Verdana", ""],
  ["tahoma", "Tahoma", ""],
  ["trebuchet", "Trebuchet MS", ""],
  ["georgia", "Georgia", ""],
  ["times", "Times New Roman", ""],
];

function panel(id, title, body, { sub = "" } = {}) {
  return `<section class="panel" id="panel-${id}" data-for="${id}" role="region" aria-labelledby="ph-${id}">
<header class="ph"><div><h2 id="ph-${id}">${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${btn({ ic: "close", label: `Close ${title}`, cls: "sm", attrs: "data-close" })}</header><div class="pb">${body}</div></section>`;
}

export function themePicker() {
  return `<div class="themes" role="radiogroup" aria-label="Theme">${THEMES.map(
    ([k, name, note]) =>
      `<button type="button" role="radio" class="theme-card" data-set-theme="${k}" aria-checked="${k === "document"}" title="${name}"><span class="tc-dots th-${k}"><i class="d1"></i><i class="d2"></i><i class="d3"></i><i class="d4"></i><i class="d5"></i></span><span class="tc-name">${name}</span>${note ? `<span class="tc-note">${note}</span>` : ""}</button>`,
  ).join("")}</div>`;
}
export function fontPicker({ compact = false } = {}) {
  if (compact)
    return `<label class="fsel"><span class="vh">Document font</span><select data-font-select aria-label="Document font">${FONTS.map(([k, n, d]) => `<option value="${k}">${n}${d ? " (default)" : ""}</option>`).join("")}</select></label>`;
  return `<div class="fonts" role="radiogroup" aria-label="Document font">${FONTS.map(
    ([k, n, d]) => `<button type="button" role="radio" class="font-row ff-${k}" data-set-font="${k}" aria-checked="${k === "arial"}"><span>${n}</span>${d ? '<em class="tag">default</em>' : ""}<span class="aa">Aa 1,234</span></button>`,
  ).join("")}</div>`;
}

export function settingsPanel(product) {
  const extra = {
    slides: `<h3>Footer</h3><label class="fld">Footer text (all slides)<input value="Community Learning · Year-one review"></label><p class="hint">Page numbers are added automatically.</p>`,
    data: `<h3>Regional settings</h3><p class="hint">Locale: English (United States) · formulas stay in English.</p><button type="button" class="b t ghost" data-panel="regional">${icon("globe")}<span class="lbl">Regional settings…</span></button>`,
    text: `<h3>Page</h3><div class="two"><label class="fld">Format<select><option>A4</option><option>Letter</option></select></label><label class="fld">Margins<select><option>Normal</option><option>Narrow</option><option>Wide</option></select></label></div><label class="fld">Running header<input value="Community Learning · Business review and 2027 plan"></label><label class="chk"><input type="checkbox" checked> Heading numbers (1, 1.1, 1.1.1)</label>`,
  }[product];
  const fontNote = product === "data" ? "Applies to the whole grid; one size for every cell." : "Body text only; titles keep the charte’s title font.";
  return panel(
    "settings",
    "Document settings",
    `<h3>Theme</h3>${themePicker()}<p class="hint">Built-in chartes are placeholders until TH01. The document charte is never overwritten; switching is undoable.</p>
<h3>Font</h3>${fontPicker()}<p class="hint">${fontNote}</p>${extra}`,
    { sub: "Saved in this file" },
  );
}

export function stylesPanel() {
  const cell = ([k, name, desc]) =>
    `<button type="button" class="style-tile${k === "calculation" ? " on" : ""}" aria-pressed="${k === "calculation"}"><span class="st-prev cs-${k}">${k === "hyperlink" ? "example.org" : k === "total" || k === "output" || k === "calculation" || k === "assumption" ? "€3,875" : name}</span><span class="st-name">${name}</span><span class="st-desc">${desc}</span></button>`;
  return panel(
    "styles",
    "Cell styles",
    `<div class="style-grid">${STYLES.map(cell).join("")}</div>
<p class="hint">Fixed catalogue of 11 styles in charte colours (ADR-012). No custom styles. Direct formatting stays available in the toolbar.</p>
<div class="prow">${btn({ ic: "eraser", label: "Clear formatting", text: "Clear formatting", cls: "ghost" })}${btn({ ic: "painter", label: "Copy style", text: "Copy style", cls: "ghost" })}</div>`,
    { sub: "Selection C4 · Calculation" },
  );
}

export function regionalPanel() {
  const rows = [
    ["Number", "1,234.50"],
    ["Currency", "€1,234"],
    ["Percent", "8.0%"],
    ["Short date", "10/22/2026"],
    ["Long date", "Thursday, October 22, 2026"],
  ];
  return panel(
    "regional",
    "Regional settings",
    `<label class="fld">Locale<select><option>English (United States) — en-US</option><option>English (United Kingdom) — en-GB</option><option>Français (France) — fr-FR</option><option>Deutsch (Deutschland) — de-DE</option><option>Español (España) — es-ES</option><option>Italiano (Italia) — it-IT</option></select></label>
<table class="kv"><caption>Preview</caption>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
<label class="fld dis">Time zone<select disabled><option>UTC</option></select></label>
<p class="hint">Time zone affects volatile date functions; it is not a document field until checked against the engine (R05 finding 5). Formulas keep English names and separators (ADR-003).</p>`,
    { sub: "Display only; values never change" },
  );
}

export function commentsPanel() {
  return panel(
    "comments",
    "Comments",
    `<div class="filter" role="group" aria-label="Show"><button type="button" class="chip" aria-pressed="true">Open · 2</button><button type="button" class="chip" aria-pressed="false">Resolved · 1</button><button type="button" class="chip" aria-pressed="false">Orphaned · 1</button></div>
<article class="thread on"><p class="q">“Community Learning reached 155 monthly participants…”</p><p class="c"><b>Alex</b> <time>15 Oct</time><br>Check against the audited figure.</p><p class="c"><b>Sam</b> <time>16 Oct</time><br>Audited total is ${fmt.eur(yearOne.revenue)} revenue; the count matches.</p><div class="prow"><button type="button" class="b t ghost"><span class="lbl">Reply</span></button><button type="button" class="b t ghost">${icon("check")}<span class="lbl">Resolve</span></button></div></article>
<article class="thread"><p class="q">“…venue capacity above 180 participants…”</p><p class="c"><b>Jo</b> <time>18 Oct</time><br>Add the second venue option here?</p></article>
<article class="thread orphan"><p class="q">Orphaned · anchor text deleted</p><p class="c">2 candidate locations found. <button type="button" class="linkish">Review candidates</button></p></article>
<p class="hint">Comments are data, never instructions. Excluded from print.</p>`,
    { sub: "Section 1 · Executive summary" },
  );
}

export function outlinePanel() {
  const items = [["1", "Executive summary", 1], ["2", "Outlook for 2027", 1], ["2.1", "Risks", 2], ["3", "Operations", 1], ["3.1", "Venues", 2], ["3.2", "Tutors", 2], ["A", "Appendix: assumptions", 1]];
  return panel("outline", "Outline", `<ol class="outline">${items.map(([n, t, l], i) => `<li class="l${l}${i === 0 ? " on" : ""}"><a href="#"><span class="hn">${n}</span>${t}</a></li>`).join("")}</ol><p class="hint">Section IDs are stable; the LLM tooling addresses sections by them.</p>`);
}

export function insertPanel(product) {
  const tiles = {
    slides: [["textbox", "Text box"], ["shape", "Shape"], ["block", "Box"], ["block", "Callout"], ["block", "Key figure"], ["image", "Image"], ["table", "Table"], ["chart", "Chart"], ["plus", "New slide"]],
    data: [["rowAdd", "Rows"], ["colAdd", "Columns"], ["sheet", "Sheet"], ["link", "Link"], ["dropdown", "Dropdown"], ["chart", "Chart", 1], ["pivot", "Pivot", 1], ["upload", "Import CSV / XLSX", 1]],
    text: [["table", "Table"], ["chart", "Chart"], ["image", "Image"], ["footnote", "Footnote"], ["xref", "Cross-reference"], ["toc", "Contents"], ["pagebreak", "Page break"], ["link", "Link"], ["comment", "Comment"]],
  }[product];
  return panel("insert", "Insert", `<div class="tiles">${tiles.map(([ic, l, planned]) => `<button type="button" class="tile${planned ? " planned" : ""}">${icon(ic)}<span>${l}</span>${planned ? '<em class="tag">planned</em>' : ""}</button>`).join("")}</div>`);
}

const LAYOUTS = ["Title only", "Impact title", "Left title", "Section divider", "Quote", "Panel 1/4", "Panel 1/3", "Panel 1/2", "Panel 2/3", "Three lines", "Cover", "End"];
export function slidePanel() {
  return panel(
    "slide",
    "Slide",
    `<h3>Layout</h3><div class="layouts">${LAYOUTS.map((l) => `<button type="button" class="lay${l === "Panel 1/3" ? " on" : ""}" aria-pressed="${l === "Panel 1/3"}"><i></i><span>${l}</span></button>`).join("")}</div>
<div class="prow">${btn({ ic: "reset", label: "Reset layout", text: "Reset layout", cls: "ghost" })}${btn({ ic: "footer", label: "Hide footer on this slide", text: "Hide footer", cls: "ghost" })}</div>
<div class="prow">${btn({ ic: "copy", label: "Duplicate slide", text: "Duplicate", cls: "ghost" })}${btn({ ic: "trash", label: "Delete slide", text: "Delete", cls: "ghost" })}</div>`,
    { sub: "Slide 2 of 5" },
  );
}

const KEYS = {
  slides: [["E · P · ?", "Edit · present · help"], ["Cmd+Z · Cmd+Shift+Z", "Undo · redo"], ["Cmd+B · Cmd+I", "Bold · italic"], ["Cmd+D · Delete", "Duplicate · delete"], ["Cmd+] · Cmd+[", "Forward · backward"], ["Arrows (Alt 1 px)", "Move by 8 px"], ["Cmd+S", "Save"]],
  data: [["Enter · Tab · arrows", "Edit and move"], ["Cmd+Z · Cmd+Shift+Z", "Undo · redo"], ["Cmd+B · Cmd+I", "Bold · italic"], ["Cmd+S", "Save"], ["F9", "Recalculate"], ["Alt+Down", "Open dropdown cell"]],
  text: [["Cmd+Z · Cmd+Shift+Z", "Undo · redo"], ["Cmd+B · Cmd+I · Cmd+U", "Bold · italic · underline"], ["Cmd+K", "Link"], ["Cmd+Alt+1…4", "Heading 1–4"], ["Cmd+Alt+M", "Comment"], ["Cmd+S", "Save"]],
};
export function helpPanel(product) {
  return panel(
    "help",
    "Help",
    `<table class="kv keys">${KEYS[product].map(([k, v]) => `<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`).join("")}</table>
<div class="prow"><button type="button" class="b t ghost"><span class="lbl">File format guide</span></button><button type="button" class="b t ghost"><span class="lbl">Third-party notices</span></button></div><p class="hint">Shortcuts other than the Slides ones are illustrative.</p>`,
  );
}
