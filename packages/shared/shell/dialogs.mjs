// Modal dialogs on the native <dialog> element: the browser traps focus and
// handles Escape; closing returns focus to the opener.
import { h, uid } from "./dom.mjs";
import { closePopover, layer } from "./popover.mjs";

export const dialogOpen = () => !!document.querySelector("dialog[open]");

export function field(label, control) {
  const id = control.id || (control.id = uid("f")),
    error = uid("err");
  control.setAttribute("aria-describedby", error);
  return h(
    "div",
    { class: "sh-fld" },
    h("label", { for: id }, label),
    control,
    h("p", { class: "sh-err", id: error, role: "status" }),
  );
}

export function modal(title, body, actions, { onClose, opener } = {}) {
  closePopover({ restore: false });
  const titleId = uid("dlg"),
    origin = opener ?? document.activeElement,
    dialog = h(
      "dialog",
      { class: "sh-dialog", "aria-labelledby": titleId },
      h(
        "form",
        { method: "dialog" },
        h("h2", { id: titleId }, title),
        body,
        h("div", { class: "sh-actions" }, actions),
      ),
    );
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.(dialog.returnValue);
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  });
  layer().append(dialog);
  dialog.showModal();
  return dialog;
}

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
  return SCHEMES.includes(url.protocol)
    ? ""
    : "Only https, http and mailto links are allowed.";
}
export const checkRef = (text) =>
  /^[A-Z]{1,3}[1-9]\d{0,6}(:[A-Z]{1,3}[1-9]\d{0,6})?$/.test(
    text.trim().toUpperCase(),
  )
    ? ""
    : "Enter a cell or range such as B4 or B4:C9.";

// Link dialog. initial: {url} or {sheetId, ref}; sheets: [{id, name}].
// onSave(link) receives {url} or {sheetId, ref}; onRemove() deletes it.
export function linkDialog({
  sheets,
  sheetId,
  initial,
  onSave,
  onRemove,
  opener,
}) {
  const place = !!initial?.sheetId,
    url = h("input", {
      type: "url",
      value: initial?.url ?? "",
      autocomplete: "off",
      spellcheck: "false",
    }),
    sheet = h(
      "select",
      {},
      sheets.map((s) =>
        h(
          "option",
          { value: s.id, selected: s.id === (initial?.sheetId ?? sheetId) },
          s.name,
        ),
      ),
    ),
    ref = h("input", {
      value: initial?.ref ?? "A1",
      autocomplete: "off",
      spellcheck: "false",
    }),
    save = h(
      "button",
      { type: "button", class: "sh-b sh-t sh-primary" },
      "Save link",
    ),
    kinds = h("fieldset", { class: "sh-radios" }, h("legend", {}, "Link to"));
  const urlBox = h("div", {}, field("Address", url)),
    placeBox = h(
      "div",
      { class: "sh-two" },
      field("Sheet", sheet),
      field("Cell", ref),
    );
  for (const [value, name] of [
    ["url", "Web or email address"],
    ["place", "Place in this workbook"],
  ])
    kinds.append(
      h(
        "label",
        { class: "sh-chk" },
        h("input", {
          type: "radio",
          name: "link-kind",
          value,
          checked: (value === "place") === place,
        }),
        name,
      ),
    );
  const kind = () => kinds.querySelector("input:checked").value;
  function validate() {
    const isUrl = kind() === "url",
      target = isUrl ? url : ref,
      error = isUrl ? checkUrl(url.value) : checkRef(ref.value),
      touched = target.value !== "" || !isUrl;
    urlBox.hidden = !isUrl;
    placeBox.hidden = isUrl;
    target.setAttribute("aria-invalid", String(!!error && touched));
    target.closest(".sh-fld").querySelector(".sh-err").textContent = touched
      ? error
      : "";
    (isUrl ? ref : url).removeAttribute("aria-invalid");
    save.disabled = !!error;
    return !error;
  }
  for (const el of [url, ref, sheet]) el.addEventListener("input", validate);
  kinds.addEventListener("change", validate);
  const dialog = modal(
    "Link",
    [kinds, urlBox, placeBox],
    [
      initial &&
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: () => {
              dialog.close("remove");
              onRemove();
            },
          },
          "Remove link",
        ),
      h("span", { class: "sh-spacer" }),
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-ghost",
          onclick: () => dialog.close("cancel"),
        },
        "Cancel",
      ),
      save,
    ],
    { opener },
  );
  save.addEventListener("click", () => {
    if (!validate()) return;
    const link =
      kind() === "url"
        ? { url: url.value.trim() }
        : { sheetId: sheet.value, ref: ref.value.trim().toUpperCase() };
    dialog.close("save");
    onSave(link);
  });
  validate();
  (place ? ref : url).focus();
  return dialog;
}
