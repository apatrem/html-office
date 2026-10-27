// Clipboard content is untrusted (ADR-013 §5): every member is allow-listed,
// so keys such as __proto__ are rejected rather than merged.
export class ClipboardError extends Error {}
export const plainObject = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function fields(value, allowed, where) {
  if (!plainObject(value))
    throw new ClipboardError(`${where}: expected an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new ClipboardError(`${where}: unknown field ${key}`);
}
export const MAX_LINK_LENGTH = 2048;
// Only web and mail targets, as everywhere in html-office.
export function safeURL(url) {
  if (
    typeof url !== "string" ||
    url.length > MAX_LINK_LENGTH ||
    !/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url)
  )
    return false;
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
