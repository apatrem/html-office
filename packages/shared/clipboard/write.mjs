// Writers (ADR-013 §1, §3): semantic text/html for other applications with
// the envelope in a data-html-office attribute, and text/plain.
import { ClipboardError } from "./errors.mjs";
import { MIME, ATTRIBUTE, LIMITS, encodeEnvelope } from "./envelope.mjs";

const escapeText = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
export const escapeAttribute = (s) =>
  String(s).replace(
    /[&"<>]/g,
    (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );
// Line breaks inside a cell, as Excel writes them.
const lines = (s) =>
  s
    .split(/\r\n|\r|\n/)
    .map(escapeText)
    .join('<br style="mso-data-placement:same-cell">');

// ---- Exact-value hints for Excel and Google Sheets (never read back) ----
const quoteCode = (s) => '"' + s.replaceAll('"', '""') + '"';
function datePattern(locale, long) {
  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: long ? "long" : "2-digit",
    day: long ? "numeric" : "2-digit",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(2026, 10, 22)));
  return parts
    .map((p) =>
      p.type === "day"
        ? long
          ? "d"
          : "dd"
        : p.type === "month"
          ? long
            ? "mmmm"
            : "mm"
          : p.type === "year"
            ? "yyyy"
            : p.value && quoteCode(p.value),
    )
    .join("");
}
// An Excel number format code for a Data preset (ADR-010 / ADR-012).
export function excelFormat(format, type, locale = "en-US") {
  const f = format ?? { kind: "general" };
  if (type === "date" || f.kind === "date")
    return datePattern(locale, f.dateStyle === "long");
  if (f.kind === "general") return null;
  const digits = f.digits ?? 2,
    decimals = digits ? "." + "0".repeat(digits) : "";
  let body =
    f.kind === "percent"
      ? "0" + decimals + "%"
      : "#,##0" +
        decimals +
        ({ thousands: ',"k"', millions: ',,"M"' }[f.scale] ?? "");
  if (f.kind === "currency" || f.kind === "accounting") {
    const parts = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: f.currency ?? "EUR",
      }).formatToParts(1),
      at = parts.findIndex((p) => p.type === "currency"),
      symbol = quoteCode(parts[at].value),
      before = at < parts.findIndex((p) => p.type === "integer"),
      gap = /\s/.test(parts[before ? at + 1 : at - 1]?.value ?? "") ? " " : "";
    body = before ? symbol + gap + body : body + gap + symbol;
  }
  const negative =
    f.negative ?? (f.kind === "accounting" ? "parentheses" : "minus");
  return {
    minus: body,
    parentheses: `${body};(${body})`,
    red: `${body};[Red]-${body}`,
    redParentheses: `${body};[Red](${body})`,
  }[negative];
}
// Text Excel would otherwise read as a number or a date.
const numberLike = (s) => /^[\s+\-(]*[\d.,]+[\s%)]*$|^\d{1,4}[-/.]\d/.test(s);
function hints(cell, locale) {
  const v = cell.value;
  if (!v) return {};
  let attributes = "",
    css = "";
  const sheets = (json) =>
    ` data-sheets-value="${escapeAttribute(JSON.stringify(json))}"`;
  if (v.type === "number" || v.type === "date") {
    attributes += ` x:num="${v.value}"` + sheets({ 1: 3, 3: v.value });
    const code = excelFormat(cell.format, v.type, locale);
    if (code) css += `mso-number-format:'${code.replaceAll("'", "\\'")}';`;
    if (v.type === "date" || cell.format?.kind === "date")
      attributes += ` data-sheets-numberformat="${escapeAttribute(JSON.stringify({ 1: 5, 2: code.replaceAll('"', ""), 3: 1 }))}"`;
  } else if (v.type === "boolean")
    attributes += sheets({ 1: 4, 4: v.value ? 1 : 0 });
  else if (v.type === "error")
    attributes += ` x:err="${escapeAttribute(v.value)}"`;
  else {
    attributes += sheets({ 1: 2, 2: v.value });
    if (numberLike(v.value)) {
      attributes += " x:str";
      css += "mso-number-format:'\\@';";
    }
  }
  return { attributes, css };
}

function runHTML(run, color) {
  let html = lines(run.text);
  if (run.link) html = `<a href="${escapeAttribute(run.link.url)}">${html}</a>`;
  if (run.color && color?.(run.color))
    html = `<span style="color:${escapeAttribute(color(run.color))}">${html}</span>`;
  if (run.italic) html = `<i>${html}</i>`;
  if (run.bold) html = `<b>${html}</b>`;
  return html;
}

// `css(cell, row, column)` returns the literal declarations resolved from the
// source's charte (weight, italic, colour, fill, borders, alignment): the one
// place where token names become colours, because Word and Excel cannot read
// the charte. `color(token)` resolves run colours.
export function tableHTML(table, { envelope, locale, css, color } = {}) {
  const header = table.headerRows ?? 0,
    out = [
      `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table${envelope ? ` ${ATTRIBUTE}="${escapeAttribute(envelope)}"` : ""} style="border-collapse:collapse">`,
    ];
  if (table.columns?.some((c) => c.width !== undefined))
    out.push(
      "<colgroup>" +
        table.columns
          .map((c) =>
            c.width === undefined
              ? "<col>"
              : `<col style="width:${+c.width.toFixed(2)}%">`,
          )
          .join("") +
        "</colgroup>",
    );
  table.rows.forEach((row, r) => {
    if (r === 0 && header) out.push("<thead>");
    if (r === header) out.push((header ? "</thead>" : "") + "<tbody>");
    out.push("<tr>");
    row.forEach((cell, c) => {
      if (cell?.covered) return;
      const tag = r < header || cell?.header ? "th" : "td";
      if (!cell) return out.push(`<${tag}></${tag}>`);
      const hint = hints(cell, locale),
        align = cell.align ?? table.columns?.[c]?.align,
        style =
          (css?.(cell, r, c) ?? "") +
          (hint.css ?? "") +
          (align && !css ? `text-align:${align};` : ""),
        spans =
          (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "") +
          (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "");
      const body = cell.runs
        ? cell.runs.map((run) => runHTML(run, color)).join("")
        : runHTML(
            {
              text: cell.text,
              link: cell.link,
              ...(css ? {} : { bold: cell.bold, italic: cell.italic }),
            },
            color,
          );
      out.push(
        `<${tag}${spans}${hint.attributes ?? ""}${style ? ` style="${escapeAttribute(style)}"` : ""}>${body}</${tag}>`,
      );
    });
    out.push("</tr>");
  });
  out.push(header >= table.rows.length ? "</thead>" : "</tbody>");
  // </body> and </html> are optional; leaving them out keeps the literal
  // out of every product bundle (test harnesses inject before it).
  out.push("</table>");
  return out.join("");
}

// Writes every flavour from one synchronous copy event. text/html is left out
// above its limits; the envelope and text/plain cannot be, so the copy fails.
export function writeClipboard(
  data,
  { envelope, table, text, stringify, html: options },
) {
  const json = encodeEnvelope(envelope, stringify);
  if (text.length > LIMITS.text)
    throw new ClipboardError(
      "the selection is too large for the clipboard; copy a smaller range",
    );
  let html = null;
  const cells = table ? table.rows.length * table.rows[0].length : Infinity;
  if (table && cells <= LIMITS.htmlCells) {
    html = tableHTML(table, { ...options, envelope: json });
    if (html.length > LIMITS.html) html = null;
  }
  data.setData(MIME, json);
  if (html) data.setData("text/html", html);
  data.setData("text/plain", text);
  return { html: !!html };
}
