// Prepares JavaScript for embedding in an HTML <script> element without changing its values.
// "</script" would close the element early, and a literal comment opener followed later by the
// serializer's "<script" strings would put the HTML parser into its double-escaped script state.
export function inlineScript(source, name) {
  const text = source.replace(/<\/script/gi, '<\\/script')
    .replace(/(["'])<!--\1/g, (_match, quote) => `${quote}\\x3c!--${quote}`);
  if (text.includes('<!--')) throw new Error(`${name}: a raw "<!--" cannot be embedded in an inline script; write it as "\\x3c!--"`);
  return text;
}
