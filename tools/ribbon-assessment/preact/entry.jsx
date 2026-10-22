// R05 spike: the pinned IronCalc toolbar, right-drawer panels and link dialog.
// The same file builds against React or preact/compat (module aliases only).
// Commands our model already supports go through the existing canonical
// handlers; ADR-010 features without a model yet are recorded as intents.
import "spike-i18n-init";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Toolbar from "pinned-toolbar";
import RightDrawer from "pinned-drawer";
import { LinkDialog } from "pinned-link-dialog";
import "pinned-theme";
import data from "spike-static-data";
import { hexWithTintToRgb } from "@ironcalc/wasm";
import { fromNumberFormat, toNumberFormat } from "../functional/formats.mjs";

const LONG_DATE = "dddd, mmmm d, yyyy";
const SLOTS = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "fol_hlink",
];
// ADR-010 default mapping from charte tokens to Excel theme slots.
function charteTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) =>
    (css.getPropertyValue("--" + name).trim() || fallback).toUpperCase();
  return {
    name: "Document charte",
    dk1: token("ink", "#0B1C2C"),
    lt1: token("bg", "#FFFFFF"),
    dk2: token("acc", "#14517A"),
    lt2: token("tint", "#ECEFF2"),
    accent1: token("acc", "#14517A"),
    accent2: token("alert", "#C2521C"),
    accent3: token("mid", "#4F7FA3"),
    accent4: token("lig", "#AFC5D4"),
    accent5: token("t2", "#5A6670"),
    accent6: token("bd", "#D7DDE3"),
    hlink: token("acc", "#14517A"),
    fol_hlink: token("mid", "#4F7FA3"),
  };
}

