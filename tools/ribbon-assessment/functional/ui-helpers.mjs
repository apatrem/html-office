// Port of pinned IronCalc base/src/colors.rs (MIT; full notice in the samples).
// These presentation helpers do not evaluate workbook formulas or load WASM.
export function hexWithTintToRgb(hex, tint) {
  if (
    !/^#[0-9a-f]{6}$/i.test(hex) ||
    !Number.isFinite(tint) ||
    Math.abs(tint) > 1
  )
    throw new Error("Invalid color/tint");
  if (tint === 0) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    chroma = (max - min) / 255;
  let h = 0,
    s = 0,
    l = Math.round(((max + min) / 510) * 100);
  if (chroma) {
    h = Math.round(
      max === r
        ? g >= b
          ? (60 * (g - b)) / 255 / chroma
          : ((g - b) / 255 / chroma + 6) * 60
        : max === g
          ? ((b - r) / 255 / chroma + 2) * 60
          : ((r - g) / 255 / chroma + 4) * 60,
    );
    const luminosity = (max + min) / 510;
    s = Math.round(
      (luminosity > 0.5
        ? (0.5 * chroma) / (1 - luminosity)
        : (0.5 * chroma) / luminosity) * 100,
    );
  }
  l = Math.round(tint < 0 ? l * (1 + tint) : l + (100 - l) * tint) / 100;
  h /= 360;
  s /= 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  function hue(t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 0.5
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p;
  }
  return (
    "#" +
    [h + 1 / 3, h, h - 1 / 3]
      .map((t) =>
        Math.round(255 * (s === 0 ? l : hue(t)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}
export function columnNameFromNumber(n) {
  if (!Number.isInteger(n) || n < 1 || n > 16384)
    throw new Error("Column outside Excel bounds");
  let s = "";
  while (n) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
// Always-quoted names are valid references, including embedded apostrophes.
// This helper is eliminated by tree shaking in the supported toolbar path.
export const quoteName = (name) =>
  "'" + String(name).replaceAll("'", "''") + "'";
