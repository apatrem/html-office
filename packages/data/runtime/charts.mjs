// Charts over the grid (T18, ADR-013 §4). A chart shows its saved SVG preview
// as an image until ECharts is available; then it gets an ECharts instance
// when it first scrolls into view, and the others keep their preview.
// ECharts loads only for editing: a chart command, Redraw, or a workbook
// change that leaves a chart on screen out of date. Offline builds embed it.
import { h } from "../../shared/shell/dom.mjs";
import { field } from "../../shared/shell/dialogs.mjs";
import { theme, loadECharts } from "../../shared/charts/index.mjs";
import { schemas, dataFields } from "../../shared/charts/schema.mjs";
import {
  chartData,
  chartLabel,
  chartOption,
  chartRevision,
  chartTypes,
  columnsHint,
  nextChartId,
  plotSize,
  previewSource,
  typeLabel,
  validateCharts,
  DEFAULT_SIZE,
  HEIGHTS,
  MAX_PREVIEW,
  WIDTHS,
} from "../model/charts.mjs";
import { address, parseAddress } from "../model/workbook.mjs";
import { sheetAxes } from "../model/axis.mjs";
import {
  ROWS,
  COLUMNS,
  ROW_HEIGHT,
  COLUMN_WIDTH,
  ROW_HEADER,
} from "../model/navigation.mjs";
import { display } from "./view.mjs";

const SIZES = {
  rows: ROWS,
  columns: COLUMNS,
  height: ROW_HEIGHT,
  width: COLUMN_WIDTH,
};
const rangeText = (r) =>
  r.top === r.bottom && r.left === r.right
    ? address(r.top, r.left)
    : `${address(r.top, r.left)}:${address(r.bottom, r.right)}`;
// Chart-level options a type accepts, with the panel's control for each.
const OPTION_CONTROLS = {
  title: ["text", "Title"],
  unit: ["text", "Unit"],
  decimals: ["integer", "Decimal places"],
  prefix: ["text", "Number prefix"],
  suffix: ["text", "Number suffix"],
  highlight: ["highlight", "Highlight (number from 1, or name)"],
  percent: ["boolean", "100 % stacked"],
  horizontal: ["boolean", "Horizontal bars"],
  totals: ["boolean", "Show totals", true],
  labels: ["choice", "Value labels", ["last", "all", "none"]],
  scale: ["boolean", "Axis need not start at zero"],
  increase: ["choice", "Increases are", ["bad", "good"]],
  xLabel: ["text", "X axis label"],
  yLabel: ["text", "Y axis label"],
  xUnit: ["text", "X unit"],
  yUnit: ["text", "Y unit"],
  xRef: ["number", "X reference line"],
  yRef: ["number", "Y reference line"],
};
export const optionKeys = (type) =>
  Object.keys(schemas[type].object).filter(
    (key) => !dataFields[type].includes(key),
  );

