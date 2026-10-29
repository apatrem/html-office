// Reads what print tests need from a Chromium PDF (T14), with no PDF library: the pages in order,
// each page's text (FlateDecode content streams, Identity-H fonts mapped through ToUnicode), its
// link annotations, and the named destinations Chromium writes for in-document link targets.
import { inflateSync } from "node:zlib";

export function readPDF(buffer) {
  const s = buffer.toString("latin1");
  const objects = new Map();
  for (const m of s.matchAll(/(?:^|\s)(\d+) 0 obj\b/g)) {
    const start = m.index + m[0].length;
    const dictEnd = s.indexOf("endobj", start);
    let body = s.slice(start, dictEnd);
    const at = body.search(/\bstream\r?\n/);
    let stream = null;
    if (at >= 0) {
      const length = +body.match(/\/Length (\d+)/)[1];
      const from = start + at + body.slice(at).match(/^stream\r?\n/)[0].length;
      stream = buffer.subarray(from, from + length);
      body = body.slice(0, at);
    }
    objects.set(+m[1], { body, stream });
  }
  const ref = (text) => +text.match(/(\d+) 0 R/)[1];
  const data = (o) =>
    /\/FlateDecode/.test(o.body) ? inflateSync(o.stream) : o.stream;
  const root = [...objects.values()].find((o) =>
    /\/Type \/Catalog/.test(o.body),
  );
  const pageIds = [];
  const walk = (id) => {
    const o = objects.get(id);
    if (/\/Type \/Pages/.test(o.body))
      for (const kid of o.body
        .match(/\/Kids \[([^\]]*)\]/)[1]
        .matchAll(/(\d+) 0 R/g))
        walk(+kid[1]);
    else pageIds.push(id);
  };
  walk(ref(root.body.match(/\/Pages \d+ 0 R/)[0]));
  const cmaps = new Map();
  const toUnicode = (fontId) => {
    if (cmaps.has(fontId)) return cmaps.get(fontId);
    const map = new Map();
    const tu = objects.get(fontId).body.match(/\/ToUnicode (\d+) 0 R/);
    if (tu) {
      const text = data(objects.get(+tu[1])).toString("latin1");
      const hex = (h) =>
        String.fromCodePoint(
          ...(h.match(/.{4}/g) ?? []).map((u) => parseInt(u, 16)),
        );
      for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
        for (const [, a, b] of block[1].matchAll(
          /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
        ))
          map.set(parseInt(a, 16), hex(b));
      for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
        for (const [, a, b, c] of block[1].matchAll(
          /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g,
        )) {
          const lo = parseInt(a, 16),
            hi = parseInt(b, 16);
          const list = c.startsWith("[")
            ? [...c.matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])
            : null;
          for (let g = lo; g <= hi; g++)
            map.set(
              g,
              list
                ? hex(list[g - lo])
                : String.fromCodePoint(parseInt(c.slice(1, -1), 16) + g - lo),
            );
        }
    }
    cmaps.set(fontId, map);
    return map;
  };
  // Names to object numbers in a resource dictionary (/Font, /XObject), inline or by reference.
  const named = (body, kind) => {
    const m =
      body.match(new RegExp(`/${kind}\\s*<<([^>]*)>>`)) ??
      body
        .match(new RegExp(`/${kind} (\\d+) 0 R`))
        ?.slice(1)
        .map((id) => objects.get(+id).body.match(/<<([^>]*)>>/)?.[1]);
    return new Map(
      [...(m?.[1] ?? "").matchAll(/\/(\w+) (\d+) 0 R/g)].map((x) => [
        x[1],
        +x[2],
      ]),
    );
  };
  // The text a content stream draws, forms (Do) included, in drawing order.
  const draw = (ops, resources) => {
    const fonts = named(resources, "Font"),
      forms = named(resources, "XObject");
    let text = "",
      map = new Map();
    for (const m of ops.matchAll(
      /\/(\w+) [\d.]+ Tf|<([0-9A-Fa-f]*)>|\bET\b|\/(\w+) Do\b/g,
    )) {
      if (m[1]) map = toUnicode(fonts.get(m[1]));
      else if (m[2] !== undefined)
        for (const g of m[2].match(/.{4}/g) ?? [])
          text += map.get(parseInt(g, 16)) ?? "\uFFFD";
      else if (m[3]) {
        const form = objects.get(forms.get(m[3]));
        if (/\/Subtype \/Form/.test(form.body))
          text += draw(data(form).toString("latin1"), form.body);
      } else text += "\n";
    }
    return text;
  };
  const pages = pageIds.map((id) => {
    const body = objects.get(id).body;
    const contents = body.match(/\/Contents (?:\[([^\]]*)\]|(\d+) 0 R)/);
    const ids = contents[1]
      ? [...contents[1].matchAll(/(\d+) 0 R/g)].map((m) => +m[1])
      : [+contents[2]];
    const text = ids
      .map((cid) => draw(data(objects.get(cid)).toString("latin1"), body))
      .join("");
    const links = [...body.matchAll(/\/Annots \[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/(\d+) 0 R/g)].map((a) => objects.get(+a[1]).body),
    );
    return { id, text, links };
  });
  // Named destinations: /name [page 0 R /XYZ x y 0], in the catalog's /Dests dictionary.
  const destinations = {};
  for (const o of objects.values())
    for (const m of o.body.matchAll(
      /\/([\w-]+) \[(\d+) 0 R \/XYZ ([\d.-]+) ([\d.-]+)/g,
    ))
      destinations[m[1]] = {
        page: pageIds.indexOf(+m[2]),
        y: +m[4],
      };
  const box = s.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  return { pages, destinations, size: [+box[1], +box[2]] };
}
