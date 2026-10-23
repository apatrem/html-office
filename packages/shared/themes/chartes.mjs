// Built-in chartes (TH01, ADR-011 §10, ADR-012 §9). A document's own
// style#charte is never rewritten: a built-in charte is an overlay selected
// by the document's theme field and applied as :root[data-theme=…] tokens.
// Blue is the html-slides default charte (plugin assets/default.css).
const roles = (t) => ({
  ...t,
  "header-bg": t.ink,
  "header-ink": t.bg,
  "row-label-bg": `color-mix(in srgb,${t.lig} 35%,${t.bg})`,
  "row-label-ink": t.acc,
  "assumption-ink": t.alert,
  "calculation-bg": t.tint,
});
export const CHARTES = {
  blue: roles({
    ink: "#0B1C2C",
    acc: "#14517A",
    mid: "#4F7FA3",
    lig: "#AFC5D4",
    alert: "#C2521C",
    tint: "#ECEFF2",
    callout: "#E9EEF2",
    bd: "#D7DDE3",
    t2: "#5A6670",
    bg: "#FFFFFF",
    "assumption-bg": "#FFF6D8",
  }),
  red: roles({
    ink: "#2A1215",
    acc: "#9E1B32",
    mid: "#A3485A",
    lig: "#E8B9C1",
    alert: "#B45309",
    tint: "#F6EDEE",
    callout: "#F4E9EB",
    bd: "#E3D3D6",
    t2: "#6B5A5D",
    bg: "#FFFFFF",
    "assumption-bg": "#FFF6D8",
  }),
  green: roles({
    ink: "#10241A",
    acc: "#1E6B47",
    mid: "#3B7A5A",
    lig: "#B9D9C6",
    alert: "#B04A18",
    tint: "#EDF2EF",
    callout: "#E8F0EB",
    bd: "#D3DFD8",
    t2: "#56665D",
    bg: "#FFFFFF",
    "assumption-bg": "#FFF6D8",
  }),
  // Greyscale with one alert colour for negatives.
  black: roles({
    ink: "#111111",
    acc: "#2B2B2B",
    mid: "#595959",
    lig: "#C4C4C4",
    alert: "#C62828",
    tint: "#F0F0F0",
    callout: "#EDEDED",
    bd: "#DADADA",
    t2: "#5E5E5E",
    bg: "#FFFFFF",
    "assumption-bg": "#F2F2F2",
  }),
};
export const THEME_NAMES = {
  blue: "Blue",
  red: "Red",
  green: "Green",
  black: "Black",
};
// Overlay rules: each built-in charte replaces the colour tokens only; the
// document's fonts and sizes stay.
export function charteCSS() {
  return Object.entries(CHARTES)
    .map(
      ([name, tokens]) =>
        `:root[data-theme="${name}"]{${Object.entries(tokens)
          .map(([token, value]) => `--${token}:${value}`)
          .join(";")}}`,
    )
    .join("\n");
}
// WCAG 2 contrast ratio between two #RRGGBB colours.
export function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
