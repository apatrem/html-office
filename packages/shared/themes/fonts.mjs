// Per-document font list (ADR-011 §10): fonts present on both Windows and
// macOS. Data applies the chosen font to the whole grid; Slides and Text to
// the body only, as :root[data-font=…] overlays (titles keep the charte's).
export const FONTS = [
  ["arial", "Arial", "Arial, Helvetica, sans-serif"],
  ["verdana", "Verdana", "Verdana, Geneva, sans-serif"],
  ["tahoma", "Tahoma", "Tahoma, Verdana, sans-serif"],
  ["trebuchet", "Trebuchet MS", '"Trebuchet MS", Helvetica, sans-serif'],
  ["georgia", "Georgia", 'Georgia, "Times New Roman", serif'],
  ["times", "Times New Roman", '"Times New Roman", Times, serif'],
];
