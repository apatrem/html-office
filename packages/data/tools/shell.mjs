// Static parts of the variant A editor shell (ADR-011 §7). Menus, toolbar and
// sheet actions are mounted by runtime/shell.mjs into [data-shell-mount]
// elements, which saved copies leave empty.
import { escapeHTML as esc } from "../runtime/view.mjs";
import { ICONS } from "../../shared/shell/icons.mjs";

const svg = (name) =>
  `<svg class="sh-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
const options = (values) =>
  values
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");

export function fileBarHTML(title) {
  return `<div class="sh-root app-bar" id="shell-root"><div class="sh-row">
<div class="sh-ident"><span class="sh-mark" aria-hidden="true">D</span><div class="sh-tt"><h1 class="sh-title" title="${esc(title)}">${esc(title)}</h1><div class="sh-state"><p id="save-status" role="status">Saved file opened.</p><p id="status" role="status">Checking saved results…</p></div></div></div>
<div id="shell-menus" class="sh-wide" data-shell-mount></div><span class="sh-spacer"></span>
<button id="direct-save" type="button" class="sh-b sh-t sh-primary" title="Save">${svg("save")}<span class="sh-lbl">Save</span></button><span id="shell-narrow" class="sh-only-narrow" data-shell-mount></span></div>
<div id="shell-toolbar" class="sh-row sh-row2" data-shell-mount></div></div>`;
}

// One row: name box, input type, fx, value, apply, dropdown and scenario menus, calculation state.
export const formulaBarHTML = `<div class="sh-root formula-bar" role="group" aria-label="Formula bar">
<input id="cell-address" class="name-box" aria-label="Cell address" value="B2" spellcheck="false" autocomplete="off">
<select id="cell-type" aria-label="Input type" title="Input type">${options(["number", "text", "boolean", "blank", "date", "error", "formula"].map((t) => [t, t]))}</select>
<span class="fx" aria-hidden="true">fx</span>
<input id="cell-value" aria-label="Cell value" value="100" spellcheck="false" autocomplete="off">
<button id="apply" type="button" class="sh-b" aria-label="Apply edit" title="Apply edit (Enter)">${svg("check")}</button>
<div class="dropdown-control" hidden><label for="dropdown-value">Dropdown value</label><select id="dropdown-value" aria-describedby="dropdown-note"></select><small id="dropdown-note" role="status"></small></div>
<div class="dropdown-control" hidden><label for="scenario-select">Scenario</label><select id="scenario-select" aria-describedby="scenario-note"></select><small id="scenario-note" role="status"></small></div>
<div class="calc"><span id="calc-state" data-tone="busy">Checking…</span><button id="cancel" type="button" class="sh-b sh-t" hidden disabled>Cancel calculation</button><button id="retry-range" type="button" class="sh-b sh-t" hidden>Retry pending range</button></div>
</div>`;

export const sheetBarHTML = `<div class="sh-root sheet-bar"><span id="sheet-actions" class="sheet-actions-bar" data-shell-mount></span><nav id="sheet-tabs" aria-label="Sheets"></nav><select id="sheet-select" aria-label="Sheet"></select></div>`;

export const numberDialogHTML = `<dialog id="number-dialog" aria-labelledby="number-title"><h2 id="number-title">More number formats</h2><p id="number-context"></p>
<div class="dialog-fields"><label>Number format<select id="format-kind" aria-label="Number format">${options(
  [
    ["general", "General"],
    ["number", "Number"],
    ["currency", "Currency"],
    ["accounting", "Accounting"],
    ["date", "Date"],
    ["percent", "Percent"],
  ],
)}</select></label><label>Decimal places<input id="format-digits" type="number" min="0" max="15" value="2"></label><label>Currency code<input id="format-currency" value="EUR" maxlength="3"></label></div>
<div class="sheet-actions"><button id="format-apply" type="button">Apply number format</button><button id="format-cancel" type="button">Cancel</button></div></dialog>`;

export function helpDialogHTML(guide, notices) {
  return `<dialog id="help-dialog" aria-labelledby="help-title"><h2 id="help-title">Help</h2>
<details data-section="keys"><summary>Keyboard shortcuts</summary><ul class="keys"><li>Arrow keys move; Shift+arrows select a rectangle.</li><li>F2 or typing edits the cell in the formula bar; Enter applies; Escape restores the form.</li><li>Ctrl/Cmd+C and V copy and paste ranges; Ctrl/Cmd+Z and Shift+Z undo and redo; Ctrl/Cmd+S saves.</li><li>Menus: Left and Right move between menus, Down opens one, Escape closes it. The toolbar is one tab stop; use the arrow keys, Home and End inside it.</li></ul></details>
<details data-section="guide"><summary>Embedded format guide</summary><pre data-document-content>${esc(guide)}</pre></details>
<details data-section="notices"><summary>Third-party notices</summary><pre>${esc(notices)}</pre></details>
<form method="dialog" class="sheet-actions"><button>Close help</button></form></dialog>`;
}
