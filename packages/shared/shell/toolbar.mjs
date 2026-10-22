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
  // Overflow arrows sit at both ends of the roving order, so the keyboard
  // reaches them too; arrow keys also scroll each item into view.
  const arrow = (dir) =>
    h(
      "button",
      {
        type: "button",
        class: `sh-ovf ${dir < 0 ? "sh-ovl" : "sh-ovr"}`,
        tabindex: "-1",
        "aria-label": `Scroll toolbar ${dir < 0 ? "left" : "right"}`,
        title: `Scroll toolbar ${dir < 0 ? "left" : "right"}`,
        onclick: () =>
          scroll.scrollBy({
            left: dir * scroll.clientWidth * 0.7,
            behavior: "smooth",
          }),
      },
      h("span", { "aria-hidden": "true" }, dir < 0 ? "‹" : "›"),
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
    // An arrow hidden at its end hands focus to the nearest command.
    const active = document.activeElement;
    if (
      active?.matches?.(".sh-ovf") &&
      bar.contains(active) &&
      getComputedStyle(active).visibility === "hidden"
    ) {
      const commands = nav.items().filter(nav.command);
      (active.matches(".sh-ovl") ? commands[0] : commands.at(-1))?.focus({
        preventScroll: true,
      });
    }
  };
  new ResizeObserver(update).observe(scroll);
  scroll.addEventListener("scroll", update, { passive: true });
  const nav = roving(bar, ".sh-ovf, .sh-tscroll button, .sh-tscroll select", {
    edges: ".sh-ovf",
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
