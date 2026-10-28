// The editor's stand-in for the "entities" package that commonmark imports (tools/build.mjs
// aliases it): the browser's own HTML parser decodes a character reference, in a detached
// <template>, instead of a 2,000-entry table embedded in the file. commonmark passes only
// complete references ("&amp;", "&#123;", "&#x1F600;"); an unknown one stays as written. The
// parser also reads a legacy name at the start of a longer one ("&notit;" as "¬it;"): a named
// reference gives one or two characters, so anything longer is left as written.
let template;
export function decodeHTMLStrict(reference) {
  template ??= document.createElement("template");
  template.innerHTML = reference;
  const text = template.content.textContent;
  return [...text].length <= 2 ? text : reference;
}
