# html-slides catalogue

**Layouts** structure a slide; **archetypes** organise its content. Choose the archetype first, then the simplest layout that supports it (usually `default`). See `<skill>/examples/catalogue.html`; use `check.mjs --shots` for screenshots.

## Layouts

| `data-layout` | Use | Expected elements |
| --- | --- | --- |
| `cover` | Cover | `.kicker`, `h1` (≤3 lines), `.lead`, `.note`, `.tracker`, `.cartouche` |
| `default` | Title and 12-column content | `.tracker`, `h1`, `w-*` content, `.sticker`, `.source` |
| `top-left` | Larger impact title | Same as `default` |
| `mid-left` | Transition: left title, right content | `h1`, stacked content |
| `section` | Section divider | `.num`, `.tracker`, `h1`, `.lead` |
| `quote` | Quotation | `blockquote`, `.author` |
| `panel-14`, `panel-13`, `panel-12`, `panel-23` | Tinted left panel (¼, ⅓, ½, ⅔) | `.in-panel` KPI/stack/chart, then title and content |
| `three-lines` | Three parallel findings | `.tracker`, `h1`, three `.band` elements (label and sentence) |
| `end` | Closing slide | `h1`, `.lead`, `.tracker`, `.cartouche` |

`class="slide dark"` is a dark variant. Use sparingly, at most once per section.

```html
<section class="slide" id="s01" data-layout="cover">
  <p class="kicker">Community garden · Example</p>
  <h1>Small weekly tasks keep the shared garden growing</h1>
  <p class="lead">Season plan — discussion draft</p>
  <p class="note">All figures are illustrative.</p>
  <p class="tracker">Fictional example</p>
  <div class="cartouche">
    <div><span>Topic</span>Shared garden</div>
    <div><span>Date</span>2026-10-14</div>
    <div class="acc"><span>Pages</span>9</div>
  </div>
</section>

<section class="slide" id="s03" data-layout="section">
  <p class="num">01</p><p class="tracker">Part 1</p>
  <h1>Weekly activities</h1><p class="lead">How volunteers share routine tasks</p>
</section>

<section class="slide" id="s06" data-layout="panel-13">
  <div class="stack in-panel"><p class="kpi">2 of 6</p><p class="body">activities need extra volunteer time.</p></div>
  <p class="tracker">02 · Activities</p><h1>Two practical changes free up weekly time</h1>
  <figure class="chart" data-type="bubble"><script type="application/json">{…}</script></figure>
  <p class="source">Source: fictional example</p>
</section>
```

## Archetypes

| Archetype | Composition | Layout |
| --- | --- | --- |
| Summary | `.body.w-8` (bold answer +3–5 bullets), `.stack.w-4` (KPI + decision callout) | `default` |
| Agenda | `.body` with `<ol>` | `default` / `mid-left` |
| Time series | `column`/`line` `w-8`, commentary `w-4` | `default` |
| Ranking | `hbar` with a highlighted category | `default` / `panel-14` |
| Breakdown | `stacked`/`hbar` and commentary | `default` |
| Bridge | `waterfall.w-8`, `.stack.w-4` | `default` |
| Action cards | `.cards.cols-3` (`cols-2` / `cols-4`), `.card` with `h3` +short text | `default` / `top-left` |
| 2×2 matrix | `.matrix`: four `.q` (one `.q.on`), `.ylab`, `.xlab` | `default` |
| Budget | `table.t`, `th.n`/`td.n` numbers, `tr.tot` total, callout | `default` |
| Schedule | Full-width `gantt` | `default` |
| Cash flow | Annual `column`/`waterfall` | `default` |
| Risks | `table.t` or `three-lines` | `default` / `three-lines` |
| Decision | Recommendation `.body` +KPI | Dark `panel-13` |
| Process | `.steps.cols-4`, children `<div><b>Step</b>duration</div>` | `default` |

```html
<div class="body w-8"><p><b>The conclusion comes first.</b></p>
  <ul><li>Argument 1</li><li>Argument 2</li><li>Argument 3</li></ul>
</div>
<div class="stack w-4"><p class="kpi">24 hours<small>weekly volunteer time</small></p>
  <div class="callout">Decision: agree on a simple rota.</div>
</div>

<div class="cards cols-3">
  <div class="card"><h3>Title</h3>Short text.</div>
  <div class="card"><h3>Title</h3>Short text.</div>
  <div class="card n"><h3>Secondary title</h3>Short text.</div>
</div>

<div class="matrix w-6">
  <div class="q"><b>High benefit, slow</b>…</div><div class="q on"><b>High benefit, quick</b>…</div>
  <div class="q"><b>Low benefit, slow</b>…</div><div class="q"><b>Low benefit, quick</b>…</div>
  <div class="ylab">Benefit</div><div class="xlab">Speed</div>
</div>

<table class="t w-8"><tr><th>Activity</th><th class="n">Hours</th></tr>
  <tr><td>…</td><td class="n">2.4</td></tr><tr class="tot"><td>Total</td><td class="n">6.8</td></tr>
</table>
```

## Free-composition primitives

Use a detached slide when no archetype fits. Position each element with `--x`, `--y`, `--w`, `--h`, preferably on an 8 px grid, inside x=64–1216 and y=44–668.

| Class | Appearance |
| --- | --- |
| `.box` with `bg-*` | Bordered, tinted, accent, or dark box; legacy `.box.tint/.accent/.dark` remain supported |
| `.shape[data-shape]` | Filled geometric shape, chevron, or arrow; short centred text (see FORMAT.md) |
| `.arrow` | Centred text arrow (→ ↓ ⇄) |
| `.rule` | Horizontal rule |
| `.callout` | Left-rule callout |
| `.kpi`, `.kpi.sm` | Key figure; `<small>` for its label |
| `.lead`, `.body`, `.t2` | Introduction, body, secondary text |
| `.hl`, `.neg` | Inline accent emphasis, negative/alert emphasis |
| `img[data-asset]` | Image with alt text |

```html
<section class="slide" id="s07" data-layout="default" data-detached>
  <p class="tracker" style="--x:64;--y:44;--w:600;--h:16">03 · Season plan</p>
  <h1 style="--x:64;--y:84;--w:1080;--h:80">The season has three simple phases</h1>
  <div class="box bg-tint" style="--x:64;--y:216;--w:336;--h:168"><h3>Prepare</h3><p>…</p></div>
  <div class="arrow" style="--x:400;--y:272;--w:72;--h:56">→</div>
  <div class="box bg-acc" style="--x:472;--y:216;--w:336;--h:168"><h3>Plant</h3><p>…</p></div>
</section>
```

## Density limits

Title: two lines (roughly 110 characters). Text block: 60 words. List: five bullets. Cards: four, 30 words each. Table: seven rows, five columns. One slide communicates one message; split when needed.
