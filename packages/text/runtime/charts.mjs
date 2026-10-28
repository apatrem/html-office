// Charts in the editor (T11), on the shared chart module. A chart shows its saved SVG preview;
// ECharts (pinned and SRI-verified through the shared loader, or embedded as script#echarts in
// the offline build) loads only to draw a chart that has no preview or an out-of-date one. A
// chart gets its ECharts instance when it first scrolls into view (IntersectionObserver), draws
// off screen, and its preview is saved from that drawing; the other charts keep their previews.
// Copy and paste follow ADR-013 §4.
import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import { h } from "../../shared/shell/dom.mjs";
import { modal, field } from "../../shared/shell/dialogs.mjs";
import { registry, theme, loadECharts } from "../../shared/charts/index.mjs";
import {
  sanitizeSVG,
  readChart,
  chartTable,
  chartText,
  CHART_LIMITS,
} from "../../shared/charts/clipboard.mjs";
import { chartPicture } from "../../shared/charts/picture.mjs";
// The envelope helpers only: tables through the clipboard are T07's (readClipboard, writeClipboard).
import {
  SCHEMA,
  MIME,
  LIMITS,
  ClipboardError,
  decodeEnvelope,
  encodeEnvelope,
  figureHTML,
  findEnvelope,
  parseInert,
} from "../../shared/clipboard/index.mjs";
import { domFromTree } from "../editor/schema/schema.mjs";
import { fromDom, serialize } from "../model/html.mjs";
import {
  SAMPLES,
  chartAt,
  chartProblem,
  insertChart,
  keyOf,
  previewKey,
  setPreview,
} from "../editor/charts.mjs";
import { FORMAT_VERSION } from "../model/format.mjs";

// The nominal plot size of a saved preview, per width; the SVG scales to the figure.
const SIZES = { text: [640, 320], full: [860, 360] };
const parse = (node) => JSON.parse(node.attrs.data);

// The library and every chart view. onChange() is called when the library's state changes.
export function chartManager(onChange) {
  // null until requested, then "loading", "ready" or "failed".
  let library = window.echarts ? "ready" : null,
    edited = false,
    look = "";
  const views = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const view = [...views].find((v) => v.plot === entry.target);
        if (view) view.visible = entry.isIntersecting;
        if (view?.visible) view.draw();
      }
    },
    { rootMargin: "200px" },
  );
  const manager = {
    views,
    get library() {
      return library;
    },
    // ECharts for the charts on screen; once only.
    request() {
      if (library !== null) return;
      library = "loading";
      onChange();
      void loadECharts().then((echarts) => {
        library = echarts ? "ready" : "failed";
        onChange();
        for (const v of views) v.refresh();
      });
    },
    // After every editor update: an edit or a new charte makes visible stale charts draw again.
    // edit: whether the person changed the document (generated labels and previews do not count).
    update(state, edit) {
      if (edit) edited = true;
      const next = `${state.doc.attrs.theme}|${state.doc.attrs.font}`;
      if (next !== look) {
        if (look) edited = true;
        look = next;
        for (const v of views) v.refresh();
      }
    },
    get edited() {
      return edited;
    },
    observer,
  };
  return manager;
}