export function setupCharts({
  root,
  getBook,
  getSheetId,
  getSelection,
  isSnapshotCurrent = () => false,
  // Increases with every workbook change: derived chart data is cached by it.
  getRevision = () => 0,
  edited = () => false,
  busy = () => false,
  publish,
  status,
  changed = () => {},
  openPanel = () => {},
}) {
  const layer = h("div", { class: "chart-layer", "data-shell-mount": "" });
  root.append(layer);
  // Per chart: the derived data and its revision, the figure while the
  // chart's sheet is shown, and its ECharts instance once live.
  const states = new Map(),
    revisions = new Map(),
    derived = new WeakMap(),
    visible = new Set();
  // null until requested, then "loading", "ready" or "failed".
  let library = window.echarts ? "ready" : null,
    selectedId = null,
    panel = null,
    draft = null,
    savedDraft = null,
    dirtyDraft = false,
    lastPanelKey = "";
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.chart;
        if (entry.isIntersecting) {
          visible.add(id);
          live(id);
        } else visible.delete(id);
      }
      offerLibrary();
    },
    { root, rootMargin: "120px" },
  );
  const chartsOf = () => getBook().charts ?? [];
  const find = (id) => chartsOf().find((c) => c.id === id);
  const label = (cell) => display(cell, getBook().locale);
  const sheetName = (id) =>
    getBook().sheets.find((s) => s.id === id)?.name ?? id;
  const describe = (chart) =>
    `${chartLabel(chart)}. ${typeLabel(chart.type)} chart of ${sheetName(chart.source.sheetId)}!${chart.source.ref}.`;

  // Data and revision of a chart from the committed workbook, cached per
  // chart definition and workbook revision; a draft being edited is not.
  function derive(chart, t = theme(), cache = true) {
    const stamp = `${getRevision()} ${getBook().locale} ${JSON.stringify(t)}`,
      hit = cache && derived.get(chart);
    if (hit?.stamp === stamp) {
      const revision = revisions.get(hit.value.key);
      return revision ? { ...hit.value, revision } : hit.value;
    }
    const result = chartData(getBook(), chart, label),
      key = JSON.stringify([
        chart.type,
        chart.width,
        chart.height,
        t,
        result.data ?? null,
        result.errors,
      ]);
    let revision = revisions.get(key);
    if (revision === undefined && !result.errors.length) {
      revision = null;
      revisions.set(key, null);
      void chartRevision(chart, result.data, t).then((value) => {
        revisions.set(key, value);
        scheduleDraw();
      });
    }
    const value = { ...result, key, revision: revision ?? null };
    if (cache) derived.set(chart, { stamp, value });
    return value;
  }
  // Revisions arrive one by one: one redraw follows them.
  let pending = false;
  function scheduleDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  }
  function previewState(chart, s) {
    if (s.errors.length) return "invalid";
    if (s.instance) return "live";
    if (!chart.preview) return "missing";
    if (s.revision === null) return "checking";
    return chart.preview.revision === s.revision ? "current" : "stale";
  }
  function badge(chart, s, state) {
    const notes = [];
    if (state === "stale") notes.push("Preview out of date.");
    if (state === "missing") notes.push("No saved preview.");
    if (s.formulas && !isSnapshotCurrent())
      notes.push("Values not recalculated.");
    if (["stale", "missing"].includes(state) && library === "failed")
      notes.push("Chart library unavailable.");
    if (!notes.length) return null;
    return h(
      "p",
      { class: "data-chart-badge", role: "status" },
      notes.join(" "),
      ["stale", "missing"].includes(state) && library === null
        ? h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: (event) => {
                event.stopPropagation();
                redraw();
              },
            },
            "Redraw",
          )
        : null,
    );
  }
  function position(sheet, chart) {
    const { rows, columns } = sheetAxes(sheet, SIZES),
      p = parseAddress(chart.anchor);
    return {
      left: `${ROW_HEADER + columns.start(p.column)}px`,
      top: `${ROW_HEIGHT + rows.start(p.row)}px`,
      width: `${chart.width}px`,
      height: `${chart.height}px`,
    };
  }
  function figureFor(chart) {
    const figure = h("figure", {
      class: "data-chart",
      tabindex: "0",
      "data-chart": chart.id,
      onpointerdown: (event) => {
        event.stopPropagation();
        if (event.target.closest("button")) return;
        select(chart.id);
      },
      ondblclick: (event) => {
        event.stopPropagation();
        select(chart.id);
        openPanel();
      },
      onkeydown: (event) => {
        const command = event.ctrlKey || event.metaKey;
        if (command && ["z", "y"].includes(event.key.toLowerCase())) return;
        event.stopPropagation();
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          void remove(chart.id);
        } else if (event.key === "Enter") {
          event.preventDefault();
          openPanel();
        } else if (event.key === "Escape") {
          select(null);
          root.focus();
        }
      },
      onfocus: () => select(chart.id),
    });
    observer.observe(figure);
    return figure;
  }
  // Rebuilds a figure's head, plot and badge when what it shows changes;
  // a live plot keeps its ECharts instance and only receives new options.
  function paint(chart, s) {
    const state = previewState(chart, s),
      view = JSON.stringify([
        chart,
        s.errors,
        state,
        s.formulas && !isSnapshotCurrent(),
        library,
        getBook().sheets.map((x) => x.name),
      ]);
    s.figure.classList.toggle("selected", selectedId === chart.id);
    s.figure.dataset.state = state;
    if (s.view === view) return;
    s.view = view;
    s.figure.setAttribute("aria-label", describe(chart));
    const { width, height } = plotSize(chart),
      plot =
        state === "live"
          ? s.plot
          : h("div", {
              class: "data-chart-plot",
              style: `width:${width}px;height:${height}px`,
            });
    if (state === "invalid")
      plot.append(
        h(
          "p",
          { class: "data-chart-msg" },
          `Chart cannot be drawn: ${s.errors.join(" ")}`,
        ),
      );
    else if (state !== "live" && chart.preview)
      plot.append(
        h("img", {
          src: previewSource(chart.preview.svg),
          alt: describe(chart),
          width: String(width),
          height: String(height),
        }),
      );
    else if (state !== "live")
      plot.append(
        h(
          "p",
          { class: "data-chart-msg" },
          library === "loading" ? "Loading the chart library…" : "",
        ),
      );
    s.plot = plot;
    s.figure.replaceChildren(
      ...[
        chart.options.title || chart.options.unit
          ? h(
              "div",
              { class: "data-chart-head" },
              chart.options.title
                ? h("p", { class: "data-chart-title" }, chart.options.title)
                : null,
              chart.options.unit
                ? h("p", { class: "data-chart-unit" }, chart.options.unit)
                : null,
            )
          : null,
        plot,
        badge(chart, s, state),
      ].filter(Boolean),
    );
  }
  function dispose(s) {
    if (!s.instance) return;
    // A preview drawn this session survives leaving the sheet.
    if (s.liveRevision)
      s.captured = {
        svg: s.instance.renderToSVGString(),
        revision: s.liveRevision,
      };
    s.instance.dispose();
    s.instance = null;
  }
  // Creates or updates the ECharts instance of a visible chart.
  function live(id) {
    const chart = find(id),
      s = states.get(id);
    if (library !== "ready" || !chart || !s?.figure) return;
    if (s.errors.length) {
      if (s.instance) {
        dispose(s);
        s.view = null;
      }
      return;
    }
    const { width, height } = plotSize(chart),
      size = `${width}x${height}`;
    if (s.instance && s.liveKey === s.key && s.size === size) return;
    // A new size (the box, or a title or unit added) needs a new instance.
    if (s.instance && s.size !== size) {
      s.instance.dispose();
      s.instance = null;
    }
    // An instance is created only for a chart in view; one scrolled away
    // still follows its data.
    if (!s.instance && !visible.has(id)) return;
    if (!s.instance) {
      s.size = size;
      s.plot = h("div", {
        class: "data-chart-plot live",
        style: `width:${width}px;height:${height}px`,
      });
      s.instance = window.echarts.init(s.plot, null, {
        renderer: "svg",
        width,
        height,
      });
      s.view = null;
    }
    s.instance.setOption(chartOption(chart, s.data, theme()), true);
    s.liveKey = s.key;
    s.liveRevision = s.revision;
    s.captured = null;
    paint(chart, s);
  }
  // Offline builds carry ECharts as inert text (script#echarts-source,
  // checked at build time): it runs only when a chart is first drawn or
  // edited, as the standard build's CDN load does. (An element with the id
  // "echarts" would shadow window.echarts.)
  function embeddedLibrary() {
    const source = document.getElementById("echarts-source");
    if (source?.type !== "text/plain") return null;
    return new Promise((resolve) => {
      const url = URL.createObjectURL(
          new Blob([source.textContent], { type: "text/javascript" }),
        ),
        script = document.createElement("script");
      script.src = url;
      script.setAttribute("data-ui", "");
      script.onload = script.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(window.echarts || null);
      };
      document.head.append(script);
    });
  }
  function requestLibrary() {
    if (library !== null) return;
    library = "loading";
    status("Loading the chart library…");
    draw();
    void (embeddedLibrary() ?? loadECharts()).then((echarts) => {
      library = echarts ? "ready" : "failed";
      if (!echarts)
        status(
          "Chart library unavailable: it was blocked, is offline or failed its integrity check. Charts keep their saved previews; reopen the file to try again.",
        );
      else status("Chart library loaded.");
      draw();
      changed();
    });
  }
  // After an edit, a visible chart that is out of date asks for ECharts.
  function offerLibrary() {
    if (library !== null || !edited()) return;
    for (const id of visible) {
      const chart = find(id),
        s = states.get(id);
      if (chart && s && ["stale", "missing"].includes(previewState(chart, s)))
        return requestLibrary();
    }
  }
  function draw() {
    // A workbook without charts costs nothing on each render.
    if (!states.size && !getBook().charts?.length) return void drawPanel();
    const sheetId = getSheetId(),
      sheet = getBook().sheets.find((x) => x.id === sheetId),
      shown = new Set(),
      t = theme();
    for (const chart of chartsOf()) {
      let s = states.get(chart.id);
      if (!s) states.set(chart.id, (s = {}));
      if (chart.sheetId !== sheetId) continue;
      Object.assign(s, derive(chart, t));
      shown.add(chart.id);
      if (!s.figure) {
        s.figure = figureFor(chart);
        layer.append(s.figure);
      }
      Object.assign(s.figure.style, position(sheet, chart));
      if (s.instance) live(chart.id);
      // The revision of a live drawing may arrive after the drawing.
      if (s.instance && s.liveKey === s.key) s.liveRevision ??= s.revision;
      paint(chart, s);
      if (!s.instance) live(chart.id);
    }
    for (const [id, s] of states) {
      if (shown.has(id)) continue;
      dispose(s);
      if (s.figure) {
        observer.unobserve(s.figure);
        s.figure.remove();
        s.figure = null;
        s.view = null;
        visible.delete(id);
      }
      if (!find(id)) states.delete(id);
    }
    if (selectedId && !shown.has(selectedId)) selectedId = null;
    offerLibrary();
    drawPanel();
  }
  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    for (const [key, s] of states)
      s.figure?.classList.toggle("selected", key === id);
    if (id) {
      openDraft(id);
      drawPanel();
    }
    changed();
  }
  function redraw() {
    requestLibrary();
  }
  // The workbook with this session's drawings as saved previews.
  function finalize(book) {
    if (!book.charts?.length) return book;
    let replaced = false;
    const charts = book.charts.map((chart) => {
      const s = states.get(chart.id);
      if (!s) return chart;
      let preview = s.captured;
      if (s.instance && s.liveRevision && s.liveKey === s.key)
        preview = {
          svg: s.instance.renderToSVGString(),
          revision: s.liveRevision,
        };
      // Only a drawing of the chart's current data replaces its preview.
      if (!preview || preview.revision !== derive(chart).revision) return chart;
      // A drawing over the stored limit is not kept (ADR-013 §4): the chart
      // reopens without a preview rather than making the file unsavable.
      if (preview.svg.length > MAX_PREVIEW) {
        if (!chart.preview) return chart;
        replaced = true;
        const { preview: _, ...rest } = chart;
        return rest;
      }
      if (
        chart.preview?.revision === preview.revision &&
        chart.preview.svg === preview.svg
      )
        return chart;
      replaced = true;
      return { ...chart, preview };
    });
    return replaced ? { ...book, charts } : book;
  }

  // ---- commands ----
  function commit(next, message, focusId) {
    const book = getBook(),
      // Workbook data is plain JSON: no undefined fields.
      charts = JSON.parse(JSON.stringify(next));
    validateCharts({ ...book, charts });
    if (!publish(charts, message)) return false;
    if (focusId !== undefined) {
      selectedId = focusId;
      openDraft(focusId);
    }
    draw();
    requestLibrary();
    if (focusId) reveal(focusId);
    return true;
  }
  function reveal(id) {
    const s = states.get(id);
    if (!s?.figure) return;
    s.figure.scrollIntoView({ block: "nearest", inline: "nearest" });
    s.figure.focus({ preventScroll: true });
  }
  async function remove(id) {
    const chart = find(id);
    if (!chart || busy()) return;
    if (
      commit(
        chartsOf().filter((c) => c.id !== id),
        `Chart "${chartLabel(chart)}" deleted. Unsaved changes.`,
        null,
      )
    )
      root.focus();
  }
  function duplicate(id) {
    const chart = find(id);
    if (!chart || busy()) return;
    const p = parseAddress(chart.anchor),
      copy = {
        ...structuredClone(chart),
        id: nextChartId(getBook()),
        anchor: address(Math.min(ROWS, p.row + 2), p.column),
      };
    commit(
      [...chartsOf(), copy],
      `Chart duplicated with the same data range. Unsaved changes.`,
      copy.id,
    );
  }
  // A new chart from the selection, placed two columns to its right.
  function create() {
    const s = getSelection(),
      ref = rangeText(s),
      sheetId = getSheetId();
    draft = {
      id: nextChartId(getBook()),
      sheetId,
      anchor: address(s.top, Math.min(COLUMNS, s.right + 2)),
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      type: "column",
      options: {},
      source: { sheetId, ref },
    };
    savedDraft = null;
    dirtyDraft = true;
    lastPanelKey = "";
    requestLibrary();
  }
  function openDraft(id) {
    const chart = find(id);
    savedDraft = chart ?? null;
    draft = chart ? structuredClone(chart) : null;
    dirtyDraft = false;
    lastPanelKey = "";
  }

  // ---- panel ----
  function setOption(key, value) {
    if (value === undefined || value === "") delete draft.options[key];
    else draft.options[key] = value;
    dirtyDraft = true;
    renderPanel();
  }
  function optionControl(key) {
    const [kind, text, extra] = OPTION_CONTROLS[key] ?? ["text", key],
      value = draft.options[key],
      common = { "data-ck": key };
    if (kind === "boolean")
      return h(
        "label",
        { class: "checkbox-label" },
        h("input", {
          ...common,
          type: "checkbox",
          checked: (value ?? extra ?? false) || null,
          onchange: (event) =>
            setOption(
              key,
              event.target.checked === (extra ?? false)
                ? undefined
                : event.target.checked,
            ),
        }),
        text,
      );
    if (kind === "choice")
      return field(
        text,
        h(
          "select",
          {
            ...common,
            onchange: (event) =>
              setOption(
                key,
                event.target.value === extra[0]
                  ? undefined
                  : event.target.value,
              ),
          },
          extra.map((option) =>
            h(
              "option",
              {
                value: option,
                selected: (value ?? extra[0]) === option || null,
              },
              option,
            ),
          ),
        ),
      );
    const shown =
      kind === "highlight" && typeof value === "number" ? value + 1 : value;
    return field(
      text,
      h("input", {
        ...common,
        value: shown ?? "",
        inputmode: ["integer", "number"].includes(kind) ? "decimal" : null,
        onchange: (event) => {
          const raw = event.target.value.trim();
          if (!raw) return setOption(key, undefined);
          if (kind === "integer" || kind === "number") {
            const n = Number(raw);
            return setOption(key, raw && Number.isFinite(n) ? n : raw);
          }
          if (kind === "highlight")
            return setOption(
              key,
              /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) - 1 : raw,
            );
          setOption(key, raw);
        },
      }),
    );
  }
  function problems() {
    if (!draft) return [];
    try {
      validateCharts({
        ...getBook(),
        charts: [...chartsOf().filter((c) => c.id !== draft.id), draft],
      });
    } catch (error) {
      return [error.message];
    }
    return [];
  }
  function renderPanel() {
    if (!panel?.isConnected) return;
    const active = document.activeElement?.closest?.("[data-ck]"),
      focused = active?.dataset.ck,
      // Text being typed survives a re-render (it is applied on change).
      typing = active?.matches("input:not([type=checkbox])")
        ? active.value
        : undefined;
    lastPanelKey = panelKey();
    if (!draft)
      return void panel.replaceChildren(
        h(
          "p",
          { class: "sh-hint" },
          "Select a chart in the grid, or select a data range and choose Insert › Chart.",
        ),
        h(
          "div",
          { class: "sh-prow" },
          h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t",
              "data-ck": "new",
              onclick: () => {
                create();
                renderPanel();
              },
            },
            "New chart from selection",
          ),
        ),
      );
    const derivedDraft = derive(draft, theme(), false),
      invalid = problems(),
      sheets = getBook().sheets,
      sourceRef = h("input", {
        "data-ck": "ref",
        value: draft.source.ref,
        onchange: (event) => {
          draft.source = {
            ...draft.source,
            ref: event.target.value.trim().toUpperCase(),
          };
          dirtyDraft = true;
          renderPanel();
        },
      });
    const numberField = (key, text, [min, max]) =>
      field(
        `${text} (${min}–${max} px)`,
        h("input", {
          "data-ck": key,
          value: String(draft[key]),
          inputmode: "numeric",
          onchange: (event) => {
            const n = Number(event.target.value);
            draft[key] = Number.isInteger(n) ? n : event.target.value;
            dirtyDraft = true;
            renderPanel();
          },
        }),
      );
    // h() flattens the option controls and drops absent parts.
    const content = h(
      "div",
      {},
      h(
        "p",
        { class: "sh-hint", role: "status" },
        savedDraft
          ? `${chartLabel(savedDraft)} on ${sheetName(savedDraft.sheetId)}, at ${savedDraft.anchor}.`
          : "New chart: not inserted yet.",
      ),
      field(
        "Chart type",
        h(
          "select",
          {
            "data-ck": "type",
            onchange: (event) => {
              const type = event.target.value,
                keep = optionKeys(type);
              draft.type = type;
              draft.options = Object.fromEntries(
                Object.entries(draft.options).filter(([key]) =>
                  keep.includes(key),
                ),
              );
              dirtyDraft = true;
              renderPanel();
            },
          },
          chartTypes().map((type) =>
            h(
              "option",
              { value: type, selected: draft.type === type || null },
              typeLabel(type),
            ),
          ),
        ),
      ),
      h("h3", {}, "Data"),
      field(
        "Data sheet",
        h(
          "select",
          {
            "data-ck": "source-sheet",
            onchange: (event) => {
              draft.source = { ...draft.source, sheetId: event.target.value };
              dirtyDraft = true;
              renderPanel();
            },
          },
          sheets.map((s) =>
            h(
              "option",
              { value: s.id, selected: draft.source.sheetId === s.id || null },
              s.name,
            ),
          ),
        ),
      ),
      field("Data range (header row first)", sourceRef),
      h("p", { class: "sh-hint" }, `Columns: ${columnsHint(draft.type)}.`),
      h(
        "div",
        { class: "sh-prow" },
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            "data-ck": "use-selection",
            onclick: () => {
              draft.source = {
                sheetId: getSheetId(),
                ref: rangeText(getSelection()),
              };
              dirtyDraft = true;
              renderPanel();
            },
          },
          "Use selection as data",
        ),
      ),
      !invalid.length && derivedDraft.errors.length
        ? h(
            "p",
            { class: "sh-err", role: "alert" },
            `Cannot be drawn yet: ${derivedDraft.errors.join(" ")}`,
          )
        : null,
      h("h3", {}, "Options"),
      optionKeys(draft.type).map(optionControl),
      h("h3", {}, "Placement"),
      field(
        "Top-left cell",
        h("input", {
          "data-ck": "anchor",
          value: draft.anchor,
          onchange: (event) => {
            draft.anchor = event.target.value.trim().toUpperCase();
            dirtyDraft = true;
            renderPanel();
          },
        }),
      ),
      numberField("width", "Width", WIDTHS),
      numberField("height", "Height", HEIGHTS),
      invalid.length
        ? h("p", { class: "sh-err", role: "alert" }, invalid.join(" "))
        : null,
      h(
        "div",
        { class: "sh-prow" },
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t",
            "data-ck": "apply",
            disabled: busy() || invalid.length > 0 || !dirtyDraft || null,
            onclick: apply,
          },
          savedDraft ? "Update chart" : "Insert chart",
        ),
        savedDraft
          ? [
              h(
                "button",
                {
                  type: "button",
                  class: "sh-b sh-t sh-ghost",
                  "data-ck": "duplicate",
                  disabled: busy() || null,
                  onclick: () => duplicate(savedDraft.id),
                },
                "Duplicate chart",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "sh-b sh-t sh-ghost",
                  "data-ck": "delete",
                  disabled: busy() || null,
                  onclick: () => remove(savedDraft.id),
                },
                "Delete chart",
              ),
            ]
          : h(
              "button",
              {
                type: "button",
                class: "sh-b sh-t sh-ghost",
                "data-ck": "discard",
                onclick: () => {
                  openDraft(selectedId);
                  renderPanel();
                },
              },
              "Discard",
            ),
      ),
      h(
        "p",
        { class: "sh-hint" },
        "A chart reads its data range on every change. Its saved preview shows it without the chart library; the preview is redrawn when you edit the workbook or choose Redraw.",
      ),
    );
    panel.replaceChildren(...content.childNodes);
    if (focused) {
      const next = panel.querySelector(`[data-ck="${CSS.escape(focused)}"]`);
      if (next && typing !== undefined && next.matches("input"))
        next.value = typing;
      next?.focus();
    }
  }
  function apply() {
    if (!draft || busy()) return;
    // The saved preview stays: its revision tells whether it still matches.
    const { preview: _, ...next } = structuredClone(draft),
      kept = savedDraft?.preview ? { preview: savedDraft.preview } : {},
      charts = savedDraft
        ? chartsOf().map((c) => (c.id === next.id ? { ...next, ...kept } : c))
        : [...chartsOf(), next];
    try {
      commit(
        charts,
        savedDraft
          ? `Chart "${chartLabel(next)}" updated. Unsaved changes.`
          : `Chart "${chartLabel(next)}" inserted. Unsaved changes.`,
        next.id,
      );
    } catch (error) {
      status(`Chart not applied: ${error.message}`);
    }
  }
  const panelKey = () =>
    JSON.stringify([
      draft,
      savedDraft,
      dirtyDraft,
      busy(),
      getBook().sheets.map((s) => s.name),
    ]);
  // Follows undo, structural moves and deletions without discarding a draft
  // being edited.
  function drawPanel() {
    if (!panel?.isConnected) return;
    if (savedDraft) {
      const current = find(savedDraft.id);
      if (current !== savedDraft) {
        if (!current) openDraft(selectedId);
        else if (!dirtyDraft) openDraft(current.id);
        else {
          // A dirty draft takes committed changes (structural moves, undo)
          // of the fields, and of the options, it did not edit itself.
          const rebase = (target, before, after) => {
            for (const key of Object.keys({ ...before, ...after }))
              if (JSON.stringify(target[key]) === JSON.stringify(before[key]))
                if (after[key] === undefined) delete target[key];
                else target[key] = structuredClone(after[key]);
          };
          rebase(draft.options, savedDraft.options, current.options);
          const options = draft.options;
          rebase(draft, savedDraft, current);
          // Only options the draft's type accepts survive the merge.
          const keep = optionKeys(draft.type);
          draft.options = Object.fromEntries(
            Object.entries(options).filter(([key]) => keep.includes(key)),
          );
          savedDraft = current;
        }
      }
    }
    const key = panelKey();
    if (key === lastPanelKey) return;
    lastPanelKey = key;
    renderPanel();
  }

  return {
    draw,
    finalize,
    create,
    duplicate,
    remove,
    redraw,
    select,
    get selected() {
      return selectedId && find(selectedId) ? selectedId : null;
    },
    get library() {
      return library;
    },
    // Charts that could use the library: an out-of-date or missing preview.
    get canRedraw() {
      return library === null && chartsOf().length > 0;
    },
    body() {
      panel = h("div", { class: "ck" });
      if (!draft) openDraft(selectedId);
      lastPanelKey = "";
      queueMicrotask(drawPanel);
      return panel;
    },
    // For tests and diagnostics: how many ECharts instances exist.
    get liveCount() {
      return [...states.values()].filter((s) => s.instance).length;
    },
  };
}
