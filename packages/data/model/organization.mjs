const defaults = [
  ["summary", "Summary"],
  ["inputs", "Inputs / Hypotheses"],
  ["raw", "Raw Data"],
  ["calculations", "Calculations"],
];
const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z][\w-]{0,79}$/.test(value);
export function validateSheetName(name, sheets, exceptId) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 31 ||
    /[\\/*?:\[\]]/.test(name) ||
    name.startsWith("'") ||
    name.endsWith("'") ||
    sheets.some(
      (s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("Duplicate/invalid sheet name");
}
// Navigation order belongs to groups. Engine sheet order and stable IDs do not move.
export function groupView(book) {
  const groups = book.groups.map((g) => ({ ...g, sheetIds: [...g.sheetIds] }));
  const occupied = new Set(groups.map((g) => g.id)),
    used = new Set();
  for (const g of groups) {
    const inferred = defaults.find(
      ([, name]) => name.toLowerCase() === g.name.toLowerCase(),
    )?.[0];
    if (!g.kind && inferred) g.kind = inferred;
    if (g.kind) used.add(g.kind);
  }
  for (const [kind, name] of defaults)
    if (!used.has(kind)) {
      let id = `office-${kind}`,
        i = 0;
      while (occupied.has(id)) id = `office-${kind}-${++i}`;
      occupied.add(id);
      groups.push({ id, name, kind, sheetIds: [] });
    }
  const assigned = new Set(groups.flatMap((g) => g.sheetIds)),
    raw = groups.find((g) => g.kind === "raw");
  raw.sheetIds.push(
    ...book.sheets.filter((s) => !assigned.has(s.id)).map((s) => s.id),
  );
  return groups;
}
export function organizeWorkbook(book, command) {
  if (!command || typeof command !== "object")
    throw new Error("Invalid sheet/group command");
  const fields = {
    create: ["id", "name", "groupId"],
    rename: ["sheetId", "name"],
    moveSheet: ["sheetId", "groupId", "index"],
    collapse: ["groupId", "collapsed"],
    moveGroup: ["groupId", "index"],
  };
  const allowed = fields[command.type];
  if (
    !allowed ||
    Object.keys(command).some((k) => k !== "type" && !allowed.includes(k))
  )
    throw new Error("Invalid sheet/group command");
  const groups = groupView(book),
    next = { ...book, sheets: [...book.sheets], groups },
    group = groups.find((g) => g.id === command.groupId),
    sheet = book.sheets.find((s) => s.id === command.sheetId);
  if (command.type === "rename") {
    if (!sheet) throw new Error("Unknown sheet ID");
    validateSheetName(command.name, book.sheets, sheet.id);
    next.sheets = next.sheets.map((s) =>
      s.id === sheet.id ? { ...s, name: command.name } : s,
    );
    delete next.snapshot;
  } else if (command.type === "create") {
    if (!group) throw new Error("Unknown group ID");
    if (!validId(command.id) || book.sheets.some((s) => s.id === command.id))
      throw new Error("Duplicate/invalid sheet ID");
    validateSheetName(command.name, book.sheets);
    next.sheets.push({ id: command.id, name: command.name, cells: {} });
    group.sheetIds.push(command.id);
    delete next.snapshot;
  } else {
    if (!group) throw new Error("Unknown group ID");
    if (command.type === "collapse") {
      if (typeof command.collapsed !== "boolean")
        throw new Error("Invalid collapsed state");
      group.collapsed = command.collapsed;
    } else {
      const max =
        command.type === "moveGroup"
          ? groups.length - 1
          : group.sheetIds.length -
            (group.sheetIds.includes(command.sheetId) ? 1 : 0);
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index > max
      )
        throw new Error("Invalid navigation position");
      if (command.type === "moveGroup") {
        groups.splice(groups.indexOf(group), 1);
        groups.splice(command.index, 0, group);
      } else {
        if (!sheet) throw new Error("Unknown sheet ID");
        for (const g of groups)
          g.sheetIds = g.sheetIds.filter((id) => id !== sheet.id);
        group.sheetIds.splice(command.index, 0, sheet.id);
      }
    }
  }
  return next;
}
