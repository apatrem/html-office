// Modal dialogs on the native <dialog> element (focus trap and Escape come
// from the browser). Link dialog: http, https and mailto, or a workbook place.
import { h, uid } from "./dom.mjs";

const SCHEMES = ["http:", "https:", "mailto:"];
export function checkUrl(text) {
  const value = text.trim();
  if (!value) return "Enter a web or email address.";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full address, for example https://example.org.";
  }
  if (!SCHEMES.includes(url.protocol)) return "Only https, http and mailto links are allowed.";
  return "";
}
export const checkRef = (text) =>
  /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/.test(text.trim().toUpperCase()) ? "" : "Enter a cell such as B4.";

function field(label, control, error) {
  const id = control.id || (control.id = uid("f"));
  const errId = uid("err");
  control.setAttribute("aria-describedby", errId);
  return h("div", { class: "sh-fld" }, h("label", { for: id }, label), control, h("p", { class: "sh-err", id: errId, role: "status" }, error ?? ""));
}

function modal(title, body, actions, { onClose } = {}) {
  const titleId = uid("dlg");
  const dialog = h("dialog", { class: "sh-dialog", "aria-labelledby": titleId }, h("form", { method: "dialog" }, h("h2", { id: titleId }, title), body, h("div", { class: "sh-actions" }, actions)));
  const opener = document.activeElement;
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.(dialog.returnValue);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  (document.getElementById("shell-layer") ?? document.body).append(dialog);
  dialog.showModal();
  return dialog;
}

// initial: { url } or { sheet, ref }, plus label. onSave(link, label); onRemove().
export function linkDialog({ sheets, currentSheet, initial, label, onSave, onRemove }) {
  const kind = initial?.sheet ? "place" : "url";
  const url = h("input", { type: "url", value: initial?.url ?? "", autocomplete: "off", spellcheck: "false" });
  const sheet = h("select", {}, sheets.map((s) => h("option", { value: s, selected: s === (initial?.sheet ?? currentSheet) }, s)));
  const ref = h("input", { value: initial?.ref ?? "A1", autocomplete: "off", spellcheck: "false" });
  const text = h("input", { value: label ?? "" });
  const save = h("button", { type: "button", class: "sh-b sh-t sh-primary" }, "Save link");
  const radios = h("fieldset", { class: "sh-radios" }, h("legend", {}, "Link to"));
  const urlBox = h("div", {}, field("Address", url));
  const placeBox = h("div", { class: "sh-two" }, field("Sheet", sheet), field("Cell", ref));
  for (const [value, name] of [["url", "Web or email address"], ["place", "Place in this workbook"]]) {
    const input = h("input", { type: "radio", name: "link-kind", value, checked: value === kind });
    radios.append(h("label", { class: "sh-chk" }, input, name));
  }
  const currentKind = () => radios.querySelector("input:checked").value;
  function validate() {
    const isUrl = currentKind() === "url";
    urlBox.hidden = !isUrl;
    placeBox.hidden = isUrl;
    const error = isUrl ? checkUrl(url.value) : checkRef(ref.value);
    const target = isUrl ? url : ref;
    const touched = target.value !== "" || target === ref;
    target.setAttribute("aria-invalid", String(!!error && touched));
    target.closest(".sh-fld").querySelector(".sh-err").textContent = touched ? error : "";
    (isUrl ? ref : url).removeAttribute("aria-invalid");
    save.disabled = !!error;
    return !error;
  }
  for (const el of [url, ref, sheet]) el.addEventListener("input", validate);
  radios.addEventListener("change", validate);
  const actions = [
    initial && h("button", { type: "button", class: "sh-b sh-t sh-ghost", onclick: () => (onRemove?.(), dialog.close("remove")) }, "Remove link"),
    h("span", { class: "sh-spacer" }),
    h("button", { type: "submit", class: "sh-b sh-t sh-ghost", value: "cancel" }, "Cancel"),
    save,
  ];
  const dialog = modal("Link", [radios, urlBox, placeBox, field("Text to display", text)], actions);
  save.addEventListener("click", () => {
    if (!validate()) return;
    const link = currentKind() === "url" ? { url: url.value.trim() } : { sheet: sheet.value, ref: ref.value.trim().toUpperCase() };
    onSave(link, text.value);
    dialog.close("save");
  });
  validate();
  (kind === "url" ? url : ref).focus();
  return dialog;
}
