import { groupView } from "../model/organization.mjs";
// Variant A sheet bar: one row of group labels and sheet tabs (a sheet select
// when narrow). Group order and sheet moves live in Manage sheets.
export function setupSheetNavigation(
  root,
  { getBook, getSheetId, busy, select, apply, status },
) {
  const $ = (id) => document.getElementById(id),
    picker = $("sheet-select");
  function button(key, action, ...content) {
    const b = document.createElement("button");
    b.type = "button";
    b.append(...content);
    b.dataset.navigationKey = key;
    b.disabled = busy();
    b.onclick = action;
    return b;
  }
  function hidden(text) {
    const span = document.createElement("span");
    span.className = "vh";
    span.textContent = text;
    return span;
  }
  function draw() {
    const active = document.activeElement?.dataset.navigationKey,
      book = getBook(),
      selected = getSheetId(),
      groups = groupView(book);
    root.replaceChildren();
    picker.replaceChildren();
    for (const group of groups) {
      const section = document.createElement("div");
      section.className = `sheet-group ${group.kind ?? ""}`;
      section.dataset.group = group.id;
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", `${group.name} sheet group`);
      // The visible group name stays inside the accessible name.
      const label = button(
        `collapse-${group.id}`,
        () =>
          void apply({
            type: "collapse",
            groupId: group.id,
            collapsed: !group.collapsed,
          }),
        group.name,
        hidden(" group"),
      );
      // Generated content would join the accessible name; this mark does not.
      if (group.collapsed) {
        const caret = document.createElement("span");
        caret.className = "group-caret";
        caret.setAttribute("aria-hidden", "true");
        caret.textContent = "▸";
        label.append(caret);
      }
      label.className = "group-label";
      label.title = `${group.collapsed ? "Show" : "Hide"} the ${group.name} sheets`;
      label.setAttribute("aria-expanded", String(!group.collapsed));
      if (group.sheetIds.includes(selected)) label.dataset.current = "true";
      section.append(label);
      const options = document.createElement("optgroup");
      options.label = group.name;
      for (const id of group.sheetIds) {
        const sheet = book.sheets.find((s) => s.id === id);
        options.append(new Option(sheet.name, id, false, id === selected));
        if (group.collapsed) continue;
        const tab = button(`sheet-${id}`, () => select(id), sheet.name);
        tab.className = "sheet-tab";
        tab.setAttribute("aria-pressed", String(id === selected));
        section.append(tab);
      }
      if (!group.sheetIds.length) {
        const empty = document.createElement("span");
        empty.className = "group-empty";
        empty.textContent = "No sheets";
        section.append(empty);
      }
      picker.append(options);
      root.append(section);
    }
    picker.value = selected;
    picker.disabled = busy();
    for (const b of $("sheet-dialog").querySelectorAll("button,input,select"))
      b.disabled = busy();
    syncDialog();
    if (active)
      [...root.querySelectorAll("button")]
        .find((b) => b.dataset.navigationKey === active)
        ?.focus({ preventScroll: true });
    root
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  // Order buttons follow the selected sheet and the destination group.
  function syncDialog() {
    if (busy()) return;
    const groups = groupView(getBook()),
      group = groups.find((g) => g.sheetIds.includes(getSheetId())),
      index = group.sheetIds.indexOf(getSheetId()),
      target = groups.findIndex((g) => g.id === $("sheet-group").value);
    $("sheet-earlier").disabled = index === 0;
    $("sheet-later").disabled = index === group.sheetIds.length - 1;
    $("group-earlier").disabled = target <= 0;
    $("group-later").disabled = target < 0 || target === groups.length - 1;
  }
  picker.onchange = () => {
    if (!busy() && picker.value) select(picker.value);
  };
  function populate(destination) {
    const book = getBook(),
      groups = groupView(book),
      selected = getSheetId();
    $("sheet-name").value = book.sheets.find((s) => s.id === selected).name;
    $("sheet-group").replaceChildren(
      ...groups.map((g) => new Option(g.name, g.id)),
    );
    $("sheet-group").value =
      destination ?? groups.find((g) => g.sheetIds.includes(selected)).id;
    $("sheet-context").textContent =
      `Selected: ${book.sheets.find((s) => s.id === selected).name}. Creation and renaming recalculate references; moving sheets and groups stays local.`;
    draw();
  }
  function open() {
    populate();
    $("sheet-dialog").showModal();
    $("sheet-name").focus();
    $("sheet-name").select();
  }
  $("sheet-group").onchange = syncDialog;
  $("sheet-close").onclick = () => $("sheet-dialog").close();
  async function run(command) {
    const calculates = ["create", "rename"].includes(command.type),
      destination = $("sheet-group").value;
    if (calculates) $("sheet-dialog").close();
    const ok = await apply(command);
    if (ok && command.type === "moveGroup") {
      // Group order is often changed several times in a row.
      populate(destination);
      const focused = document.activeElement;
      if (!$("sheet-dialog").contains(focused) || focused.disabled)
        $("sheet-group").focus();
    } else if (ok) {
      populate();
      $("sheet-dialog").close();
      $("grid").focus();
    } else {
      $("sheet-context").textContent = $("status").textContent;
      if (calculates && !$("sheet-dialog").open) $("sheet-dialog").showModal();
    }
  }
  $("sheet-create").onclick = () =>
    void run({
      type: "create",
      id: `sheet_${crypto.randomUUID()}`,
      name: $("sheet-name").value,
      groupId: $("sheet-group").value,
    });
  $("sheet-rename").onclick = () =>
    void run({
      type: "rename",
      sheetId: getSheetId(),
      name: $("sheet-name").value,
    });
  $("sheet-move").onclick = () =>
    void run({
      type: "moveSheet",
      sheetId: getSheetId(),
      groupId: $("sheet-group").value,
      index: 0,
    });
  for (const [id, delta] of [
    ["sheet-earlier", -1],
    ["sheet-later", 1],
  ])
    $(id).onclick = () => {
      const group = groupView(getBook()).find((g) =>
        g.sheetIds.includes(getSheetId()),
      );
      void run({
        type: "moveSheet",
        sheetId: getSheetId(),
        groupId: group.id,
        index: group.sheetIds.indexOf(getSheetId()) + delta,
      });
    };
  for (const [id, delta] of [
    ["group-earlier", -1],
    ["group-later", 1],
  ])
    $(id).onclick = () => {
      const groups = groupView(getBook()),
        index = groups.findIndex((g) => g.id === $("sheet-group").value);
      void run({
        type: "moveGroup",
        groupId: groups[index].id,
        index: index + delta,
      });
    };
  $("sheet-dialog").addEventListener("cancel", (event) => {
    if (busy()) {
      event.preventDefault();
      status("Wait for the sheet operation or cancel its calculation.");
    }
  });
  return { draw, open };
}