// The editing view of a chart figure: title and unit, the plot (its preview), a state line and
// the caption. A click on the plot selects the figure; a double click opens the chart dialog.
function chartView(manager, edit) {
  return (node, view, getPos) => {
    const dom = document.createElement("figure");
    const head = dom.appendChild(h("div", { class: "tx-chart-head" }));
    const plot = dom.appendChild(h("div", { class: "tx-plot" }));
    const stateLine = dom.appendChild(h("div", { class: "tx-chart-state" }));
    const contentDOM = dom.appendChild(document.createElement("div"));
    for (const el of [head, plot, stateLine]) el.contentEditable = "false";
    let shown = null,
      instance = null,
      box = null;
    const self = { plot, visible: false };
    const select = () => {
      const pos = getPos();
      if (pos === undefined) return false;
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
      );
      view.focus();
      return true;
    };
    plot.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      select();
    });
    plot.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (select()) edit();
    });
    const expected = () =>
      previewKey(node.attrs.type, node.attrs.width, parse(node), theme());
    // "fresh", "missing" or "stale". A preview without a key (written elsewhere) counts as fresh.
    const status = () => {
      const p = node.attrs.preview;
      if (!p) return "missing";
      const key = keyOf(p);
      return key === null || key === expected() ? "fresh" : "stale";
    };
    function paint() {
      const data = parse(node);
      head.replaceChildren(
        ...(data.title
          ? [h("p", { class: "tx-chart-title" }, data.title)]
          : []),
        ...(data.unit ? [h("p", { class: "tx-chart-unit" }, data.unit)] : []),
      );
      if (shown !== node.attrs.preview) {
        shown = node.attrs.preview;
        plot.replaceChildren(...(shown ? [domFromTree(shown)] : []));
      }
      const s = status();
      const lib = manager.library;
      const message =
        s === "fresh"
          ? ""
          : lib === "failed"
            ? "Chart library unavailable (offline, blocked or failed its integrity check): the saved preview is kept."
            : lib === "loading" || (lib === "ready" && self.visible)
              ? "Drawing the chart…"
              : s === "missing"
                ? "No saved preview."
                : "Preview out of date.";
      stateLine.replaceChildren(
        ...(message
          ? [
              message,
              ...(lib === null
                ? [
                    " ",
                    h(
                      "button",
                      {
                        type: "button",
                        class: "sh-b sh-t sh-ghost",
                        onclick: () => manager.request(),
                      },
                      "Draw",
                    ),
                  ]
                : []),
            ]
          : []),
      );
      dom.classList.toggle("tx-stale", s !== "fresh");
    }
    // Draws an out-of-date chart in view, off screen, and saves the drawing as its preview.
    self.draw = () => {
      const s = status();
      if (s === "fresh") return;
      if (manager.library === null && (s === "missing" || manager.edited))
        manager.request();
      if (manager.library !== "ready" || !self.visible) return paint();
      const [width, height] = SIZES[node.attrs.width] ?? SIZES.text;
      if (!instance || box.dataset.size !== `${width}x${height}`) {
        instance?.dispose();
        box?.remove();
        box = h("div", { class: "tx-chart-draw", "aria-hidden": "true" });
        box.dataset.size = `${width}x${height}`;
        document.body.append(box);
        instance = window.echarts.init(box, null, {
          renderer: "svg",
          width,
          height,
        });
      }
      const key = expected();
      try {
        instance.setOption(
          registry[node.attrs.type].toOption(parse(node), theme()),
          true,
        );
      } catch {
        return paint();
      }
      const drawn = box.querySelector("svg");
      const clean =
        drawn &&
        sanitizeSVG(new XMLSerializer().serializeToString(drawn), {
          prefix: `tx-${node.attrs.id}-`,
        });
      const pos = getPos();
      if (!clean || pos === undefined) return paint();
      const tree = fromDom(clean);
      tree.attrs.push(["data-key", key]);
      const tr = setPreview(view.state, pos, tree);
      if (tr) view.dispatch(tr);
    };
    // Drawing dispatches a transaction: never from inside the editor's own update.
    const later = () =>
      queueMicrotask(() => {
        if (self.visible && getPos() !== undefined) self.draw();
      });
    self.refresh = () => {
      paint();
      later();
    };
    dom.className = "chart";
    const render = (n) => {
      node = n;
      dom.id = n.attrs.id;
      dom.dataset.type = n.attrs.type;
      dom.dataset.width = n.attrs.width;
      paint();
    };
    render(node);
    manager.views.add(self);
    manager.observer.observe(plot);
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        render(next);
        later();
        return true;
      },
      ignoreMutation: (m) =>
        m.type !== "selection" && !contentDOM.contains(m.target),
      destroy() {
        manager.observer.unobserve(plot);
        manager.views.delete(self);
        instance?.dispose();
        box?.remove();
      },
    };
  };
}

