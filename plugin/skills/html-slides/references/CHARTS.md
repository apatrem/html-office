# html-slides charts

Each chart is a `<figure class="chart" data-type="…">` containing JSON data.

| Shared field | Purpose |
| --- | --- |
| `title` | Bold chart title with a rule |
| `unit` | Unit below the title; required except Gantt (e.g. hours, EUR, %) |
| `decimals` | Displayed decimal places (otherwise up to one) |
| `prefix`, `suffix` | Text around numbers (e.g. +, %) |
| `highlight` | One focal emphasis: category index (zero-based) or name; others become neutral |

Sources belong on the slide (`<p class="source">`), not in chart JSON. Place charts in `w-8` with `w-4` commentary or at full width.

Without embedded ECharts, the engine loads version 6.1.0 from jsDelivr on opening, using pinned SHA-384 SRI and anonymous CORS. Received bytes must match the approved digest. If loading is rejected/unavailable, cached SVGs remain visible but data cannot be recalculated. `pack --offline` embeds the library; SRI itself does not prevent the external request.

## Choose a type

| Message | Type |
| --- | --- |
| Ranking | `hbar` |
| Change across ≤6 periods, few values | `column` |
| Change across >6 periods | `line` |
| Composition or mix | `stacked` (`percent` optional) |
| Bridge between values or gap breakdown | `waterfall` |
| Three-variable relationship | `bubble` |
| Schedule or activity sequence | `gantt` |

Use 100% `stacked` or `hbar` instead of a pie chart.

## column, hbar, line, stacked — categories × series

```json
{"title":"Weekly volunteer time","unit":"hours","categories":["Watering","Planting","Other"],
 "series":[{"name":"Week 1","values":[12,8,4]}],"highlight":0}
```

Each series has one value per category. Multiple series create a legend. Arrays must be non-empty; numbers must be finite. `null` explicitly represents a missing point, not invalid numeric input. Invalid types, `NaN`, and non-numeric values are rejected.

- `stacked`: `"percent": true` for 100%; `"horizontal": true` for horizontal bars; `"totals": false` to hide totals.
- `line`: `"labels": "last" | "all" | "none"` (default: end labels with value/name); `"scale": true` for a non-zero-based axis.

## waterfall

```json
{"title":"Weekly time plan","unit":"hours","decimals":0,"increase":"good","items":[
  {"label":"Current time","value":20,"total":true},
  {"label":"New volunteers","value":6},
  {"label":"Shared tools","value":-2},
  {"label":"Planned time","total":true}]}
```

`total: true` is a level bar; optional `value` is calculated if absent. Other rows are signed changes. Default colours: increases orange (unfavourable), decreases blue. Use `"increase": "good"` when an increase is favourable.

## bubble

```json
{"title":"Garden activities","unit":"Bubble size: volunteer hours",
 "xLabel":"Preparation","xUnit":"days","yLabel":"Participants","yUnit":"people",
 "xRef":3,"yRef":15,"highlight":["Planting day"],
 "points":[{"name":"Planting day","x":2,"y":24,"size":12},
 {"name":"Tool care","x":1,"y":8,"size":4},
 {"name":"Seed exchange","x":3,"y":16,"size":6}]}
```

`xRef`/`yRef` add dashed thresholds. `highlight` accepts a name or list of names. Prefer 3–10 points to keep labels readable.

## gantt

```json
{"title":"Season plan","tasks":[
  {"name":"Prepare beds","start":"2027-02","end":"2027-03","group":"Prepare"},
  {"name":"Plant seedlings","start":"2027-04","end":"2027-05","group":"Plant"},
  {"name":"Open garden day","start":"2027-06"}]}
```

Dates use `YYYY-MM` (whole month) or `YYYY-MM-DD`. Without `end`, a task is a diamond milestone. Dates must exist in the calendar; end cannot precede start. `group` colours bars and adds a legend; task `"highlight": true` uses orange.

## Add a type

Create `src/charts/<type>.js` exporting `label`, `validate(data)`, `table`, and `toOption(data, theme)`. Register it in `src/engine/charts.js` and rebuild. Use `upgrade` then `pack` for existing decks. Validators must return diagnostics even for malformed JSON roots. Document an example here and test invalid data.
