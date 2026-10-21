import { presentation, adaptReferences } from "../model/formatting.mjs";
import { address, parseAddress } from "../model/workbook.mjs";
import {
  copyRange,
  rangePatches,
  fillRange,
  parsePaste,
} from "../model/clipboard.mjs";
import { jsonStringify } from "../model/json.mjs";
const MIME = "application/x-html-office-range+json";
const quote = (value) =>
  /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
function plain(cells) {
  return cells
    .map((row) =>
      row
        .map((cell) => {
          const v = cell?.formula ? cell.result : cell?.input;
          return quote(!v || v.type === "blank" ? "" : String(v.value));
        })
        .join("\t"),
    )
    .join("\n");
}
export function setupClipboard({
  getBook,
  getSheet,
  getSelection,
  busy,
  apply,
  status,
  cancel,
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
    try {
      const data = copyRange(getSheet(), selection());
      event.clipboardData.setData(MIME, jsonStringify(data, { pretty: false }));
      event.clipboardData.setData("text/plain", plain(data.cells));
      event.preventDefault();
      status(
        "Range copied. Paste in a Data grid to retain formulas and formats; other applications receive saved values.",
      );
    } catch (error) {
      event.preventDefault();
      status(`Copy failed: ${error.message}`);
    }
  });
  function preview() {
    try {
      if (!$("paste-text").value) throw new Error("Paste table text first.");
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
      parsed = null;
      $("paste-apply").disabled = true;
      $("paste-preview").textContent = error.message;
    }
  }
  function open(text = "") {
    if (busy()) {
      status("Finish or cancel the current calculation first.");
      return;
    }
    $("paste-text").value = text;
    $("paste-typing").value = "auto";
    $("paste-syntax").value = "auto";
    preview();
    dialog.showModal();
    $("paste-text").focus();
  }
  $("paste-table").onclick = () => open();
  for (const id of ["paste-text", "paste-typing", "paste-syntax"])
    $(id).addEventListener(id === "paste-text" ? "input" : "change", preview);
  $("paste-apply").onclick = async () => {
    preview();
    if (!parsed || busy()) return;
    const destination = target(parsed),
      sheet = getSheet();
    const edits = rangePatches(sheet.id, destination.anchor, parsed).map(
      (edit) => {
        const old = sheet.cells[edit.ref] ?? {};
        return {
          ...edit,
          cell: {
            ...presentation(old),
            ...edit.cell,
          },
        };
      },
    );
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
  $("grid").addEventListener("paste", (event) => {
    event.preventDefault();
    if (busy()) {
      status("Finish or cancel the current calculation first.");
      return;
    }
    const encoded = event.clipboardData.getData(MIME);
    if (!encoded) {
      if (!Array.from(event.clipboardData.types).includes("text/plain")) {
        status(
          "Paste failed: this clipboard format has no plain-text table. Workbook unchanged.",
        );
        return;
      }
      open(event.clipboardData.getData("text/plain"));
      return;
    }
    try {
      const data = JSON.parse(encoded);
      if (data.schema !== "html-office-range/1" || !data.origin)
        throw new Error("Unsupported range clipboard format");
      const destination = target(data.cells),
        edits = rangePatches(
          destination.sheetId,
          destination.anchor,
          data.cells,
          { origin: data.origin },
        );
      // A range copied from another workbook may name its custom cell styles
      // or sheets; those references are dropped rather than published.
      let dropped = 0;
      const adapted = edits.map((edit) => {
        const result = adaptReferences(getBook(), edit.cell);
        dropped += result.dropped;
        return { ...edit, cell: result.cell, preserveFormat: false };
      });
      void commit(adapted, destination).then((done) => {
        if (done && dropped)
          status(
            `Pasted. ${dropped} cell style or internal link reference${dropped === 1 ? "" : "s"} unknown in this workbook ${dropped === 1 ? "was" : "were"} not carried over.`,
          );
      });
    } catch (error) {
      status(`Paste failed: ${error.message}. Workbook unchanged.`);
    }
  });
  for (const direction of ["down", "right"])
    $("fill-" + direction).onclick = () => {
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
    };
}
