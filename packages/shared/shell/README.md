# Shared editor shell

Framework-free components for the html-office editor shell, variant A of [ADR-011 §7](../../../docs/decisions/011-html-office-shared-principles.md). Each product bundles them into its own file, within its code ceiling. They know nothing about any product: a product builds its menus and toolbar from them and runs its own commands.

Started from the [R06 spike](../../../docs/HTML-DATA-NATIVE-SHELL-SPIKE.md). Only components with a working command in a product ship here. The colour swatches, border picker, side panel, link dialog and settings panels stay in [`tools/shell-spike/shell/`](../../../tools/shell-spike/shell/) until the task that makes them work moves them (Data F02, F03 and F05).

| File | Contents |
| --- | --- |
| `dom.mjs` | Element helper, icons, labelled buttons and roving focus |
| `popover.mjs` | Anchored popover: one at a time, closes on outside pointer, Escape and resize, returns focus to its trigger |
| `menu.mjs` | ARIA menu, menu button and menu bar with type-ahead; checkbox and radio items |
| `toolbar.mjs` | ARIA toolbar: one tab stop, arrow keys, Home and End, pointer-only overflow arrows |
| `icons.mjs` | Outline icons from the mock-ups, limited to shipped commands |
| `shell.css` | Neutral chrome, `.sh-` classes only, narrow layout below 720 px and print rules |

Rules the components enforce:
- A visible label is the accessible name, also when it is visually collapsed at narrow widths.
- A menu never lists an inert command. Disabled items stay focusable; the first enabled item takes focus.
- Popovers append to `#shell-layer` when present. Products mark mounted shell containers with `data-shell-mount` so saved copies can leave them empty.

Used by: [html-data](../../data/runtime/shell.mjs) (U04-Data). Slides (U04-Slides) and Text (U04-Text) follow.
