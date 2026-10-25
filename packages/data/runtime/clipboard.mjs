// Copy writes the html-office envelope (with the Data range), a semantic
// text/html table and text/plain; paste reads them in ADR-013's order.
import {
  presentation,
  adaptReferences,
  pastedLinks,
  cellClasses,
  effectiveStyle,
  colorCSS,
} from "../model/formatting.mjs";
import { address, parseAddress, parseRange } from "../model/workbook.mjs";
import {
  copyRange,
  rangePatches,
  fillRange,
  parsePaste,
  plainValue,
  rangeTable,
  tableCells,
  validateRange,
  validateTableFormats,
  LIMIT,
} from "../model/clipboard.mjs";
import { jsonStringify } from "../model/json.mjs";
import { DOCUMENT_VERSION } from "../model/document.mjs";
import {
  SCHEMA,
  LIMITS,
  readClipboard,
  writeClipboard,
  toTSV,
  tableText,
  validateTable,
} from "../../shared/clipboard/index.mjs";
import { display, negativeRed } from "./view.mjs";
import { paint, generalAlign, LINE } from "./grid.mjs";
const columnName = (col) => address(1, col).replace(/\d+$/, "");
// Literal CSS for other applications, read from probes styled like the grid's
// cells (catalogue classes and direct formatting), one per distinct look.
function literalStyles(sheet, top, left) {
  const host = document.createElement("div"),
    looks = new Map();
  host.className = "picture-probe";
  host.setAttribute("aria-hidden", "true");
  document.getElementById("grid").append(host);
  function css(slot, r, c) {
    const row = top + r,
      col = left + c,
      ref = address(row, col),
      cell = sheet.cells[ref] ?? {},
      style = effectiveStyle(
        cell.cellStyle,
        sheet.columns?.[columnName(col)]?.style,
        sheet.rows?.[row]?.style,
        cell.style,
      ),
      classes = cellClasses(cell, !!sheet.links?.[ref]),
      horizontal = style?.align?.horizontal,
      align =
        horizontal && horizontal !== "general"
          ? horizontal === "centerContinuous"
            ? "center"
            : horizontal
          : generalAlign(cell),
      key = `${classes}|${JSON.stringify(style)}|${negativeRed(cell)}|${align}`;
    if (!looks.has(key)) {
      const probe = document.createElement("div");
      probe.className = `grid-cell ${classes}`;
      paint(probe, style, cell);
      for (const [side, line] of Object.entries(style?.border ?? {}))
        if (line.style !== "none") {
          const [width, kind] = LINE[line.style];
          probe.style.setProperty(
            `border-${side}`,
            `${width}px ${kind} ${colorCSS(line.color ?? "ink")}`,
          );
        } else probe.style.setProperty(`border-${side}`, "none");
      host.append(probe);
      const read = getComputedStyle(probe),
        visible = (v) =>
          v && v !== "transparent" && !/rgba\(.*,\s*0\)$/.test(v);
      let out = `color:${read.color};font-weight:${read.fontWeight};font-style:${read.fontStyle};text-align:${align};`;
      if (visible(read.backgroundColor))
        out += `background-color:${read.backgroundColor};`;
      for (const side of Object.keys(style?.border ?? {})) {
        const s = side[0].toUpperCase() + side.slice(1);
        out +=
          read[`border${s}Style`] === "none"
            ? ""
            : `border-${side}:${read[`border${s}Width`]} ${read[`border${s}Style`]} ${read[`border${s}Color`]};`;
      }
      looks.set(key, out);
      probe.remove();
    }
    return looks.get(key);
  }
  return { css, done: () => host.remove() };
}
// Data never publishes a table its own reader would refuse: such a table is
// left out, and other products read text/plain (the range still travels).
function portable(table) {
  try {
    return validateTable(table);
  } catch {
    return undefined;
  }
}
export function setupClipboard({
  getBook,
  getSheet,
  getSelection,
  busy,
  apply,
  status,
  cancel,
  isStale,
}) {
  const $ = (id) => document.getElementById(id),
    dialog = $("paste-dialog");
  let parsed;
  const selection = () => {
    const r = getSelection();
    return `${address(r.top, r.left)}:${address(r.bottom, r.right)}`;
  };
  function target(cells) {
    const r = getSelection(),
      sheet = getSheet(),
      anchor = address(r.top, r.left),
      p = parseAddress(anchor);
    return {
      sheetId: sheet.id,
      anchor,
      focus: address(p.row + cells.length - 1, p.column + cells[0].length - 1),
    };
  }
  async function commit(edits, selectionAfter) {
    if (busy()) {
      status("Finish or cancel the current calculation first.");
      return false;
    }
    return apply({
      edits: edits.map((edit) => ({ ...edit, range: true })),
      selectionAfter,
    });
  }
  $("grid").addEventListener("copy", (event) => {
    if (busy()) return;
    const sheet = getSheet(),
      book = getBook(),
      ref = selection(),
      r = parseRange(ref);
    let looks;
    try {
      const range = copyRange(sheet, ref),
        cells = range.cells.length * range.cells[0].length,
        locale = book.locale ?? "en-US",
        // Other html-office products read the portable table; above the
        // text/html limit only Data's own range travels.
        table =
          cells <= LIMITS.htmlCells
            ? portable(
                rangeTable(sheet, ref, {
                  text: (cell) => display(cell, locale),
                  red: negativeRed,
                }),
              )
            : undefined,
        formulas = range.cells.some((row) => row.some((c) => c?.formula));
      looks = table && literalStyles(sheet, r.top, r.left);
      const written = writeClipboard(event.clipboardData, {
        envelope: {
          schema: SCHEMA,
          kind: "table",
          source: {
            product: "data",
            format: DOCUMENT_VERSION,
            locale,
            stale: isStale(formulas),
          },
          ...(table ? { table } : {}),
          range,
        },
        table,
        text: toTSV(range.cells.map((row) => row.map(plainValue))),
        stringify: (value) => jsonStringify(value, { pretty: false }),
        html: { locale, css: looks?.css },
      });
      event.preventDefault();
      status(
        written.html
          ? "Range copied. Paste in a Data grid to retain formulas and formats; other applications receive a formatted table."
          : "Range copied. Paste in a Data grid to retain formulas and formats; other applications receive saved values.",
      );
    } catch (error) {
      event.preventDefault();
      status(`Copy failed: ${error.message}`);
    } finally {
      looks?.done();
    }
  });
  // A pasted HTML table whose text is still unedited in the dialog keeps
  // its header rows, emphasis and links (pasteSource.table).
  let pasteSource = null,
    pasted = null;
  const fromTable = () =>
    pasteSource &&
    $("paste-text").value === pasteSource.text &&
    ["auto", "tsv"].includes($("paste-syntax").value);
  function preview() {
    try {
      if (!$("paste-text").value) throw new Error("Paste table text first.");
      pasted = null;
      if (fromTable()) {
        pasted = tableCells(pasteSource.table, {
          typing: $("paste-typing").value,
        });
        pasted.counts.links += pasteSource.dropped?.links ?? 0;
        if (pasted.ambiguous) throw new Error(pasted.ambiguous);
        parsed = pasted.cells;
      } else
        parsed = parsePaste($("paste-text").value, {
          syntax: $("paste-syntax").value,
          typing: $("paste-typing").value,
        });
      const destination = target(parsed);
      rangePatches(destination.sheetId, destination.anchor, parsed);
      $("paste-preview").textContent =
        `${parsed.length} rows × ${parsed[0].length} columns → ${destination.anchor}:${destination.focus}\n` +
        parsed
          .slice(0, 5)
          .map((row) =>
            row
              .slice(0, 8)
              .map((c) => `${c.input.type}: ${c.input.value ?? ""}`)
              .join(" | "),
          )
          .join("\n");
      $("paste-apply").disabled = false;
    } catch (error) {
      parsed = pasted = null;
      $("paste-apply").disabled = true;
      $("paste-preview").textContent = error.message;
    }
  }
  function open(text = "", source = null) {
    if (busy()) {
      status("Finish or cancel the current calculation first.");
      return;
    }
    pasteSource = source;
    $("paste-text").value = text;
    $("paste-typing").value = source?.typing ?? "auto";
    $("paste-syntax").value = "auto";
    preview();
    dialog.showModal();
    $("paste-text").focus();
  }
  for (const id of ["paste-text", "paste-typing", "paste-syntax"])
    $(id).addEventListener(id === "paste-text" ? "input" : "change", preview);
  $("paste-apply").onclick = async () => {
    preview();
    if (!parsed || busy()) return;
    const destination = target(parsed),
      sheet = getSheet(),
      rich = pasted;
    let edits;
    try {
      edits = rich
        ? tableEdits(rich, destination)
        : rangePatches(sheet.id, destination.anchor, parsed).map((edit) => {
            const old = sheet.cells[edit.ref] ?? {};
            return {
              ...edit,
              cell: {
                ...presentation(old),
                ...edit.cell,
              },
            };
          });
    } catch (error) {
      $("paste-preview").textContent = error.message;
      return;
    }
    for (const id of [
      "paste-text",
      "paste-typing",
      "paste-syntax",
      "paste-apply",
    ])
      $(id).disabled = true;
    try {
      if (await commit(edits, destination)) {
        dialog.close();
        $("grid").focus();
        if (rich) report(rich, pasteSource.notices);
      }
    } finally {
      for (const id of ["paste-text", "paste-typing", "paste-syntax"])
        $(id).disabled = false;
      preview();
    }
  };
  $("paste-cancel").onclick = () => {
    if (busy()) cancel();
    dialog.close();
  };
  dialog.addEventListener("cancel", () => {
    if (busy()) cancel();
  });
  // Notes on what a table paste could not carry over, after the commit.
  function report({ counts }, notices = []) {
    const notes = [...notices],
      plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (counts.merged)
      notes.push(
        `${plural(counts.merged, "merged cell was", "merged cells were")} unmerged (Data has no merged cells).`,
      );
    if (counts.flattened)
      notes.push(
        `${plural(counts.flattened, "cell's", "cells'")} mixed formatting became plain text.`,
      );
    if (counts.links)
      notes.push(
        `${plural(counts.links, "link was", "links were")} not carried over.`,
      );
    if (notes.length) status(`Pasted. ${notes.join(" ")}`);
  }
  function tableEdits(result, destination) {
    const sheet = getSheet(),
      edits = rangePatches(sheet.id, destination.anchor, result.cells),
      anchor = parseAddress(destination.anchor),
      linked = pastedLinks(getBook(), sheet.id, edits, result.links, anchor);
    return edits.map((edit) => ({
      ...edit,
      link: linked.links.get(edit.ref),
      preserveFormat: false,
    }));
  }
  function pasteRange(data, notices) {
    validateRange(data);
    const destination = target(data.cells),
      edits = rangePatches(
        destination.sheetId,
        destination.anchor,
        data.cells,
        { origin: data.origin },
      );
    // A range copied from another workbook may name its custom cell styles
    // or sheets; those references are dropped rather than published.
    const anchor = parseAddress(destination.anchor),
      linked = pastedLinks(
        getBook(),
        destination.sheetId,
        edits,
        data.links,
        anchor,
      );
    let dropped = linked.dropped;
    const adapted = edits.map((edit) => {
      const result = adaptReferences(getBook(), edit.cell);
      dropped += result.dropped;
      return {
        ...edit,
        cell: result.cell,
        link: linked.links.get(edit.ref),
        preserveFormat: false,
      };
    });
    void commit(adapted, destination).then((done) => {
      const notes = [...notices];
      if (dropped)
        notes.push(
          `${dropped} cell style or internal link reference${dropped === 1 ? "" : "s"} unknown in this workbook ${dropped === 1 ? "was" : "were"} not carried over.`,
        );
      if (done && notes.length) status(`Pasted. ${notes.join(" ")}`);
    });
  }
  // Tables from other applications (and html-office tables without a Data
  // range): values-first typing; any ambiguous cell opens the paste dialog.
  function pasteTable(table, notices, { locale, dropped } = {}) {
    const result = tableCells(table);
    result.counts.links += dropped?.links ?? 0;
    if (result.ambiguous) {
      open(tableText(table), {
        text: tableText(table),
        table,
        notices,
        dropped,
        typing: ["en-US", "fr-FR"].includes(locale) ? locale : undefined,
      });
      return;
    }
    const destination = target(result.cells);
    void commit(tableEdits(result, destination), destination).then(
      (done) => done && report(result, notices),
    );
  }
  $("grid").addEventListener("paste", (event) => {
    event.preventDefault();
    if (busy()) {
      status("Finish or cancel the current calculation first.");
      return;
    }
    try {
      const read = readClipboard(event.clipboardData, { maxCells: LIMIT }),
        { notices } = read;
      if (read.source === "envelope") {
        const { envelope } = read;
        if (envelope.kind === "chart")
          throw new Error("Charts cannot be pasted into Data yet");
        if (envelope.table) validateTableFormats(envelope.table);
        if (envelope.range) pasteRange(envelope.range, notices);
        else pasteTable(envelope.table, notices, envelope.source);
      } else if (read.source === "legacy") pasteRange(read.range, notices);
      else if (read.source === "table")
        pasteTable(read.table, notices, { dropped: read.dropped });
      else if (read.source === "text") open(read.text);
      else
        status(
          "Paste failed: this clipboard format has no plain-text table. Workbook unchanged.",
        );
    } catch (error) {
      status(
        `Paste failed: ${error.message.replace(/\.$/, "")}. Workbook unchanged.`,
      );
    }
  });
  function fill(direction) {
    if (busy()) return;
    try {
      const r = getSelection(),
        edits = fillRange(getSheet(), selection(), direction);
      void commit(
        edits.map((edit) => ({ ...edit, preserveFormat: false })),
        {
          sheetId: getSheet().id,
          anchor: address(r.top, r.left),
          focus: address(r.bottom, r.right),
        },
      );
    } catch (error) {
      status(`Fill failed: ${error.message}. Workbook unchanged.`);
    }
  }
  return { open: () => open(), fill };
}
