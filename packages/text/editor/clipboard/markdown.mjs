// Markdown import (T07): CommonMark through commonmark.js, the specification's reference
// implementation, plus tables as GitHub writes them. Markdown becomes HTML, which then takes the
// same mapping as pasted HTML (html.mjs): raw HTML in the Markdown is data like any pasted HTML,
// and what the subset cannot represent is reported the same way.
import { Parser, HtmlRenderer, Node } from "commonmark";
import { ClipboardError } from "../../../shared/clipboard/index.mjs";
import { LIMIT } from "./table.mjs";

// Longer sources are refused (the clipboard's HTML limit, ADR-013 §1).
export const MAX_MARKDOWN = 8 * 2 ** 20;

// A table row's cells: edge pipes are optional, "\|" is a pipe inside a cell.
function cells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out = [];
  let cell = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (s[i] === "|") {
      out.push(cell.trim());
      cell = "";
    } else cell += s[i];
  }
  out.push(cell.trim());
  return out;
}
// The delimiter row's alignments, or null: "---", ":--", "--:", ":-:" between pipes.
function delimiter(line) {
  if (!line.includes("|") && !/^\s*:?-+:?\s*$/.test(line)) return null;
  const parts = cells(line);
  if (!parts.every((p) => /^:?-+:?$/.test(p))) return null;
  return parts.map((p) =>
    p.startsWith(":") && p.endsWith(":")
      ? "center"
      : p.endsWith(":")
        ? "right"
        : p.startsWith(":")
          ? "left"
          : null,
  );
}

// Markdown source as HTML. A table is a paragraph's header line, delimiter row and the lines
// after it: commonmark reads them as one paragraph, which is split here (tables at the top
// level only; the subset has no table inside a list or a quote).
export function markdownHTML(source) {
  const parser = new Parser(),
    renderer = new HtmlRenderer(),
    doc = parser.parse(source),
    lines = source.split(/\r\n|\r|\n/);
  // Inline Markdown of a text, as commonmark parses a paragraph (references resolved).
  const paragraph = (text) => {
    const p = new Node("paragraph");
    p._string_content = text;
    parser.inlineParser.parse(p);
    return p;
  };
  const inlineHTML = (text) => {
    const d = new Node("document");
    d.appendChild(paragraph(text));
    return renderer.render(d).replace(/^<p>|<\/p>\n?$/g, "");
  };
  for (let block = doc.firstChild; block; ) {
    const next = block.next;
    // A paragraph, or a setext heading whose text holds a table: in GitHub's Markdown the table
    // ends only at a blank line or another block, so the underline is one more row.
    if (
      (block.type === "paragraph" ||
        (block.type === "heading" &&
          block.sourcepos?.[1][0] > block.sourcepos?.[0][0])) &&
      block.sourcepos
    ) {
      const [[start], [end]] = block.sourcepos;
      const rows = lines.slice(start - 1, end);
      for (let k = 1; k < rows.length; k++) {
        const aligns = delimiter(rows[k]),
          head = cells(rows[k - 1]);
        if (!aligns || head.length !== aligns.length) continue;
        if (!rows[k].includes("|") && !rows[k - 1].includes("|")) continue;
        // Refused before anything is rendered (ADR-013 §3 limits for Text).
        if (aligns.length > LIMIT.columns || rows.length - k > LIMIT.rows)
          throw new ClipboardError(
            `a Text table holds at most ${LIMIT.rows.toLocaleString("en-US")} rows and ${LIMIT.columns} columns`,
          );
        if (k > 1)
          block.insertBefore(paragraph(rows.slice(0, k - 1).join("\n")));
        const cell = (tag, text, i) =>
          `<${tag}${aligns[i] ? ` align="${aligns[i]}"` : ""}>${inlineHTML(text)}</${tag}>`;
        const body = rows.slice(k + 1).map((row) => {
          const values = cells(row);
          return `<tr>${aligns.map((_, i) => cell("td", values[i] ?? "", i)).join("")}</tr>`;
        });
        const table = new Node("html_block");
        table.literal =
          `<table><thead><tr>${head.map((text, i) => cell("th", text, i)).join("")}</tr></thead>` +
          `<tbody>${body.join("")}</tbody></table>`;
        block.insertBefore(table);
        block.unlink();
        break;
      }
    }
    block = next;
  }
  return renderer.render(doc);
}
