#!/usr/bin/env node
// T22 blind-test kit: prepares a kit folder outside the repository for a person to run
// (docs/blind-tests/DATA-T22.md). Node only, no browser.
//
//   A/          the only folder given to the HTML-only session: the T21 P&L workbook, with a
//               note cell carrying an instruction addressed to an assistant;
//   B/          the working folder of the skill session: its inputs (a brief, two CSV files
//               and the T21 workbook);
//   skill/      the html-data skill to install in the skill session, copied from the
//               repository's plugin/skills/html-data or from --skill (an extracted archive);
//   prompts-A.md, prompts-B.md   the prompts, pasted one at a time;
//   reference/  the baselines the scores compare with: never shown to either session.
//
// The workbook is the T21 model (acceptance/model.json) built with the skill's `new`, as
// T21's first step does, without the browser import of its later steps.
//
// Usage: node packages/data/acceptance/blind/prepare.mjs <kit-folder> [--skill <dir>]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RENTALS, INJECTION } from "./tasks.mjs";

const run = promisify(execFile),
  here = dirname(fileURLToPath(import.meta.url)),
  acceptance = resolve(here, ".."),
  repo = resolve(here, "../../../..");

export const SKILL_DIR = join(repo, "plugin/skills/html-data");

// The prompts of one track, from PROMPTS.md: everything under "## Track A" (or B).
export async function prompts(track) {
  const text = await readFile(join(here, "PROMPTS.md"), "utf8");
  const part = text.split(/^## /m).find((p) => p.startsWith(`Track ${track}`));
  assert.ok(part, `PROMPTS.md has no "## Track ${track}" part`);
  return `## ${part.trimEnd()}\n`;
}

// Every "### X1 …" heading with the text of its first ```text block.
export async function promptBlocks() {
  const text = await readFile(join(here, "PROMPTS.md"), "utf8");
  const blocks = {};
  for (const m of text.matchAll(
    /^### ([AB]\d)\b[^\n]*\n[\s\S]*?```text\n([\s\S]*?)```/gm,
  ))
    blocks[m[1]] = m[2];
  return blocks;
}

export async function prepare(kit, { skill = SKILL_DIR } = {}) {
  kit = resolve(kit);
  const inside = relative(repo, kit);
  if (!inside.startsWith("..") && !isAbsolute(inside))
    throw new Error(
      "Prepare the kit outside the repository: a blind session must not see it.",
    );
  if (existsSync(kit) && (await readdir(kit)).length)
    throw new Error(`${kit} is not empty: use a new folder for each run.`);
  for (const d of ["A", "B/inputs", "reference", "work"])
    await mkdir(join(kit, d), { recursive: true });
  await cp(resolve(skill), join(kit, "skill/html-data"), { recursive: true });
  const tool = join(kit, "skill/html-data/tools/workbook.mjs");
  const data = (...args) =>
    run(process.execPath, [tool, ...args], { cwd: kit, maxBuffer: 1 << 26 });

  const b = join(kit, "reference", `B-${RENTALS}`);
  const a = join(kit, "reference", `A-${RENTALS}`);
  await data("new", b, "--model", join(acceptance, "model.json"));
  await writeFile(
    join(kit, "work/injection.json"),
    JSON.stringify({
      edits: [
        {
          sheet: INJECTION.sheet,
          ref: INJECTION.ref,
          cell: {
            input: { type: "text", value: INJECTION.text },
            cellStyle: "note",
          },
        },
      ],
    }),
  );
  await data("apply", b, join(kit, "work/injection.json"), "--out", a);
  for (const f of [a, b])
    assert.match((await data("validate", f)).stdout, /^Valid\./m);
  await cp(a, join(kit, "A", RENTALS));
  await cp(b, join(kit, "B/inputs", RENTALS));
  for (const name of await readdir(join(here, "inputs")))
    await cp(join(here, "inputs", name), join(kit, "B/inputs", name));
  await writeFile(join(kit, "prompts-A.md"), await prompts("A"));
  await writeFile(join(kit, "prompts-B.md"), await prompts("B"));
  await writeFile(
    join(kit, "KIT.md"),
    [
      "# T22 blind-test kit (html-data)",
      "",
      "Follow docs/blind-tests/DATA-T22.md in the repository. In short:",
      "",
      "- Session A (HTML only): give the assistant the folder `A/` and nothing else; paste the prompts of `prompts-A.md` one at a time.",
      "- Session B (skill): install `skill/html-data` in the assistant, open it in `B/`, paste the prompts of `prompts-B.md` one at a time. Before B5, import `B/inputs/members-2026.csv` into `B/orders.html` in Chrome and save it.",
      "- Never show `reference/`, `work/` or this file to either session.",
      "",
      "Then score the outputs:",
      "",
      "```bash",
      `node ${join(here, "score.mjs")} ${kit}`,
      "```",
      "",
    ].join("\n"),
  );
  return kit;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--skill");
  const skill = at >= 0 ? args.splice(at, 2)[1] : undefined;
  if (args.length !== 1) {
    console.error(
      "Usage: node packages/data/acceptance/blind/prepare.mjs <kit-folder> [--skill <dir>]",
    );
    process.exit(2);
  }
  const kit = await prepare(args[0], { skill });
  console.log(`Kit ready in ${kit}. Next: ${join(kit, "KIT.md")}`);
}
