import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  pruneCSS,
  unusedClassesNamed,
  iconsNamed,
  UNUSED_SHELL_CLASSES,
  PURE_CALLS,
} from "../tools/slim.mjs";
import { buildEngine } from "../tools/build.mjs";
import { ICONS } from "../../shared/shell/icons.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("pruneCSS drops only selectors naming an unused class", () => {
  const unused = /^(x-gone|x-fam-[\w-]*)$/;
  assert.equal(
    pruneCSS(
      ".a,.x-gone{color:red}.x-gone .b{top:0}.b:is(.c,.d),.x-fam-1>i{margin:0}",
      unused,
    ),
    ".a{color:red}.b:is(.c,.d){margin:0}",
  );
  // @media is pruned inside and dropped when empty; other at-rules and strings stay whole.
  assert.equal(
    pruneCSS(
      '@media (max-width:600px){.x-gone{a:b}.k{c:d}}@media print{.x-fam-a{e:f}}@font-face{font-family:"x-gone{"}.q[title="x,.x-gone"]{g:h}',
      unused,
    ),
    '@media (max-width:600px){.k{c:d}}@font-face{font-family:"x-gone{"}.q[title="x,.x-gone"]{g:h}',
  );
  // A class that only starts like an unused one is kept.
  assert.equal(pruneCSS(".x-gone2{a:b}", unused), ".x-gone2{a:b}");
});

test("the editor's code naming an unused class, whole or by its stem, is caught", () => {
  assert.deepEqual(
    unusedClassesNamed('h("span",{class:`sh-sw sh-sw-${t}`}); "sh-kv"'),
    ["sh-sw", "sh-sw-", "sh-kv"],
  );
  assert.deepEqual(unusedClassesNamed('"sh-pop sh-b sh-primary"'), []);
  // The classes Text's shell does use stay out of the list.
  for (const used of ["sh-pop", "sh-b", "sh-root", "sh-drawer", "sh-ic"])
    assert.ok(!UNUSED_SHELL_CLASSES.test(used), used);
});

test("iconsNamed keeps the icons a string literal names", () => {
  const kept = iconsNamed(
    'button({ic:"undo"}); icon(`caret`); const save = 1; x.redo;',
    ICONS,
  );
  assert.deepEqual(Object.keys(kept), ["undo", "caret"]);
  assert.equal(kept.undo, ICONS.undo);
});

test("the built editor leaves out what Text never uses, and keeps what it does", async () => {
  const { code } = await buildEngine();
  const shell = await readFile(
    `${repo}packages/shared/shell/shell.css`,
    "utf8",
  );
  assert.ok(shell.includes(".sh-swrow"));
  // Data's swatches and key-value table; prosemirror-tables' header toggles and resizing key.
  for (const gone of [
    ".sh-swrow",
    ".sh-kv",
    ".sh-cs-note",
    "useDeprecatedLogic",
    "tableColumnResizing",
  ])
    assert.ok(!code.includes(gone), gone);
  for (const kept of [".sh-root", ".sh-drawer", ".sh-pop", ICONS.undo])
    assert.ok(code.includes(kept), kept);
  assert.ok(!code.includes(ICONS.condfmt), "Data's conditional-format icon");
  assert.ok(!code.includes("<?xml"), "commonmark's XML renderer");
  assert.ok(PURE_CALLS.length);
});
