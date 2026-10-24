// Outline icons drawn for the html-office shell mock-ups (no icon library).
// Only icons with a working command ship; later tasks add theirs.
export const ICONS = {
  undo: '<path d="M7 5 3 9l4 4"/><path d="M3 9h9a4 4 0 0 1 0 8H9"/>',
  redo: '<path d="m13 5 4 4-4 4"/><path d="M17 9H8a4 4 0 0 0 0 8h3"/>',
  eraser:
    '<path d="m4 13 7-7 5 5-5 5H7z"/><path d="M9 16.5h8"/><path d="m7.5 9.5 5 5"/>',
  condfmt:
    '<rect x="3" y="3.5" width="14" height="13" rx="1"/><path d="M6 13V9.5M9 13V7M12 13v-2M15 13V8" stroke-width="2"/>',
  gridlines:
    '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 8h13M3.5 12.3h13M8 3.5v13M12.3 3.5v13"/>',
  menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
  caret: '<path d="m6 8 4 4 4-4"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  save: '<path d="M4 3.5h9.5l2.5 2.5v10.5H4z"/><path d="M7 3.5v3.5h5.5V3.5"/><rect x="6.5" y="11" width="7" height="5.5"/>',
  fill: '<path d="m5 9 5-5 6 6-5 5z"/><path d="M16.5 12.5c.8 1.2 1.2 2 1.2 2.5a1.2 1.2 0 0 1-2.4 0c0-.5.4-1.3 1.2-2.5z"/>',
  borders:
    '<rect x="3.5" y="3.5" width="13" height="13" rx="1"/><path d="M10 3.5v13M3.5 10h13" stroke-dasharray="1.5 1.8"/>',
  alignL: '<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>',
  alignC: '<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>',
  alignR: '<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>',
  across:
    '<path d="M2.5 4v12M17.5 4v12"/><path d="M5 10h10"/><path d="m7 7.5-2.5 2.5L7 12.5M13 7.5l2.5 2.5-2.5 2.5"/>',
  wrap: '<path d="M3 5h14"/><path d="M3 10h11a2.8 2.8 0 0 1 0 5.6H10"/><path d="m11.5 13.8-1.8 1.8 1.8 1.8"/><path d="M3 15.5h4"/>',
  link: '<path d="m8.2 11.8 3.6-3.6"/><path d="m9 6.3 1.3-1.3a3.2 3.2 0 0 1 4.6 4.6l-1.3 1.3"/><path d="m11 13.7-1.3 1.3a3.2 3.2 0 0 1-4.6-4.6l1.3-1.3"/>',
  painter:
    '<rect x="4" y="3" width="10" height="5" rx="1"/><path d="M14 5.5h2v4h-6v3"/><rect x="9" y="12.5" width="2" height="5" rx=".5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  bAll: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M10 3.5v13M3.5 10h13"/>',
  bOuter:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><rect x="3.5" y="3.5" width="13" height="13"/>',
  bInner:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13"/>',
  bTop: '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M3.5 3.5h13"/>',
  bBottom:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M3.5 16.5h13"/>',
  bLeft:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M3.5 3.5v13"/>',
  bRight:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M16.5 3.5v13"/>',
  bNone:
    '<rect x="3.5" y="3.5" width="13" height="13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/><path d="M10 3.5v13M3.5 10h13" stroke-opacity=".35" stroke-dasharray="1.5 1.8"/>',
  styles:
    '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1" fill="currentColor" opacity=".45"/><rect x="11" y="11" width="5.5" height="5.5" rx="1"/>',
  sliders:
    '<path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--ui-bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--ui-bg)"/>',
  globe:
    '<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/><path d="M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17c-2-2-2.8-4.4-2.8-7S8 5 10 3z"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  // Slides (U04-Slides): insert, slide, element and mode commands.
  textbox:
    '<rect x="3" y="4" width="14" height="12" rx="1" stroke-dasharray="2 1.6"/><path d="M7 8h6M10 8v5"/>',
  shape:
    '<rect x="3" y="8" width="8" height="8" rx=".8"/><circle cx="13" cy="7" r="4"/>',
  block:
    '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 8.5h8M6 11.5h5"/>',
  image:
    '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.3" cy="8" r="1.4"/><path d="m3.5 14.5 4-4 3.5 3.5 2-2 3.5 3.5"/>',
  table:
    '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 8h14M3 12h14M8 4v12"/>',
  chart:
    '<path d="M3 16.5h14"/><path d="M5 15V10M8.5 15V6M12 15v-4M15.5 15V7.5" stroke-width="2.2"/>',
  layout:
    '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M8.5 4v12M8.5 9h8.5"/>',
  reset:
    '<path d="M4.5 9.5A5.5 5.5 0 1 0 6.2 5.6"/><path d="M4.2 3.5v3.3h3.3"/>',
  footer:
    '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M5.5 13.5h6M14 13.5h.5"/>',
  arrange:
    '<path d="M12 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h4"/><rect x="8" y="8" width="9" height="9" rx="1"/>',
  copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>',
  rowAdd:
    '<rect x="3" y="3.5" width="14" height="6" rx="1"/><path d="M10 12.5v5M7.5 15h5"/>',
  rowDel:
    '<rect x="3" y="3.5" width="14" height="6" rx="1"/><path d="M7.5 15h5"/>',
  colAdd:
    '<rect x="3.5" y="3" width="6" height="14" rx="1"/><path d="M12.5 10h5M15 7.5v5"/>',
  colDel:
    '<rect x="3.5" y="3" width="6" height="14" rx="1"/><path d="M12.5 10h5"/>',
  play: '<path d="M6.5 4.5 15.5 10l-9 5.5z"/>',
  pen: '<path d="m13.5 3.5 3 3L8 15H5v-3z"/><path d="m11.5 5.5 3 3"/>',
  print:
    '<path d="M6 7.5V3.5h8v4"/><rect x="3" y="7.5" width="14" height="6.5" rx="1"/><path d="M6 11.5h8v5H6z"/>',
};
