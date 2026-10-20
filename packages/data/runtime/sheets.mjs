import { groupView } from "../model/organization.mjs";
export function setupSheetNavigation(
  root,
  { getBook, getSheetId, busy, select, apply, status },
) {
  const $ = (id) => document.getElementById(id);
  function button(text, label, key, action, disabled = false) {
    const b = document.createElement("button");
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.dataset.navigationKey = key;
    b.disabled = busy() || disabled;
    b.onclick = action;
    return b;
  }
  function draw() {
    const active = document.activeElement?.dataset.navigationKey,
      book = getBook(),
      selected = getSheetId(),
      groups = groupView(book);
    root.replaceChildren();
    groups.forEach((group, i) => {
      const section = document.createElement("section");
      section.className = `sheet-group ${group.kind ?? ""}`;
      section.dataset.group = group.id;
      section.setAttribute("aria-label", `${group.name} sheet group`);
      const heading = document.createElement("div");
      heading.className = "group-heading";
      const collapse = button(
        `${group.name} (${group.sheetIds.length})`,
        `${group.collapsed ? "Expand" : "Collapse"} ${group.name}`,
        `collapse-${group.id}`,
        () =>
          void apply({
            type: "collapse",
            groupId: group.id,
            collapsed: !group.collapsed,
          }),
      );
      collapse.setAttribute("aria-expanded", String(!group.collapsed));
      if (group.sheetIds.includes(selected)) collapse.dataset.current = "true";
      heading.append(
        collapse,
        button(
          "↑",
          `Move ${group.name} group earlier`,
          `earlier-${group.id}`,
          () =>
            void apply({ type: "moveGroup", groupId: group.id, index: i - 1 }),
          i === 0,
        ),
        button(
          "↓",
          `Move ${group.name} group later`,
          `later-${group.id}`,
          () =>
            void apply({ type: "moveGroup", groupId: group.id, index: i + 1 }),
          i === groups.length - 1,
        ),
      );
      section.append(heading);
      const tabs = document.createElement("div");
      tabs.className = "group-tabs";
      tabs.hidden = !!group.collapsed;
      for (const id of group.sheetIds) {
        const sheet = book.sheets.find((s) => s.id === id),
          b = button(sheet.name, sheet.name, `sheet-${id}`, () => select(id));
        b.setAttribute("aria-pressed", String(id === selected));
        tabs.append(b);
      }
      if (!group.sheetIds.length) {
        const empty = document.createElement("span");
        empty.textContent = "No sheets";
        tabs.append(empty);
      }
      section.append(tabs);
      root.append(section);
    });
    $("current-sheet").textContent =
      `Sheet: ${book.sheets.find((s) => s.id === selected).name}`;
    for (const b of $("sheet-dialog").querySelectorAll("button,input,select"))
      b.disabled = busy();
    const group = groups.find((g) => g.sheetIds.includes(selected)),
      index = group.sheetIds.indexOf(selected);
    $("sheet-earlier").disabled = busy() || index === 0;
    $("sheet-later").disabled = busy() || index === group.sheetIds.length - 1;
    if (active)
      [...root.querySelectorAll("button")]
        .find((b) => b.dataset.navigationKey === active)
        ?.focus({ preventScroll: true });
  }
  function populate() {
    const book = getBook(),
      groups = groupView(book),
      selected = getSheetId();
    $("sheet-name").value = book.sheets.find((s) => s.id === selected).name;
    $("sheet-group").replaceChildren(
      ...groups.map((g) => {
        const option = document.createElement("option");
        option.value = g.id;
        option.textContent = g.name;
        return option;
      }),
    );
    $("sheet-group").value = groups.find((g) =>
      g.sheetIds.includes(selected),
    ).id;
    $("sheet-context").textContent =
      `Selected: ${book.sheets.find((s) => s.id === selected).name}. Creation and renaming recalculate references; moving groups stays local.`;
    draw();
  }
  $("manage-sheets").onclick = () => {
    populate();
    $("sheet-dialog").showModal();
    $("sheet-name").focus();
    $("sheet-name").select();
  };
  $("sheet-close").onclick = () => $("sheet-dialog").close();
  async function run(command) {
    const calculates = ["create", "rename"].includes(command.type);
    if (calculates) $("sheet-dialog").close();
    const ok = await apply(command);
    if (ok) {
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
  $("sheet-dialog").addEventListener("cancel", (event) => {
    if (busy()) {
      event.preventDefault();
      status("Wait for the sheet operation or cancel its calculation.");
    }
  });
  return { draw };
}
