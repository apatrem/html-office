// Browser-test helper: runs a workbook command from its menu, as a person does
// with the variant A shell (U04-Data). Toolbar buttons are clicked directly.
const MENUS = {
  "Save a copy": ["File", "Save a copy"],
  Recalculate: ["Data", "Recalculate"],
  "Import CSV": ["Data", "Import CSV…"],
  "Refresh source": ["Data", "Refresh source…"],
  "Dropdown settings": ["Data", "Dropdown settings…"],
  "Manage sheets": ["Data", "Manage sheets…"],
  "Paste table": ["Edit", "Paste table…"],
  "Fill down": ["Edit", "Fill down"],
  "Fill right": ["Edit", "Fill right"],
  "Delete rows": ["Edit", "Delete rows"],
  "Delete columns": ["Edit", "Delete columns"],
  "Insert rows": ["Insert", "Insert rows"],
  "Insert columns": ["Insert", "Insert columns"],
  "Number format": ["Format", "Number format…"],
};

export function openMenu(page, menu) {
  return page
    .getByRole("menubar", { name: "Workbook menu" })
    .getByRole("menuitem", { name: menu, exact: true })
    .click();
}

export function menuItem(page, menu, item) {
  const list = page.getByRole("menu", { name: menu, exact: true });
  return list
    .getByRole("menuitem", { name: item, exact: true })
    .or(list.getByRole("menuitemradio", { name: item, exact: true }))
    .or(list.getByRole("menuitemcheckbox", { name: item, exact: true }));
}

export async function command(page, name) {
  const [menu, item] = MENUS[name];
  await openMenu(page, menu);
  await menuItem(page, menu, item).click();
}

// Applies a cell style from the toolbar's cell-style menu button.
export async function cellStyle(page, label) {
  await page.getByRole("button", { name: /^Cell style: / }).click();
  await menuItem(page, "Cell style", label).click();
}

// The selected sheet, as the sheet select shows it (also when its group is collapsed).
export function currentSheet(page) {
  return page
    .locator("#sheet-select")
    .evaluate((select) => select.selectedOptions[0].textContent);
}

// Moves a sheet group with Manage sheets, then closes the dialog.
export async function moveGroup(page, group, direction) {
  await command(page, "Manage sheets");
  await page
    .getByLabel("Destination group", { exact: true })
    .selectOption({ label: group });
  await page
    .getByRole("button", { name: `Move group ${direction}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close sheet manager", exact: true })
    .click();
}
