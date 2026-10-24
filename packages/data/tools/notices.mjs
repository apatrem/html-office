// Embedded third-party notices for HTML Data (ADR-011 §9, task L01).
// engine/THIRD-PARTY-NOTICES.txt stays exactly as engine/audit.py writes it,
// so rebuild.sh --check can still compare it; the build reads its retained
// texts back and stores each distinct licence text once.
import { createHash } from "node:crypto";
import { groupNotices, formatNotices } from "../../shared/notices.mjs";

const LABEL = /^(?:[A-Za-z0-9_.-]+@[0-9][^/\s]*\/\S+|Rust \d+\.\d+\.\d+ .+)$/;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// audit.py writes the header, then for each retained text in digest order its
// labels, the text (trimmed, one final newline) and a blank line. Parsing is
// accepted only if it reproduces the file byte for byte, the digests ascend
// and every package's recorded notice digest is among them.
export function retainedNotices(file, audit) {
  const lines = file.split("\n");
  let i = lines.findIndex((line) => LABEL.test(line));
  const header = lines.slice(0, i).join("\n"),
    entries = [];
  while (i < lines.length - 1) {
    const labels = [];
    while (LABEL.test(lines[i])) labels.push(lines[i++]);
    const start = i;
    while (
      i < lines.length - 2 &&
      !(lines[i] === "" && LABEL.test(lines[i + 1]))
    )
      i++;
    const text = lines.slice(start, i).join("\n") + "\n";
    i++;
    if (!labels.length) throw new Error("Notices: text without a label");
    for (const label of labels) entries.push({ label, text, labels });
  }
  const texts = [...new Set(entries.map((entry) => entry.text))],
    digests = texts.map(sha256),
    rebuilt =
      header +
      "\n" +
      texts
        .map(
          (text) =>
            entries.find((e) => e.text === text).labels.join("\n") +
            "\n" +
            text +
            "\n",
        )
        .join("");
  if (rebuilt !== file)
    throw new Error("Notices: parsing does not reproduce the file");
  if (sha256(file) !== audit.noticesSha256)
    throw new Error("Notices: the file differs from the audited notices");
  if (digests.some((digest, n) => n && digest <= digests[n - 1]))
    throw new Error("Notices: retained texts are not in digest order");
  // Each package's audited texts carry its own labels, and no other package's.
  const crates = new Map(
    audit.packages.map((p) => [
      `${p.name}@${p.version}`,
      new Set(p.noticeHashes),
    ]),
  );
  for (const { label, text } of entries) {
    const crate = /^([^\s/]+@[^\s/]+)\//.exec(label)?.[1];
    if (crate && !crates.get(crate)?.has(sha256(text)))
      throw new Error(`Notices: ${label} is not an audited text of ${crate}`);
  }
  for (const [crate, hashes] of crates)
    for (const digest of hashes)
      if (
        !entries.some(
          (e) => e.label.startsWith(crate + "/") && sha256(e.text) === digest,
        )
      )
        throw new Error(`Notices: ${crate} text ${digest} is missing`);
  const [title, ...rest] = header.split("\n");
  return {
    title,
    preamble: rest.join("\n").trim(),
    entries: entries.map(({ label, text }) => ({ label, text })),
  };
}

export function dataNotices(file, audit, bundled = []) {
  const { title, preamble, entries } = retainedNotices(file, audit);
  return formatNotices(groupNotices([...entries, ...bundled]), {
    title,
    preamble,
  });
}