globalThis.mountSpikeToolbar = (toolbarNode, drawerNode, bridge) => {
  const intents = (globalThis.toolbarSpikeIntents = []);
  const styles = new Map();
  const builtinStyles = data.builtinStyles.map(({ name, style }) => ({
    name,
    style,
  }));
  const includes = new Map(
    data.builtinStyles.map(({ name, includes }) => [name, includes]),
  );
  const ui = {
    themes: [charteTheme(), ...data.themes],
    theme: null,
    drawer: null,
    drawerWidth: 360,
    link: false,
    custom: [],
    gridLines: true,
    regional: { locale: "en", timezone: "UTC", language: "en" },
  };
  ui.theme = ui.themes[0];
  const status = document.getElementById("toolbar-status");
  const record = (kind, payload) => {
    const { sheetId, address } = bridge.state();
    intents.push({ kind, payload, sheetId, address });
    status.textContent = `Recorded intent: ${kind}`;
  };
  const resolveColor = (color) =>
    typeof color === "string"
      ? color
      : Array.isArray(color)
        ? hexWithTintToRgb(ui.theme[SLOTS[color[0]]] ?? ui.theme.dk1, color[1])
        : "";
  const model = {
    resolveColor,
    getNamedStyleIncludes: (name) =>
      includes.get(name) ??
      ui.custom.find((s) => s.name === name)?.includes ?? {
        number_format: true,
        font: true,
        fill: true,
        border: true,
        alignment: true,
        protection: false,
      },
  };
  const current = () => {
    const state = bridge.state();
    return {
      state,
      style: styles.get(state.sheetId + "!" + state.address) ?? {},
    };
  };
  // Records a direct-formatting intent and reflects it in the toolbar state.
  const setStyle = (kind, patch) => {
    const { state, style } = current();
    styles.set(state.sheetId + "!" + state.address, { ...style, ...patch });
    record(kind, patch);
    draw();
  };
  const formatOptions = (state) => ({
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
    long_date: LONG_DATE,
    long_date_example: "Wednesday, October 21, 2026",
  });
  const saveError = { nameError: "" };
  const toolbarRoot = createRoot(toolbarNode),
    drawerRoot = createRoot(drawerNode);
  function draw() {
    const { state, style } = current();
    const open = (drawer) => {
      ui.drawer = drawer;
      draw();
    };
    const toolbar = (
      <Toolbar
        canEdit={state.canEdit}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        onUndo={() => bridge.command("undo")}
        onRedo={() => bridge.command("redo")}
        onNumberFormatPicked={(text) => {
          if (text === LONG_DATE) return record("format.longDate", { text });
          try {
            bridge.format(fromNumberFormat(text));
          } catch (error) {
            status.textContent = error.message;
          }
        }}
        onClearFormatting={() => {
          styles.delete(state.sheetId + "!" + state.address);
          bridge.clear();
        }}
        numFmt={style.longDate ? LONG_DATE : toNumberFormat(state.format)}
        formatOptions={formatOptions(state)}
        fontSize={style.fontSize ?? 12}
        bold={style.bold ?? false}
        italic={style.italic ?? false}
        underline={style.underline ?? false}
        strike={style.strike ?? false}
        fillColor={style.background ?? "#FFFFFF"}
        fontColor={style.color ?? "#272525"}
        horizontalAlign={style.horizontal ?? "general"}
        verticalAlign={style.vertical ?? "bottom"}
        wrapText={style.wrap ?? false}
        mergeCellsState={{
          canMerge: false,
          canMergeAcross: false,
          canMergeDown: false,
          canUnmerge: false,
        }}
        onMergeCells={() => {
          throw new Error("Merged cells are excluded from V1");
        }}
        onToggleBold={(bold) => setStyle("style.bold", { bold })}
        onToggleItalic={(italic) => setStyle("style.italic", { italic })}
        onToggleUnderline={(underline) =>
          setStyle("style.underline", { underline })
        }
        onToggleStrike={(strike) => setStyle("style.strike", { strike })}
        onToggleHorizontalAlign={(horizontal) =>
          setStyle("style.align.horizontal", { horizontal })
        }
        onToggleVerticalAlign={(vertical) =>
          setStyle("style.align.vertical", { vertical })
        }
        onToggleWrapText={(wrap) => setStyle("style.align.wrap", { wrap })}
        onIncreaseFontSize={(delta) =>
          setStyle("style.fontSize", {
            fontSize: Math.min(
              409,
              Math.max(1, (style.fontSize ?? 12) + delta),
            ),
          })
        }
        onSetFontSize={(fontSize) => setStyle("style.fontSize", { fontSize })}
        onTextColorPicked={(color) => setStyle("style.color", { color })}
        onFillColorPicked={(background) =>
          setStyle("style.background", { background })
        }
        onBorderChanged={(border) => record("style.border", border)}
        onCopyStyles={() => record("painter.start", {})}
        onDownloadPNG={() => record("export.png", {})}
        onOpenConditionalFormatting={() => bridge.command("manage-conditional")}
        isConditionalFormattingOpen={false}
        onOpenNamedStyles={() => open("namedStyles")}
        isNamedStylesOpen={ui.drawer === "namedStyles"}
        onOpenLinkDialog={() => {
          ui.link = true;
          draw();
        }}
        themes={ui.themes}
        currentTheme={ui.theme}
        onThemePicked={(theme) => {
          ui.theme = theme;
          record("theme.pick", { name: theme.name });
          draw();
        }}
        onOpenThemes={() => open("themes")}
        showGridLines={ui.gridLines}
        onToggleShowGridLines={(show) => {
          ui.gridLines = show;
          document
            .getElementById("grid")
            .classList.toggle("assessment-no-grid", !show);
          draw();
        }}
      />
    );
    const drawer = (
      <>
        <RightDrawer
          isOpen={ui.drawer !== null}
          onClose={() => {
            ui.drawer = null;
            draw();
          }}
          width={ui.drawerWidth}
          onWidthChange={(width) => (ui.drawerWidth = width)}
          model={model}
          onUpdate={draw}
          getSelectedArea={() => state.address}
          drawerType={ui.drawer ?? "namedStyles"}
          themes={ui.themes}
          currentTheme={ui.theme}
          onThemePicked={(theme) => {
            ui.theme = theme;
            record("theme.pick", { name: theme.name });
            draw();
          }}
          customStyles={ui.custom}
          builtinStyles={builtinStyles}
          formatOptions={formatOptions(state)}
          onApplyNamedStyle={(name) => record("cellStyle.apply", { name })}
          onAddNamedStyle={(payload) => {
            ui.custom = [...ui.custom, payload];
            record("cellStyle.add", { name: payload.name });
            draw();
            return saveError;
          }}
          onUpdateNamedStyle={(name, payload) => {
            ui.custom = ui.custom.map((s) => (s.name === name ? payload : s));
            record("cellStyle.update", { name, to: payload.name });
            draw();
            return saveError;
          }}
          onDeleteNamedStyle={(name) => {
            ui.custom = ui.custom.filter((s) => s.name !== name);
            record("cellStyle.delete", { name });
            draw();
          }}
          initialLocale={ui.regional.locale}
          initialTimezone={ui.regional.timezone}
          initialLanguage={ui.regional.language}
          onSettingsSave={(locale, timezone, language) => {
            ui.regional = { locale, timezone, language };
            record("regional.save", { locale, timezone });
          }}
        />
        {ui.link && (
          <LinkDialog
            open
            onClose={() => {
              ui.link = false;
              draw();
            }}
            sheetNames={state.sheetNames}
            selectedSheetName={state.sheetName}
            initialLink={style.link ?? null}
            initialLabel={state.displayText}
            onSave={(link, label) => {
              ui.link = false;
              setStyle("link.set", { link, label });
            }}
            onDelete={() => {
              ui.link = false;
              setStyle("link.delete", { link: null });
            }}
          />
        )}
      </>
    );
    flushSync(() => {
      toolbarRoot.render(toolbar);
      drawerRoot.render(drawer);
    });
  }
  globalThis.openSpikeDrawer = (drawer) => {
    ui.drawer = drawer;
    draw();
  };
  document.addEventListener("assessment-state", draw);
  draw();
};
