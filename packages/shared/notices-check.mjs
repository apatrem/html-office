// Independent checks of generated notices (task L01), used by the Slides and
// Data tests. They read only the inputs and the final text, never the
// generator's grouping, so a grouping mistake cannot hide itself.
const squash = (text) => text.replace(/\s+/g, " ").trim();
const BLOCK = /^== \d+\. .+ ==$/m;

// The blocks of a formatted notice: the packages listed in its header lines
// (two-space indent) and its stored text (after the first blank line).
export function noticeBlocks(notices) {
  return notices
    .split(BLOCK)
    .slice(1)
    .map((block) => {
      const lines = block.replace(/^\n/, "").split("\n"),
        blank = lines.indexOf("");
      const header = blank < 0 ? lines : lines.slice(0, blank);
      return {
        packages: header
          .filter((line) => /^ {2}\S/.test(line))
          .flatMap((line) => line.trim().split(", ")),
        text:
          blank < 0
            ? ""
            : lines
                .slice(blank + 1)
                .join("\n")
                .trimEnd(),
      };
    });
}

// entries: [{ label, text }] as given to the generator. Returns problems:
// a package that is not listed, a line of a licence file whose wording is
// absent, or a licence text stored more than once.
export function noticeProblems(entries, notices) {
  const problems = [],
    blocks = noticeBlocks(notices),
    listed = new Set(blocks.flatMap((block) => block.packages)),
    all = squash(notices);
  for (const { label, text } of entries) {
    const name =
      /^((?:@[^\s/]+\/)?[^\s/@]+@[^\s/]+)\//.exec(label)?.[1] ?? label;
    if (!listed.has(name)) problems.push(`${label}: package not listed`);
    for (const line of text.split("\n")) {
      // Section separators and the optional "MIT License" title are layout.
      if (/^\s*(?:={3,}|~{3,})\s*$/.test(line)) continue;
      if (/^\s*(?:the )?mit licen[cs]e(?: \(mit\))?\s*$/i.test(line)) continue;
      if (line.trim() && !all.includes(squash(line)))
        problems.push(`${label}: missing line: ${line.trim()}`);
    }
  }
  const seen = new Set();
  for (const { text } of blocks) {
    const key = squash(text);
    if (key && seen.has(key))
      problems.push(`licence text stored twice: ${key.slice(0, 60)}`);
    seen.add(key);
  }
  return problems;
}
