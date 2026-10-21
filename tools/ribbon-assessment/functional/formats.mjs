const symbols = { EUR: "€", USD: "$", GBP: "£" };
export function toNumberFormat(format = { kind: "general" }) {
  const { kind, digits = 2, currency = "EUR" } = format;
  const number = "#,##0" + (digits ? "." + "0".repeat(digits) : "");
  if (kind === "general") return "general";
  if (kind === "date") return "yyyy-mm-dd";
  if (kind === "number") return number;
  if (kind === "percent") return number.replace("#,##", "") + "%";
  if (kind === "currency") return `"${symbols[currency] ?? currency}"${number}`;
  if (kind === "accounting") return `_("${currency}"* ${number}_)`;
  throw new Error("Unsupported format kind");
}
export function fromNumberFormat(text) {
  if (text === "general") return { kind: "general" };
  if (text === "yyyy-mm-dd") return { kind: "date" };
  const accounting = /^_\("([A-Z]{3})"\* (#,##0(?:\.0{1,15})?)_\)$/.exec(text);
  if (accounting)
    return {
      kind: "accounting",
      digits: (accounting[2].split(".")[1] ?? "").length,
      currency: accounting[1],
    };
  const match = /^(?:"([€$£]|[A-Z]{3})")?(?:#,##)?0(\.0{1,15})?(%)?$/.exec(
    text,
  );
  if (!match || (match[1] && match[3]))
    throw new Error("Unsupported number format; use the supported presets");
  return {
    kind: match[1] ? "currency" : match[3] ? "percent" : "number",
    digits: (match[2]?.length ?? 1) - 1,
    ...(match[1]
      ? {
          currency:
            Object.keys(symbols).find((k) => symbols[k] === match[1]) ??
            match[1],
        }
      : {}),
  };
}
