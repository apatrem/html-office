// Mock-up behaviour only: menus, panels, ribbon tabs, theme and font switching.
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const body = document.body,
    root = document.documentElement;

  function layout() {
    for (const tb of $$(".tbar")) {
      const s = tb.querySelector(".tscroll");
      tb.classList.toggle("over", s.scrollWidth > s.clientWidth + 2);
    }
  }
  function setPanel(id) {
    let any = false;
    for (const p of $$(".panel")) {
      const on = p.dataset.for === id;
      p.hidden = !on;
      any ||= on;
    }
    body.dataset.panel = any ? id : "none";
    for (const b of $$("[data-panel]"))
      if (!b.closest(".menu")) b.setAttribute("aria-pressed", String(any && b.dataset.panel === id));
    layout();
  }
  function selectTab(name, focus) {
    for (const t of $$("[role=tab]")) {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const p of $$("[role=tabpanel]")) p.hidden = p.id !== "rp-" + name;
    for (const s of $$("[data-tab-select]")) s.value = name;
    layout();
  }
  let open = null;
  function closeMenu() {
    if (!open) return;
    open.pop.hidden = true;
    open.btn.setAttribute("aria-expanded", "false");
    open = null;
  }
  function showMenu(btn) {
    const pop = document.getElementById(btn.dataset.menu);
    if (!pop) return;
    if (open && open.btn === btn) return closeMenu();
    closeMenu();
    pop.hidden = false;
    const r = btn.getBoundingClientRect(),
      w = pop.offsetWidth,
      h = pop.offsetHeight;
    let y = r.bottom + 4;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    pop.style.top = y + "px";
    btn.setAttribute("aria-expanded", "true");
    open = { btn, pop };
    pop.querySelector("button")?.focus({ preventScroll: true });
  }
  function sync() {
    for (const b of $$("[data-set-theme]")) b.setAttribute("aria-checked", String(b.dataset.setTheme === root.dataset.theme));
    for (const b of $$("[data-set-font]")) b.setAttribute("aria-checked", String(b.dataset.setFont === root.dataset.font));
    for (const s of $$("[data-font-select]")) s.value = root.dataset.font;
    const theme = document.querySelector(`[data-set-theme="${root.dataset.theme}"] .tc-name`)?.textContent,
      font = document.querySelector(`[data-font-select] option[value="${root.dataset.font}"]`)?.textContent.replace(" (default)", "");
    for (const l of $$("[data-theme-label]")) l.textContent = `Theme: ${theme} · ${font}`;
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const m = t.closest("[data-menu]");
    if (m) return showMenu(m);
    if (open && !t.closest(".pop")) closeMenu();
    const p = t.closest("[data-panel]");
    if (p) {
      const id = p.dataset.panel,
        fromMenu = !!p.closest(".menu");
      closeMenu();
      return setPanel(!fromMenu && body.dataset.panel === id ? "none" : id);
    }
    if (t.closest("[data-close]")) return setPanel("none");
    const th = t.closest("[data-set-theme]");
    if (th) (root.dataset.theme = th.dataset.setTheme), sync();
    const f = t.closest("[data-set-font]");
    if (f) (root.dataset.font = f.dataset.setFont), sync();
    const tab = t.closest("[role=tab]");
    if (tab) selectTab(tab.dataset.tab);
    if (t.closest(".menu [role=menuitem]")) closeMenu();
    const o = t.closest(".ovf");
    if (o) {
      const s = o.parentElement.querySelector(".tscroll");
      s.scrollBy({ left: (o.classList.contains("ovl") ? -0.7 : 0.7) * s.clientWidth, behavior: "smooth" });
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-font-select]")) (root.dataset.font = e.target.value), sync();
    if (e.target.matches("[data-tab-select]")) selectTab(e.target.value);
  });
  const step = (list, i, key) =>
    key === "Home" ? 0 : key === "End" ? list.length - 1 : (i + (key === "ArrowRight" || key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (open) {
        const b = open.btn;
        closeMenu();
        b.focus();
      } else if (body.dataset.panel !== "none") setPanel("none");
      return;
    }
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = $$("button", open.pop);
      items[step(items, items.indexOf(document.activeElement), e.key)].focus();
      return e.preventDefault();
    }
    const nav = ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key);
    const tab = e.target.closest("[role=tab]");
    if (tab && nav) {
      const tabs = $$("[role=tab]");
      selectTab(tabs[step(tabs, tabs.indexOf(tab), e.key)].dataset.tab, true);
      return e.preventDefault();
    }
    const tb = e.target.closest("[role=toolbar]");
    if (tb && nav && !e.target.matches("input, select")) {
      const items = $$("button:not(.ovf), select", tb).filter((b) => b.offsetParent);
      const n = items[step(items, items.indexOf(e.target), e.key)];
      for (const b of items) b.tabIndex = -1;
      n.tabIndex = 0;
      n.focus();
      n.scrollIntoView({ block: "nearest", inline: "nearest" });
      e.preventDefault();
    }
  });
  for (const tb of $$("[role=toolbar]")) $$("button:not(.ovf), select", tb).forEach((b, i) => (b.tabIndex = i ? -1 : 0));
  addEventListener("resize", layout);

  // Initial state: #styles, #regional, #settings, #comments, #outline, #insert, #help or #none.
  const state = location.hash.slice(1) || body.dataset.default || "none";
  if (body.dataset.tab) selectTab(body.dataset.tab);
  if (state === "settings" && body.dataset.variant === "b") {
    selectTab("document");
    setPanel("none");
  } else setPanel(state);
  sync();
  window.mock = { setPanel, selectTab };
})();
