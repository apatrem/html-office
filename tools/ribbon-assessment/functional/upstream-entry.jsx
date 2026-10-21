import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import Toolbar from "pinned-toolbar";
import english from "pinned-english";
import "pinned-theme";
import { fromNumberFormat, toNumberFormat } from "./formats.mjs";

const theme = {
  name: "Office",
  lt1: "#FFFFFF",
  dk1: "#000000",
  lt2: "#E7E6E6",
  dk2: "#44546A",
  accent1: "#4472C4",
  accent2: "#ED7D31",
  accent3: "#A5A5A5",
  accent4: "#FFC000",
  accent5: "#5B9BD5",
  accent6: "#70AD47",
  hlink: "#0563C1",
  folHlink: "#954F72",
};
globalThis.mountAssessmentToolbar = async (node, bridge) => {
  await i18n.init({
    lng: "en-US",
    resources: { "en-US": { translation: english } },
    initImmediate: false,
  });
  const root = createRoot(node);
  const unsupported = () => {
    throw new Error("Unsupported toolbar action must remain disabled");
  };
  let gridLines = true;
  function draw() {
    const state = bridge.state();
    const props = {
      ...state,
      onUndo: () => bridge.command("undo"),
      onRedo: () => bridge.command("redo"),
      onNumberFormatPicked: (text) => {
        try {
          bridge.format(fromNumberFormat(text));
        } catch (error) {
          document.getElementById("toolbar-status").textContent = error.message;
        }
      },
      onClearFormatting: () => bridge.clear(),
      numFmt: toNumberFormat(state.format),
      formatOptions: {
        currency: state.format.currency ?? "EUR",
        currency_format: toNumberFormat({
          kind: "currency",
          currency: state.format.currency ?? "EUR",
          digits: 2,
        }),
        number_fmt: "#,##0.00",
        number_example: "1,234.50",
        short_date: "yyyy-mm-dd",
        short_date_example: "2026-10-21",
        long_date: "dddd, mmmm d, yyyy",
        long_date_example: "Wednesday, October 21, 2026",
      },
      fontSize: 12,
      bold: state.role === "header",
      italic: false,
      underline: false,
      strike: false,
      fillColor: "#FFFFFF",
      fontColor: "#272525",
      horizontalAlign: "general",
      verticalAlign: "bottom",
      wrapText: false,
      mergeCellsState: {
        canMerge: false,
        canMergeAcross: false,
        canMergeDown: false,
        canUnmerge: false,
      },
      currentTheme: theme,
      themes: [theme],
      isNamedStylesOpen: false,
      isConditionalFormattingOpen: false,
      onOpenConditionalFormatting: () => bridge.command("manage-conditional"),
      showGridLines: gridLines,
      onToggleShowGridLines: (show) => {
        gridLines = show;
        document
          .getElementById("grid")
          .classList.toggle("assessment-no-grid", !show);
        draw();
      },
    };
    for (const name of [
      "ToggleUnderline",
      "ToggleBold",
      "ToggleItalic",
      "ToggleStrike",
      "ToggleHorizontalAlign",
      "ToggleVerticalAlign",
      "ToggleWrapText",
      "CopyStyles",
      "TextColorPicked",
      "FillColorPicked",
      "BorderChanged",
      "IncreaseFontSize",
      "SetFontSize",
      "DownloadPNG",
      "MergeCells",
      "OpenNamedStyles",
      "OpenLinkDialog",
      "ThemePicked",
      "OpenThemes",
    ])
      props["on" + name] = unsupported;
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <Toolbar {...props} />
        </I18nextProvider>,
      ),
    );
  }
  document.addEventListener("assessment-state", draw);
  draw();
};