// ---------- copy and paste (ADR-013 §4) ----------
// The picture of the selected chart for other applications, drawn when it is selected because
// the copy event is synchronous; keyed by what it shows.
let picture = null;
function pictureFor(view, node) {
  const svg = view
    .nodeDOM(view.state.selection.from)
    ?.querySelector(".tx-plot > svg");
  if (!svg) return null;
  const data = parse(node);
  if (
    picture?.data !== node.attrs.data ||
    picture.preview !== node.attrs.preview
  ) {
    const p = { data: node.attrs.data, preview: node.attrs.preview, url: null };
    chartPicture(svg, {
      title: data.title,
      unit: data.unit,
      theme: theme(),
    }).then(
      (v) => (p.url = v.url),
      () => {},
    );
    picture = p;
  }
  return picture;
}

function copyChart(event, view, node) {
  const { type } = node.attrs;
  const { data } = readChart({ type, data: parse(node) });
  const svg = node.attrs.preview ? serialize(node.attrs.preview) : null;
  const caption =
    node.lastChild?.type.name === "caption" ? node.lastChild.textContent : "";
  const table = chartTable(type, data);
  const envelope = {
    schema: SCHEMA,
    kind: "chart",
    source: { product: "text", format: FORMAT_VERSION },
    chart: {
      type,
      data,
      width: node.attrs.width,
      ...(caption ? { caption } : {}),
      ...(svg && svg.length <= CHART_LIMITS.svg ? { svg } : {}),
    },
    ...(table.rows.length * table.rows[0].length <= LIMITS.htmlCells
      ? { table }
      : {}),
  };
  // The flavours of writeClipboard (ADR-013 §1): the envelope, the figure (its picture dropped
  // above the HTML limit) and the data as text.
  const json = encodeEnvelope(envelope);
  const text = chartText(type, data);
  if (text.length > LIMITS.text)
    throw new ClipboardError("the chart is too large for the clipboard");
  const label = data.title || caption || registry[type].label;
  const png = pictureFor(view, node)?.url ?? null;
  const html = [png, null]
    .map((p) => figureHTML({ envelope: json, png: p, caption: label }))
    .find((h) => h.length <= LIMITS.html);
  const out = event.clipboardData;
  out.setData(MIME, json);
  if (html) out.setData("text/html", html);
  out.setData("text/plain", text);
}

// The chart envelope on a pasted clipboard, from the custom type or the HTML attribute; null
// when there is none (other pastes are left to the editor).
function chartEnvelope(data) {
  const types = Array.from(data?.types ?? []);
  let json = types.includes(MIME) ? data.getData(MIME) : "";
  if (!json && types.includes("text/html")) {
    const html = data.getData("text/html");
    if (html.length <= LIMITS.html) json = findEnvelope(parseInert(html)) ?? "";
  }
  if (!json) return null;
  const { envelope } = decodeEnvelope(json, { maxCells: LIMITS.htmlCells });
  return envelope?.kind === "chart" ? envelope : null;
}

// A pasted chart: a new figure with a new ID, its caption and width when the source gave them.
// Its pasted preview is shown, sanitised, until this document's charte draws it again.
let pastes = 0;
function pasteChart(view, envelope) {
  const { type, data, svg } = readChart(envelope.chart);
  const { width, caption } = envelope.chart;
  const clean =
    svg &&
    sanitizeSVG(svg, { prefix: `tx-p${Date.now().toString(36)}${++pastes}-` });
  const preview = clean ? fromDom(clean) : null;
  // Drawn in another charte: never current here.
  preview?.attrs.push(["data-key", "pasted"]);
  return insertChart({
    type,
    data,
    width: ["text", "full"].includes(width) ? width : "text",
    preview,
    caption:
      typeof caption === "string" && caption.trim()
        ? [
            view.state.schema.text(
              caption.replace(/\s+/g, " ").trim().slice(0, 1000),
            ),
          ]
        : null,
  })(view.state, view.dispatch);
}

