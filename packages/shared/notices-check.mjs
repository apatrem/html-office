// Independent checks of generated notices (task L01), used by the Slides and
// Data tests. They read only the inputs and the final text, never the
// generator's grouping, so a grouping mistake cannot hide itself.
const squash = (text) => text.replace(/\s+/g, " ").trim();
const BLOCK = /^== \d+\. .+ ==$/m;
const POINTER = /\[[^\]\n]+ text: see (\d+)\.\]/g;
// The licence wordings that must never be stored twice, even inside a larger
// notice: the opening and closing words of each.
const LICENCES = [
  ["Permission is hereby granted, free of charge", "DEALINGS IN THE SOFTWARE"],
  [
    "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    "END OF TERMS AND CONDITIONS",
  ],
];

// The blocks of a formatted notice: the packages listed in its header, each
// with the copyright lines under it, and its stored text.
export function noticeBlocks(notices) {
  return notices
    .split(BLOCK)
    .slice(1)
    .map((block) => {
      const lines = block.replace(/^\n/, "").split("\n"),
        blank = lines.indexOf(""),
        header = blank < 0 ? lines : lines.slice(0, blank),
        holders = new Map();
      let names = [];
      for (const [i, line] of header.entries())
        if (/^ {2}\S/.test(line)) {
          if (i && /^ {4}/.test(header[i - 1])) names = [];
          for (const name of line.trim().split(", ")) {
            names.push(name);
            holders.set(name, []);
          }
        } else if (/^ {4}\S/.test(line))
          for (const name of names) holders.get(name).push(line.trim());
      return {
        packages: [...holders.keys()],
        holders,
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

// entries: [{ label, text }] as given to the generator. Returns problems: a
// package that is not listed, a line of a package's licence file that is in
// none of the blocks listing that package (or the texts they point to), or a
// licence text stored more than once.
export function noticeProblems(entries, notices) {
  const problems = [],
    blocks = noticeBlocks(notices);
  const corpus = new Map();
  for (const block of blocks)
    for (const name of block.packages) {
      const parts = corpus.get(name) ?? [];
      parts.push(block.holders.get(name).join("\n"), block.text);
      for (const [, target] of block.text.matchAll(POINTER))
        parts.push(blocks[+target - 1]?.text ?? "");
      corpus.set(name, parts);
    }
  for (const { label, text } of entries) {
    const name =
      /^((?:@[^\s/]+\/)?[^\s/@]+@[^\s/]+)\//.exec(label)?.[1] ?? label;
    if (!corpus.has(name)) {
      problems.push(`${label}: package not listed`);
      continue;
    }
    const own = squash(corpus.get(name).join("\n"));
    for (const line of text.split("\n")) {
      // Section separators and the optional "MIT License" title are layout.
      if (/^\s*(?:={3,}|~{3,})\s*$/.test(line)) continue;
      if (/^\s*(?:the )?mit licen[cs]e(?: \(mit\))?\s*$/i.test(line)) continue;
      if (line.trim() && !own.includes(squash(line)))
        problems.push(`${label}: missing line: ${line.trim()}`);
    }
  }
  const seen = new Set(),
    wordings = new Set();
  for (const { text } of blocks) {
    const key = squash(text);
    if (key && seen.has(key))
      problems.push(`licence text stored twice: ${key.slice(0, 60)}`);
    seen.add(key);
    // Every complete licence wording, inside any block, must be unique.
    for (const [start, end] of LICENCES)
      for (
        let at = key.indexOf(start);
        at >= 0;
        at = key.indexOf(start, at + 1)
      ) {
        const stop = key.indexOf(end, at),
          wording = key.slice(
            at,
            stop < 0 ? key.length : stop + end.length + 1,
          );
        if (wordings.has(wording))
          problems.push(`the "${start}" wording is stored twice`);
        wordings.add(wording);
      }
  }
  return problems;
}
