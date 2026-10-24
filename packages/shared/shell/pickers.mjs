// Colour swatches and border picker, limited to the closed vocabulary of ADR-012.
import { h, icon, roving } from "./dom.mjs";
import { openPopover, closePopover } from "./popover.mjs";

export const TEXT_COLOURS = [
  ["ink", "Ink (default)"],
  ["acc", "Accent"],
  ["mid", "Mid"],
  ["alert", "Alert"],
  ["t2", "Secondary grey"],
  ["bg", "White"],
];
export const FILLS = [
  ["none", "No fill"],
  ["tint", "Tint"],
  ["lig", "Light"],
  ["mid", "Mid"],
  ["acc", "Accent"],
  ["alert", "Alert"],
  ["dark", "Dark"],
];
export const BORDER_STYLES = [
  ["thin", "Thin"],
  ["medium", "Medium"],
  ["double", "Double"],
];
const PRESETS = [
  ["all", "All borders", "bAll"],
  ["outer", "Outer borders", "bOuter"],
  ["inner", "Inner borders", "bInner"],
  ["top", "Top border", "bTop"],
  ["bottom", "Bottom border", "bBottom"],
  ["left", "Left border", "bLeft"],
  ["right", "Right border", "bRight"],
  ["none", "No borders", "bNone"],
];

// Toolbar button that opens a colour picker; its bar shows the current colour
// (set `button.bar.style.background`).
export function colourButton(kind, onClick) {
  const fill = kind === "fill",
    label = fill ? "Fill colour" : "Text colour",
    bar = h("span", { class: "sh-swbar" }),
    b = h(
      "button",
      {
        type: "button",
        class: "sh-b sh-colour",
        "aria-label": label,
        title: label,
        "aria-haspopup": "dialog",
        "aria-expanded": "false",
        onclick: onClick,
      },
      fill ? icon("fill") : h("span", { class: "sh-g" }, h("b", {}, "A")),
      bar,
    );
  b.bar = bar;
  return b;
}

// Radio group of swatches: arrows move, Enter/Space/click picks.
export function swatchGroup(label, tokens, current, onPick) {
  const group = h("div", {
    class: "sh-swrow",
    role: "radiogroup",
    "aria-label": label,
  });
  for (const [token, name] of tokens) {
    const b = h("button", {
      type: "button",
      role: "radio",
      class: `sh-sw sh-sw-${token}`,
      "aria-checked": String(token === current),
      "aria-label": name,
      title: name,
      onclick: () => {
        for (const other of group.children)
          other.setAttribute("aria-checked", String(other === b));
        onPick(token);
      },
    });
    group.append(b);
  }
  roving(group, ".sh-sw");
  const checked = group.querySelector('[aria-checked="true"]');
  if (checked)
    for (const el of group.children) el.tabIndex = el === checked ? 0 : -1;
  return group;
}

export function openSwatches(trigger, kind, current, onPick) {
  const tokens = kind === "fill" ? FILLS : TEXT_COLOURS;
  const title = kind === "fill" ? "Fill colour" : "Text colour";
  openPopover(
    trigger,
    [
      h("p", { class: "sh-pop-h" }, `${title} · charte tokens`),
      swatchGroup(title, tokens, current, (token) => {
        closePopover();
        onPick(token);
      }),
      kind === "fill" &&
        h("p", { class: "sh-pop-n" }, "Dark fills switch text to white."),
    ],
    { label: title, cls: "sh-pop-sw" },
  );
}

// Border picker: preset buttons apply the chosen style and colour to the selection.
export function openBorders(trigger, state, onPick) {
  const presets = h("div", {
    class: "sh-bpresets",
    role: "group",
    "aria-label": "Apply borders",
  });
  for (const [preset, name, ic] of PRESETS)
    presets.append(
      h(
        "button",
        {
          type: "button",
          class: "sh-b",
          "aria-label": name,
          title: name,
          onclick: () => {
            closePopover();
            onPick({ preset, style: state.style, color: state.color });
          },
        },
        icon(ic),
      ),
    );
  roving(presets, "button");
  const styles = h("div", {
    class: "sh-seg",
    role: "radiogroup",
    "aria-label": "Line style",
  });
  for (const [style, name] of BORDER_STYLES) {
    const b = h(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(style === state.style),
        onclick: () => {
          state.style = style;
          for (const o of styles.children)
            o.setAttribute("aria-checked", String(o === b));
        },
      },
      h("span", { class: `sh-line sh-line-${style}`, "aria-hidden": "true" }),
      name,
    );
    styles.append(b);
  }
  roving(styles, "button");
  openPopover(
    trigger,
    [
      h("p", { class: "sh-pop-h" }, "Borders"),
      presets,
      h("p", { class: "sh-pop-h" }, "Line"),
      styles,
      h("p", { class: "sh-pop-h" }, "Colour"),
      swatchGroup(
        "Border colour",
        TEXT_COLOURS,
        state.color,
        (token) => (state.color = token),
      ),
    ],
    { label: "Borders", cls: "sh-pop-borders" },
  );
}
