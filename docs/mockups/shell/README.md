# Editor shell mock-ups (U02)

Static mock-ups for task U02 of the [cross-product plan](../../HTML-OFFICE-CROSS-PLAN.md). Open [`index.html`](index.html) in a browser to compare the three variants side by side. The audit and constraints are in the [design brief](../../HTML-OFFICE-SHELL-BRIEF.md). These are not product code.

- `a-*.html`, `b-*.html`, `c-*.html`: one self-contained page per variant and product. Menus, side panels, ribbon tabs, theme and font switching work; nothing else does. Append `#styles`, `#regional`, `#settings`, `#comments`, `#outline`, `#insert`, `#help` or `#none` to open a given panel.
- `screenshots/`: 1440 × 900 and 375 × 812 captures plus `measurements.json` (canvas height and visible grid rows).
- `src/`: shared pieces (content computed from `packages/data/fixtures/pnl.json`, icons and components, canvases and panels, the three variants, CSS and the small in-page script).

Regenerate from the repository root:

```sh
node docs/mockups/shell/build.mjs          # pages and index only
node docs/mockups/shell/screenshots.mjs    # pages, screenshots, measurements and index (Playwright Chromium)
node docs/mockups/shell/check.mjs          # interaction checks: menus, submenus, panels, focus return
```

Built-in theme colours are placeholders until TH01.
