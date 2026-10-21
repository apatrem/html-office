// Engine-free stand-ins for the @ironcalc/wasm runtime values the toolbar and
// panels use. Enums come from the pinned type definitions; data is static.
import data from "spike-static-data";
export * from "pinned-wasm-types";
export {
  hexWithTintToRgb,
  columnNameFromNumber,
  quoteName,
} from "../../functional/ui-helpers.mjs";
export const getSupportedLocales = () => data.locales;
export const getThemeList = () => data.themes;
// IANA names from the browser; the engine's chrono-tz list is the reference.
export const getAllTimezones = () => {
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
};
