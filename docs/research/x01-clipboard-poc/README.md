# X01 clipboard carrier proof of concept

Evidence for [ADR-013](../../decisions/013-cross-product-clipboard.md). This is not part of the test suite.

```bash
node docs/research/x01-clipboard-poc/run.mjs
```

- `source.html` writes the clipboard in two ways:
  - from a `copy` event (`DataTransfer`): `application/x-html-office+json`, `text/html` and `text/plain`;
  - with `navigator.clipboard.write()`: `text/html`, `text/plain`, `image/png` and the Chromium web custom format `web application/x-html-office+json`.
- The `text/html` flavour embeds the JSON in a `data-html-office` attribute on a `table`. It also adds a 2 MB `data-big` attribute, a comment, a `<script type="application/json">`, a `<template>` and a `display:none` element, to see which ones survive.
- `target.html`, a second `file://` document (a different opaque origin), reads the clipboard three ways:
  - through the `paste` event;
  - through `navigator.clipboard.read()`;
  - through `navigator.clipboard.read({ unsanitized: ['text/html'] })`.

## Results: Playwright Chromium 151.0.7922.34, headless, macOS, 24 October 2026

| Written with | Read with | Custom type | `data-html-office` | 2 MB attribute | Comment | `script` | `template`, hidden element | Other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `copy` event | `paste` event | Yes | Yes, exact | Yes | Yes | Yes | Yes | — |
| `copy` event | `read()` | Not listed | Yes, exact | Yes | Yes | **Removed** | Yes | — |
| `copy` event | `read()` unsanitized | Not listed | Yes, exact | Yes | Yes | Yes | Yes | — |
| `clipboard.write()` | `paste` event | **Web format not visible** | Yes, exact | Yes | Yes | Yes | Yes | PNG appears as `Files` |
| `clipboard.write()` | `read()` | Web format readable | Yes, exact | Yes | Yes | **Removed** | Yes | `image/png` listed |

After `clipboard.write()`, the HTML is re-serialised inside `<html><head></head><body>`.

Not covered:

- Firefox, Safari and native applications. Safari's cross-origin sanitiser was read in WebKit source instead (`Source/WebCore/editing/markup.cpp`, `StyledMarkupAccumulator::appendStartTag` and the renderer check in `traverseNodesForSerialization`). It keeps ordinary attributes and drops non-rendered nodes.
- Headless Chromium may use an in-process clipboard instead of the macOS pasteboard.

## Inert parsing: `parse.mjs`

```bash
node docs/research/x01-clipboard-poc/parse.mjs
```

The script parses HTML that references a local server through `img`, `srcset`, `iframe`, `link`, `object`, `poster`, CSS `@import` and `url()`. It uses three methods: `DOMParser`, `document.implementation.createHTMLDocument()` with `innerHTML`, and a `<template>` element. With Chromium 151 it made **no request** with any of them. MDN warns that a `DOMParser` document "can download resources specified in `<iframe>` and `<img>` elements", so X02a must repeat this test in Firefox and WebKit.

X02 extends both harnesses to the Firefox and WebKit engines and to the real product files.
