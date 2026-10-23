# Shared editor shell

Framework-free components for the html-office editor shell, variant A of [ADR-011 §7](../../../docs/decisions/011-html-office-shared-principles.md). Each product bundles them into its own file, within its code ceiling. They know nothing about any product: a product builds its menus and toolbar from them and runs its own commands.

Started from the [R06 spike](../../../docs/HTML-DATA-NATIVE-SHELL-SPIKE.md). Only components with a working command in a product ship here.

| File | Contents |
| --- | --- |
| `dom.mjs` | Element helper, icons, labelled buttons and roving focus |
| `popover.mjs` | Anchored popover: one at a time, closes on outside pointer, Escape and resize, returns focus to its trigger |
| `menu.mjs` | ARIA menu, menu button and menu bar with type-ahead; checkbox and radio items |
| `toolbar.mjs` | ARIA toolbar: one tab stop, arrow keys, Home and End, pointer-only overflow arrows |
| `pickers.mjs` | Charte-token colour swatches (keyboard radio groups) and the border picker (presets, line style, colour) |
| `dialogs.mjs` | Native modal dialog, form field with error line, and the link dialog (the product supplies its own validation) |
| `drawer.mjs` | Side panel on the right, one at a time, a bottom sheet below 720 px; focus moves to its heading and back to the opening control |
| `panels.mjs` | Panel bodies: cell-style catalogue, document settings (theme and font), regional settings with a live preview |
| `icons.mjs` | Outline icons from the mock-ups, limited to shipped commands |
| `shell.css` | Neutral chrome, `.sh-` classes only, narrow layout below 720 px and print rules |

Rules the components enforce:
- A visible label is the accessible name, also when it is visually collapsed at narrow widths.
- A menu never lists an inert command. Disabled items stay focusable; the first enabled item takes focus.
- Popovers append to `#shell-layer` when present. Products mark mounted shell containers with `data-shell-mount` so saved copies can leave them empty.

The built-in chartes the theme picker offers live in [`../themes/chartes.mjs`](../themes/chartes.mjs) (TH01): token sets applied as `:root[data-theme=…]` overlays, never rewriting a document's own charte.

Used by: [html-data](../../data/runtime/shell.mjs) (U04-Data, F03, F05). Slides (U04-Slides) and Text (U04-Text) follow.
