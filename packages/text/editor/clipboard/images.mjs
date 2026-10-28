// Pasted and dropped images (T12b), Node and browser: what the clipboard itself holds (image files,
// data: URLs in pasted HTML) and the limits checked before anything is decoded. An image by URL
// is never fetched. The runtime (runtime/clipboard.mjs) shrinks each one through T12's path and
// stores it in script#assets.

// At most 20 images per paste or drop; each at most 20 MB, 50 megapixels and 16,384 px a side
// (read from the file's header). SVG has no pixel size: it is kept as it is, as T12 keeps it.
export const PASTE_IMAGES = {
  count: 20,
  bytes: 20 * 2 ** 20,
  pixels: 50e6,
  side: 16384,
};
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

// A data: URL of an accepted image type: {type, base64, payload, bytes} (bytes as decoded,
// computed from the payload's length), or null for anything else.
export function dataImage(src) {
  const m =
    /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))((?:;[^,;]*)*?)(;base64)?,/i.exec(
      src.trim(),
    );
  if (!m) return null;
  const payload = src.trim().slice(m[0].length);
  const base64 = !!m[3];
  if (base64) {
    const clean = payload.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
    return {
      type: m[1].toLowerCase(),
      base64,
      payload: clean,
      bytes: Math.floor((clean.length * 3) / 4) - clean.match(/=*$/)[0].length,
    };
  }
  // Percent-encoded text (SVG as some applications write it): one byte per character at most.
  return { type: m[1].toLowerCase(), base64, payload, bytes: payload.length };
}

// The bytes of a data: image from dataImage: base64 decoded, or percent-encoding decoded byte
// by byte (a raster's %89 is a byte, not UTF-8), other characters as UTF-8.
export function dataBytes({ base64, payload }) {
  if (base64) return Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const out = [],
    utf8 = new TextEncoder();
  for (let i = 0; i < payload.length; i++) {
    if (
      payload[i] === "%" &&
      /^[0-9a-f]{2}$/i.test(payload.slice(i + 1, i + 3))
    ) {
      out.push(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    const c = String.fromCodePoint(payload.codePointAt(i));
    for (const b of utf8.encode(c)) out.push(b);
    i += c.length - 1;
  }
  return Uint8Array.from(out);
}

// The format and pixel size of a raster image from its first bytes (a Uint8Array): {type, width,
// height}, or null when the bytes are not a PNG, JPEG, GIF or WebP whose size can be read.
export function imageSize(b) {
  const be16 = (i) => (b[i] << 8) | b[i + 1],
    le16 = (i) => b[i] | (b[i + 1] << 8),
    be32 = (i) => be16(i) * 65536 + be16(i + 2),
    le24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && be32(0) === 0x89504e47 && ascii(12, 4) === "IHDR")
    return { type: "image/png", width: be32(16), height: be32(20) };
  if (b.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6)))
    return { type: "image/gif", width: le16(6), height: le16(8) };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && be16(23) === 0x9d01 && b[25] === 0x2a)
      return {
        type: "image/webp",
        width: le16(26) & 0x3fff,
        height: le16(28) & 0x3fff,
      };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return {
        type: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X")
      return { type: "image/webp", width: le24(24) + 1, height: le24(27) + 1 };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // The markers up to the first frame header (SOF0–SOF15, except DHT, JPG and DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return { type: "image/jpeg", width: be16(i + 7), height: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

// Whether an image is over the limits, from its byte count and, for a raster image, the size its
// header gives.
export const overLimits = (bytes, size = null) =>
  bytes > PASTE_IMAGES.bytes ||
  (!!size &&
    (Math.max(size.width, size.height) > PASTE_IMAGES.side ||
      size.width * size.height > PASTE_IMAGES.pixels));

// The pasted blocks with each placeholder figure replaced by its image figure, or left out when
// `done` has none for it (Map placeholder → node | null).
export const placeImages = (blocks, done) =>
  blocks.flatMap((b) =>
    done.has(b) ? (done.get(b) ? [done.get(b)] : []) : [b],
  );
