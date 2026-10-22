// ARIA toolbar: one tab stop, arrow keys, horizontal scroll with overflow arrows.
import { h } from "./dom.mjs";
import { roving } from "./dom.mjs";

export function group(label, ...items) {
  return h(
    "div",
    { class: "sh-grp", role: "group", "aria-label": label },
    ...items,
  );
}
export const spacer = () => h("span", { class: "sh-spacer" });

export function toolbar(label, ...children) {
  const scroll = h("div", { class: "sh-tscroll" }, ...children);
  // Pointer-only helpers: keyboard users reach every item with the arrow keys.
  const arrow = (dir) =>
    h(
      "button",
      {
        type: "button",
        class: `sh-ovf ${dir < 0 ? "sh-ovl" : "sh-ovr"}`,
        tabindex: "-1",
        "aria-hidden": "true",
        onclick: () =>
          scroll.scrollBy({
            left: dir * scroll.clientWidth * 0.7,
            behavior: "smooth",
          }),
      },
      dir < 0 ? "‹" : "›",
    );
  const bar = h(
    "div",
    { class: "sh-tbar", role: "toolbar", "aria-label": label },
    arrow(-1),
    scroll,
    arrow(1),
  );
  const update = () => {
    const over = scroll.scrollWidth > scroll.clientWidth + 1;
    bar.classList.toggle("over", over);
    bar.classList.toggle("at-start", scroll.scrollLeft <= 1);
    bar.classList.toggle(
      "at-end",
      scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1,
    );
  };
  new ResizeObserver(update).observe(scroll);
  scroll.addEventListener("scroll", update, { passive: true });
  const nav = roving(bar, ".sh-tscroll button, .sh-tscroll select", {
    onMove: (el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }),
  });
  // Call after changing items' disabled state, passing the element that had
  // focus before (disabling it blurs it). A focused item that became disabled
  // hands focus to the toolbar's tab stop instead of losing it.
  bar.refresh = (focused = document.activeElement) => {
    nav.reset();
    if (bar.contains(focused) && focused.disabled)
      bar
        .querySelector('.sh-tscroll [tabindex="0"]:not(:disabled)')
        ?.focus({ preventScroll: true });
    update();
  };
  return bar;
}
