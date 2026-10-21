import { fromNumberFormat, toNumberFormat } from "./formats.mjs";
export function mountNative(node, bridge, icons) {
  const unsupported = "Unsupported in the current HTML Data model";
  function button(label, icon, handler) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = handler ? label : label + " — " + unsupported;
    b.setAttribute("aria-label", label);
    b.innerHTML = icons[icon];
    b.disabled = !handler;
    if (handler) b.onclick = handler;
    b.dataset.supported = String(!!handler);
    return b;
  }
  const bar = document.createElement("div");
  bar.className = "light-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Lightweight editing toolbar");
  function group(items) {
    const g = document.createElement("div");
    g.className = "light-group";
    for (const x of items) g.append(x);
    bar.append(g);
  }
  const undo = button("Undo", "Undo2", () => bridge.command("undo")),
    redo = button("Redo", "Redo2", () => bridge.command("redo"));
  group([undo, redo]);
  group([
    button("Copy styles", "PaintRoller"),
    button("Clear formatting", "RemoveFormatting", () => bridge.clear()),
  ]);
  const formatButton = (label, icon, format) =>
    button(label, icon, () => bridge.format(format()));
  const currency = formatButton("Currency", "Euro", () => ({
    kind: "currency",
    digits: 2,
    currency: bridge.state().format.currency ?? "EUR",
  }));
  const percent = formatButton("Percentage", "Percent", () => ({
    kind: "percent",
    digits: 2,
  }));
  const decimals = (delta) => {
    const f = bridge.state().format;
    if (f.kind === "date") return;
    bridge.format({
      ...f,
      kind: f.kind === "general" ? "number" : f.kind,
      digits: Math.max(0, Math.min(15, (f.digits ?? 2) + delta)),
    });
  };
  const decrease = button("Decrease decimal places", "DecimalsArrowLeft", () =>
      decimals(-1),
    ),
    increase = button("Increase decimal places", "DecimalsArrowRight", () =>
      decimals(1),
    );
  const formats = document.createElement("select");
  formats.setAttribute("aria-label", "Toolbar number format");
  for (const [label, f] of [
    ["Automatic", { kind: "general" }],
    ["Number", { kind: "number", digits: 2 }],
    ["Percentage", { kind: "percent", digits: 2 }],
    ["Euros", { kind: "currency", digits: 2, currency: "EUR" }],
    ["US Dollars", { kind: "currency", digits: 2, currency: "USD" }],
    ["Pounds", { kind: "currency", digits: 2, currency: "GBP" }],
    ["Date", { kind: "date" }],
  ])
    formats.add(new Option(label, toNumberFormat(f)));
  formats.onchange = () => bridge.format(fromNumberFormat(formats.value));
  group([currency, percent, decrease, increase, formats]);
  group([
    button("Decrease font size", "Minus"),
    Object.assign(document.createElement("input"), {
      value: "12",
      disabled: true,
      title: unsupported,
    }),
    button("Increase font size", "Plus"),
  ]);
  group([
    button("Bold", "Bold"),
    button("Italic", "Italic"),
    button("Underline", "Underline"),
    button("Strike through", "Strikethrough"),
  ]);
  group([
    button("Font color", "Type"),
    button("Fill color", "PaintBucket"),
    button("Borders", "Grid2X2"),
    button("Conditional formatting", "Brush", () =>
      bridge.command("manage-conditional"),
    ),
    button("Themes", "SwatchBook"),
    button("Named styles", "Layers"),
  ]);
  group(
    [
      "AlignLeft",
      "AlignCenter",
      "AlignRight",
      "ArrowUpToLine",
      "ArrowDownToLine",
      "WrapText",
      "TableCellsMerge",
    ].map((name) => button(name, name)),
  );
  let lines = true;
  group([
    button("Add link", "Link2"),
    button("Download PNG", "ImageDown"),
    button("Show/hide grid lines", "Grid2x2Check", () => {
      lines = !lines;
      document
        .getElementById("grid")
        .classList.toggle("assessment-no-grid", !lines);
    }),
  ]);
  node.replaceChildren(bar);
  function draw() {
    const state = bridge.state();
    for (const b of bar.querySelectorAll('[data-supported="true"]'))
      b.disabled = !state.canEdit;
    undo.disabled = !state.canUndo;
    redo.disabled = !state.canRedo;
    formats.disabled = !state.canEdit;
    const value = toNumberFormat(state.format);
    const old = formats.querySelector("[data-current]");
    if (old) old.remove();
    if (![...formats.options].some((o) => o.value === value)) {
      const o = new Option("Current: " + value, value);
      o.dataset.current = "";
      formats.add(o);
    }
    formats.value = value;
  }
  document.addEventListener("assessment-state", draw);
  draw();
}