// The chart plugin: views, copy of a selected chart, paste of a chart envelope. Other copies and
// pastes are left to the editor.
const chartKey = new PluginKey("tx-charts");
export const chartPlugin = (manager, edit, report) =>
  new Plugin({
    key: chartKey,
    // Whether the last transaction was the person's edit: generated labels, contents and
    // previews are written outside the history.
    state: {
      init: () => false,
      apply: (tr) => tr.docChanged && tr.getMeta("addToHistory") !== false,
    },
    view: () => ({
      update(view) {
        manager.update(view.state, chartKey.getState(view.state));
        const found = chartAt(view.state);
        if (found && view.state.selection instanceof NodeSelection)
          pictureFor(view, found.node);
      },
    }),
    props: {
      nodeViews: { chart: chartView(manager, edit) },
      handleDOMEvents: {
        copy(view, event) {
          const sel = view.state.selection;
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== "chart")
            return false;
          event.preventDefault();
          try {
            copyChart(event, view, sel.node);
            report(
              "Chart copied. Paste it into Text or Slides; other applications receive a picture.",
            );
          } catch (error) {
            report(`Copy failed: ${error.message}.`);
          }
          return true;
        },
      },
      handlePaste(view, event) {
        let envelope;
        try {
          envelope = chartEnvelope(event.clipboardData);
        } catch (error) {
          // A recognised envelope that is malformed aborts the paste (ADR-013 §2).
          report(`Paste failed: ${error.message}. Document unchanged.`);
          return true;
        }
        if (!envelope) return false;
        try {
          if (!pasteChart(view, envelope))
            report("The chart cannot be pasted here.");
          else report("Chart pasted.");
        } catch (error) {
          report(`Paste failed: ${error.message}. Document unchanged.`);
        }
        return true;
      },
    },
  });

// ---------- the chart dialog ----------
const CATEGORY = ["column", "hbar", "stacked", "line"];

