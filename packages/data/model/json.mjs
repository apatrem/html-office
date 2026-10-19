// Valid JSON, including signed zero. JSON.stringify alone silently changes -0 to 0.
export function jsonStringify(
  value,
  { pretty = true, compactArrays = false, sortKeys = false } = {},
) {
  const indent = (level) => "  ".repeat(level);
  function encode(v, level) {
    if (v === null) return "null";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Non-finite JSON number");
      return Object.is(v, -0) ? "-0" : String(v);
    }
    if (typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (Array.isArray(v)) {
      const parts = v.map((item) => encode(item, level + 1));
      if (!pretty) return "[" + parts.join(",") + "]";
      if (!parts.length) return "[]";
      if (
        compactArrays &&
        v.every((item) => item === null || typeof item !== "object")
      ) {
        if (parts.length <= 32) return "[" + parts.join(", ") + "]";
        const chunks = [];
        for (let i = 0; i < parts.length; i += 32)
          chunks.push(indent(level + 1) + parts.slice(i, i + 32).join(", "));
        return "[\n" + chunks.join(",\n") + "\n" + indent(level) + "]";
      }
      return (
        "[\n" +
        parts.map((p) => indent(level + 1) + p).join(",\n") +
        "\n" +
        indent(level) +
        "]"
      );
    }
    if (typeof v !== "object" || v === undefined)
      throw new Error("Unsupported JSON value");
    const keys = Object.keys(v);
    if (sortKeys) keys.sort();
    const parts = keys.map(
      (key) =>
        JSON.stringify(key) + (pretty ? ": " : ":") + encode(v[key], level + 1),
    );
    if (!pretty) return "{" + parts.join(",") + "}";
    if (!parts.length) return "{}";
    return (
      "{\n" +
      parts.map((p) => indent(level + 1) + p).join(",\n") +
      "\n" +
      indent(level) +
      "}"
    );
  }
  return encode(value, 0)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
