// Anchored popover: one open at a time, closes on outside pointer, Escape,
// scroll of an ancestor or resize, and returns focus to its trigger.
import { h } from "./dom.mjs";

let current = null;
export const openPopoverState = () => current;

export function layer() {
  return document.getElementById("shell-layer") ?? document.body;
}

function place(pop, trigger) {
  const r = trigger.getBoundingClientRect(),
    w = pop.offsetWidth,
    ht = pop.offsetHeight;
  let top = r.bottom + 4;
  if (top + ht > innerHeight - 8 && r.top - ht - 4 > 8) top = r.top - ht - 4;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.maxHeight = `${innerHeight - Math.max(8, top) - 8}px`;
}

export function openPopover(
  trigger,
  content,
  { label, role = "dialog", onClose, focus = true, cls = "" } = {},
) {
  closePopover({ restore: false });
  const pop = h(
    "div",
    { class: `sh-pop ${cls}`, role, "aria-label": label },
    content,
  );
  layer().append(pop);
  place(pop, trigger);
  trigger.setAttribute("aria-expanded", "true");
  current = { pop, trigger, onClose };
  if (focus) {
    const first =
      pop.querySelector('[tabindex="0"]:not([disabled])') ??
      pop.querySelector("button:not([disabled]), input, select, [tabindex]");
    first?.focus({ preventScroll: true });
  }
  return pop;
}

export function closePopover({ restore = true } = {}) {
  if (!current) return;
  const { pop, trigger, onClose } = current;
  current = null;
  pop.remove();
  trigger.setAttribute("aria-expanded", "false");
  onClose?.();
  if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!current) return;
    if (
      current.pop.contains(event.target) ||
      current.trigger.contains(event.target)
    )
      return;
    closePopover({ restore: false });
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || !current) return;
    event.preventDefault();
    event.stopPropagation();
    closePopover();
  },
  true,
);
addEventListener("resize", () => closePopover({ restore: false }));
