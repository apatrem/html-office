# Shared editor shell

Framework-free components for the html-office editor shell, variant A of [ADR-011 §7](../../../docs/decisions/011-html-office-shared-principles.md). Each product bundles them into its own file, within its code ceiling. They know nothing about any product: a product builds its menus and toolbar from them and runs its own commands.

Started from the [R06 spike](../../../docs/HTML-DATA-NATIVE-SHELL-SPIKE.md). Only components with a working command in a product ship here.

| File | Contents |
| --- | --- |
| `commands.mjs` | Command/state API between a product runtime and its shell: register, run, enabled, subscribe, changed |
| `dom.mjs` | Element helper, icons, labelled buttons and roving focus |
| `popover.mjs` | Anchored popover: one at a time, closes on outside pointer, Escape and resize, returns focus to its trigger |
| `menu.mjs` | ARIA menu, menu button and menu bar with type-ahead; checkbox and radio items, optional item icons |
| `toolbar.mjs` | ARIA toolbar: one tab stop, arrow keys, Home and End, pointer-only overflow arrows |
| `pickers.mjs` | Colour button, charte-token colour swatches (keyboard radio groups) and the border picker (presets, line style, colour) |
| `dialogs.mjs` | Native modal dialog, form field with error line, and the link dialog (the product supplies its own validation) |
| `drawer.mjs` | Side panel on the right, one at a time, a bottom sheet below 720 px; focus moves to its heading and back to the opening control |
| `panels.mjs` | Panel bodies: cell-style catalogue, document settings (theme and font), regional settings with a live preview |
| `icons.mjs` | Outline icons from the mock-ups, limited to shipped commands |
| `shell.css` | Neutral chrome, `.sh-` classes only: rows, buttons, toolbar, menus, swatches, context chip and floating settings bar; narrow layout below 720 px and print rules |
| `drawer.css` | Side panel (a bottom sheet below 720 px) and the document-settings body; load after `shell.css` in every product with document settings |
| `panels.css` | Link card, border picker, dialogs and the Data panel bodies (cell styles, regional settings); load after `drawer.css` when the product uses them |

Rules the components enforce:
- A visible label is the accessible name, also when it is visually collapsed at narrow widths.
- A menu never lists an inert command. Disabled items stay focusable; the first enabled item takes focus.
- Popovers append to `#shell-layer` when present. Products mark mounted shell containers with `data-shell-mount` so saved copies can leave them empty. Slides builds its whole shell at load and saves only the nodes the file had, so it needs no mount points.

The built-in chartes the theme picker offers live in [`../themes/chartes.mjs`](../themes/chartes.mjs) (TH01): token sets applied as `:root[data-theme=…]` overlays, never rewriting a document's own charte. The six document fonts are in [`../themes/fonts.mjs`](../themes/fonts.mjs) (TH02).

Used by: [html-data](../../data/runtime/shell.mjs) (U04-Data, F03, F05) and [html-slides](../../../src/engine/shell.js) (U04-Slides; commands in [`commands.js`](../../../src/engine/commands.js)). Text (U04-Text) follows.
