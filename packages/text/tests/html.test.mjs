import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { serialize, element, text } from "../model/html.mjs";

const fixtures = new URL("../fixtures/valid/", import.meta.url);

test("the serialiser reproduces every canonical fixture's article byte for byte", async () => {
  for (const name of (await readdir(fixtures)).filter((f) =>
    f.endsWith(".html"),
  )) {
    const source = await readFile(new URL(name, fixtures), "utf8");
    const body = parseFile(source).html.children.find((n) => n.name === "body");
    const article = body.children.find((n) => n.name === "article");
    assert.equal(
      serialize(article),
      source.slice(article.loc.offset, article.loc.end),
      name,
    );
  }
});

test("escaping is fixed and survives reparsing", () => {
  const node = element(
    "p",
    [["title", 'a "b" <c> & d\u00a0e']],
    [text("x < y > z & \u00a0 \"q\" 'r'")],
  );
  const html = serialize(node);
  assert.equal(
    html,
    '<p title="a &quot;b&quot; &lt;c&gt; &amp; d&nbsp;e">x &lt; y &gt; z &amp; &nbsp; "q" \'r\'</p>',
  );
  const reparsed = parseFile(`<!doctype html><body>${html}`).html.children.find(
    (n) => n.name === "body",
  ).children[0];
  assert.equal(serialize(reparsed), html);
});

test("raw text, void elements, foreign elements and leading newlines", () => {
  assert.equal(
    serialize(
      element("script", [["type", "application/json"]], [text('{"a":"<b>&"}')]),
    ),
    '<script type="application/json">{"a":"<b>&"}</script>',
  );
  assert.equal(serialize(element("br")), "<br>");
  assert.equal(
    serialize(element("path", [["d", "M0 0"]], [], "svg")),
    '<path d="M0 0"></path>',
  );
  const pre = element("pre", [], [text("\nfirst line")]);
  const reparsed = parseFile(
    `<!doctype html><body>${serialize(pre)}`,
  ).html.children.find((n) => n.name === "body").children[0];
  assert.equal(reparsed.children[0].value, "\nfirst line");
});
