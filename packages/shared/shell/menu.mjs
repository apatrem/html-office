// ARIA menu and menubar. Items: { label, shortcut, onSelect, disabled, checked, radio },
// { heading } or "-". A released shell never lists an inert command.
import { h, roving, icon } from "./dom.mjs";
import { openPopover, closePopover, openPopoverState } from "./popover.mjs";

function menuList(items, { label, onHorizontal } = {}) {
  const list = h("ul", { class: "sh-menu", role: "menu", "aria-label": label });
  for (const item of items) {
    if (item === "-") {
      list.append(h("li", { role: "separator", class: "sh-msep" }));
      continue;
    }
    if (item.heading) {
      list.append(
        h("li", { role: "presentation", class: "sh-mhead" }, item.heading),
      );
      continue;
    }
    const checkable = item.checked !== undefined;
    const li = h(
      "li",
      {
        role: checkable
          ? item.radio
            ? "menuitemradio"
            : "menuitemcheckbox"
          : "menuitem",
        tabindex: "-1",
        "aria-checked": checkable ? String(item.checked) : null,
        "aria-disabled": item.disabled ? "true" : null,
      },
      h(
        "span",
        { class: "sh-mcheck" },
        checkable && item.checked ? icon("check") : null,
      ),
      h("span", { class: "sh-mlabel" }, item.label),
      item.shortcut && h("kbd", {}, item.shortcut),
    );
    const activate = () => {
      if (item.disabled) return;
      closePopover();
      item.onSelect?.();
    };
    li.addEventListener("click", activate);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      } else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        onHorizontal
      ) {
        event.preventDefault();
        onHorizontal(event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "Tab") closePopover({ restore: false });
      else if (/^\w$/.test(event.key)) {
        // Type-ahead: next enabled item starting with the typed letter.
        const all = [
            ...list.querySelectorAll(
              '[role^="menuitem"]:not([aria-disabled="true"])',
            ),
          ],
          start = all.indexOf(li);
        const hit = [...all.slice(start + 1), ...all.slice(0, start)].find(
          (el) =>
            el.textContent
              .trim()
              .toLowerCase()
              .startsWith(event.key.toLowerCase()),
        );
        hit?.focus();
      }
    });
    list.append(li);
  }
  roving(list, '[role^="menuitem"]', { vertical: true });
  // Disabled items stay focusable for discoverability; the first enabled one gets focus.
  const first = list.querySelector('[role^="menuitem"]:not([aria-disabled])');
  for (const el of list.querySelectorAll('[role^="menuitem"]'))
    el.tabIndex = el === first ? 0 : -1;
  return list;
}

export function openMenu(trigger, items, options = {}) {
  const pop = openPopover(trigger, menuList(items, options), {
    role: "presentation",
    cls: "sh-menu-pop",
    ...options,
  });
  return pop;
}

// Menu button: a trigger that opens a menu with Enter, Space, ArrowDown or click.
export function menuButton(trigger, getItems, label) {
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  const open = () => openMenu(trigger, getItems(), { label });
  trigger.addEventListener("click", () => {
    if (openPopoverState()?.trigger === trigger) closePopover();
    else open();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open();
    }
  });
  return trigger;
}

// Menubar: Left/Right between menus, Down/Enter/Space opens, Left/Right inside a menu switches.
export function menubar(label, menus) {
  const bar = h("div", {
    class: "sh-menubar",
    role: "menubar",
    "aria-label": label,
  });
  const triggers = menus.map(({ name, items }) => {
    const t = h(
      "button",
      {
        type: "button",
        role: "menuitem",
        class: "sh-mb",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
      },
      name,
    );
    const open = () =>
      openMenu(t, typeof items === "function" ? items() : items, {
        label: name,
        onHorizontal: (dir) => {
          const i = triggers.indexOf(t),
            next = triggers[(i + dir + triggers.length) % triggers.length];
          next.click();
        },
      });
    t.addEventListener("click", () => {
      if (openPopoverState()?.trigger === t) closePopover();
      else open();
    });
    t.addEventListener("keydown", (event) => {
      if (
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        open();
      }
    });
    // Hovering another top-level menu while one is open switches to it.
    t.addEventListener("pointerenter", () => {
      const state = openPopoverState();
      if (state && triggers.includes(state.trigger) && state.trigger !== t)
        open();
    });
    bar.append(t);
    return t;
  });
  roving(bar, ".sh-mb");
  return bar;
}
