// Non-modal side drawer (bottom sheet at narrow widths). One panel at a time;
// focus moves to its heading on open and back to the trigger on close.
import { h, button, uid } from "./dom.mjs";

export function drawer(host) {
  host.classList.add("sh-drawer");
  host.hidden = true;
  let state = null;
  const toggles = new Map();

  function close({ restore = true } = {}) {
    if (!state) return;
    const { trigger, id } = state;
    state = null;
    host.hidden = true;
    host.replaceChildren();
    document.body.classList.remove("sh-drawer-open");
    for (const [key, list] of toggles)
      for (const b of list) b.setAttribute("aria-pressed", "false");
    host.dispatchEvent(
      new CustomEvent("drawer", { detail: { open: null, closed: id } }),
    );
    if (restore && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function open(id, { title, subtitle, body, trigger }) {
    if (state?.id === id) return close();
    // Switching from inside a panel keeps the first, external trigger for focus return.
    const outside = trigger && !host.contains(trigger) ? trigger : null;
    const origin = outside ?? state?.trigger ?? document.activeElement;
    if (state) close({ restore: false });
    const headingId = uid("drawer-h");
    const heading = h("h2", { id: headingId, tabindex: "-1" }, title);
    host.replaceChildren(
      h(
        "section",
        { class: "sh-panel", role: "region", "aria-labelledby": headingId },
        h(
          "div",
          { class: "sh-ph" },
          h("div", {}, heading, subtitle && h("p", {}, subtitle)),
          button({
            label: `Close ${title}`,
            ic: "close",
            cls: "sh-sm",
            onClick: () => close(),
          }),
        ),
        h(
          "div",
          { class: "sh-pb" },
          typeof body === "function" ? body() : body,
        ),
      ),
    );
    host.hidden = false;
    document.body.classList.add("sh-drawer-open");
    state = { id, trigger: origin };
    for (const [key, list] of toggles)
      for (const b of list) b.setAttribute("aria-pressed", String(key === id));
    heading.focus({ preventScroll: true });
    host.dispatchEvent(new CustomEvent("drawer", { detail: { open: id } }));
  }

  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state) {
      event.preventDefault();
      close();
    }
  });

  // A toggle button opens a panel and shows its pressed state.
  function toggle(btn, id, spec) {
    btn.setAttribute("aria-pressed", "false");
    if (!toggles.has(id)) toggles.set(id, []);
    toggles.get(id).push(btn);
    btn.addEventListener("click", () => open(id, { ...spec(), trigger: btn }));
    return btn;
  }

  return { open, close, toggle, current: () => state?.id ?? null, host };
}