// initial: {type, data, width} or null for a new chart. onSave({type, data, width}); done() runs
// when it closes without saving (it puts the selection back).
export function chartDialog({ initial, onSave, done }) {
  let type = initial?.type ?? "column",
    data = structuredClone(initial?.data ?? SAMPLES.column);
  const typeSelect = h(
    "select",
    {},
    Object.entries(registry).map(([id, def]) =>
      h("option", { value: id }, def.label),
    ),
  );
  typeSelect.value = type;
  const width = h(
    "select",
    {},
    h("option", { value: "text" }, "Text width"),
    h("option", { value: "full" }, "Full page width"),
  );
  width.value = initial?.width ?? "text";
  const title = h("input", { type: "text" });
  const unit = h("input", { type: "text" });
  const grid = h("table", { class: "tx-chart-grid" });
  const json = h("textarea", { rows: "10", hidden: true, spellcheck: "false" });
  const error = h("p", { class: "sh-err", role: "status" });
  let headers, rows;
  const load = () => {
    const t = registry[type].table;
    headers = t.columns(data).map(String);
    rows = t.toRows(data).map((r) => r.map((v) => (v ?? "") + ""));
    title.value = data.title ?? "";
    unit.value = data.unit ?? "";
    draw();
  };
  const read = () => {
    const trs = [...grid.rows];
    headers = [...trs[0].querySelectorAll("input")].map((i) => i.value);
    rows = trs
      .slice(1)
      .map((tr) => [...tr.querySelectorAll("input")].map((i) => i.value));
  };
  function draw() {
    const t = registry[type].table;
    grid.replaceChildren(
      h(
        "tr",
        {},
        headers.map((text, j) =>
          h(
            "th",
            {},
            h("input", {
              value: text,
              "aria-label": `Column ${j + 1} name`,
              readonly: !(t.canAddColumn && j > 0),
            }),
          ),
        ),
      ),
      ...rows.map((row, i) =>
        h(
          "tr",
          {},
          headers.map((name, j) =>
            h(
              "td",
              {},
              h("input", {
                value: row[j] ?? "",
                "aria-label": `${name}, row ${i + 1}`,
              }),
            ),
          ),
        ),
      ),
    );
  }
  // The chart data from the form, or a message.
  const collect = () => {
    let next;
    if (!json.hidden) {
      try {
        next = JSON.parse(json.value);
      } catch (e) {
        return { problem: `Invalid JSON: ${e.message}` };
      }
    } else {
      read();
      const keep = rows.filter((r) => r.some((v) => String(v).trim()));
      try {
        next = registry[type].table.fromRows(keep, headers, data);
      } catch (e) {
        return { problem: e.message };
      }
      for (const [key, input] of [
        ["title", title],
        ["unit", unit],
      ])
        if (input.value.trim()) next[key] = input.value.trim();
        else delete next[key];
    }
    const problem = chartProblem(type, next);
    return problem ? { problem } : { data: next };
  };
  typeSelect.addEventListener("change", () => {
    const got = collect();
    const was = type;
    type = typeSelect.value;
    // Category charts share their data; another type starts from its sample.
    data =
      got.data && CATEGORY.includes(was) && CATEGORY.includes(type)
        ? got.data
        : structuredClone(SAMPLES[type]);
    load();
  });
  const button = (label, onclick) =>
    h(
      "button",
      { type: "button", class: "sh-b sh-t sh-ghost", onclick },
      label,
    );
  const edits = h(
    "div",
    { class: "tx-chart-rows" },
    button("Add row", () => {
      read();
      rows.push(headers.map(() => ""));
      draw();
    }),
    button("Remove row", () => {
      read();
      if (rows.length > 1) rows.pop();
      draw();
    }),
    button("Add series", () => {
      read();
      if (!registry[type].table.canAddColumn) return;
      headers.push(`Series ${headers.length}`);
      for (const r of rows) r.push("");
      draw();
    }),
    button("Remove series", () => {
      read();
      if (!registry[type].table.canAddColumn || headers.length <= 2) return;
      headers.pop();
      for (const r of rows) r.pop();
      draw();
    }),
    button("JSON", () => {
      const got = collect();
      if (json.hidden && got.data)
        json.value = JSON.stringify(got.data, null, 2);
      else if (!json.hidden) {
        if (!got.data) return void (error.textContent = got.problem);
        data = got.data;
        load();
      }
      json.hidden = !json.hidden;
      grid.hidden = !json.hidden;
    }),
  );
  load();
  let result = null;
  const dialog = modal(
    initial ? "Chart" : "Insert chart",
    [
      h(
        "div",
        { class: "sh-two" },
        field("Type", typeSelect),
        field("Width", width),
      ),
      h("div", { class: "sh-two" }, field("Title", title), field("Unit", unit)),
      h("div", { class: "tx-chart-table" }, grid, json),
      edits,
      h(
        "p",
        { class: "sh-hint" },
        "Other options (decimals, highlight, labels…) are in JSON.",
      ),
      error,
    ],
    [
      h("span", { class: "sh-spacer" }),
      button("Cancel", () => dialog.close()),
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-primary",
          onclick: () => {
            const got = collect();
            if (!got.data) return void (error.textContent = got.problem);
            result = { type, data: got.data, width: width.value };
            dialog.close();
          },
        },
        initial ? "Apply" : "Insert",
      ),
    ],
    {
      onClose: () => {
        if (result) onSave(result);
        else done();
      },
      opener: { isConnected: false },
    },
  );
  typeSelect.focus();
}
