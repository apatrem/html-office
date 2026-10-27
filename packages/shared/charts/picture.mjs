// The picture other applications receive for a chart (ADR-013 §4): the title and unit drawn above
// the plot as the reader sees them (the saved preview holds the plot only), in the charte's font
// and colours, as PNG at 2× (1× when a side would pass 4,096 px, smaller still if needed).
const MAX_SIDE = 4096;
const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// `svg` is a preview (previewOf or svg.render, with a viewBox); resolves to { blob, url } where
// url is a data: URL of the same PNG.
export async function chartPicture(svg, { title, unit, theme }) {
  const [, , w, h] = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0)) throw new Error('the chart has no preview');
  const font = escape(theme.font), titleH = title ? 32 : 0, unitH = unit ? 26 : 0, head = titleH + unitH + (title || unit ? 6 : 0);
  const W = Math.ceil(w), H = Math.ceil(h + head);
  const plot = svg.cloneNode(true);
  plot.removeAttribute('class');
  for (const [k, v] of [['x', 0], ['y', head], ['width', w], ['height', h]]) plot.setAttribute(k, v);
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${escape(theme.w)}"/>` +
    (title ? `<text x="0" y="20" font-family="${font}" font-size="16" font-weight="700" fill="${escape(theme.ink)}">${escape(title)}</text>` +
      `<line x1="0" x2="${W}" y1="28.5" y2="28.5" stroke="${escape(theme.bd)}"/>` : '') +
    (unit ? `<text x="0" y="${titleH + 17}" font-family="${font}" font-size="13" fill="${escape(theme.t2)}">${escape(unit)}</text>` : '') +
    new XMLSerializer().serializeToString(plot) + '</svg>';
  const scale = Math.min(Math.max(W, H) * 2 <= MAX_SIDE ? 2 : 1, MAX_SIDE / Math.max(W, H));
  const source = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('the browser could not draw the picture'))), 'image/png'));
    const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
    return { blob, url };
  } finally {
    URL.revokeObjectURL(source);
  }
}
