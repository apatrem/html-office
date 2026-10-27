import fs from 'node:fs';
import path from 'node:path';
import {LAYOUTS, SHAPES, CHART_TYPES, chartHTML} from '../src/engine/templates.js';
import {FORMAT_VERSION, CONTENT_CLASSES, THEMES, DECK_FONTS} from '../src/format.js';
import {ECHARTS_URL, ECHARTS_INTEGRITY} from '../packages/shared/charts/echarts.mjs';

const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function documentation(root, version) {
  const read = f => fs.readFileSync(path.join(root,f),'utf8').trim();
  const config=JSON.parse(read('src/distribution.json'));
  const meta=[['format-version',FORMAT_VERSION],['docs-version',version],['skill-version',version]];
  for (const [key,name] of [['repository','repository'],['documentationUrl','documentation'],['skillDownloadUrl','skill-download']]) {
    const value=config[key];
    if (value == null || value==='') continue;
    if (typeof value!=='string' || new URL(value).protocol!=='https:') throw new Error(`src/distribution.json : ${key} must be an HTTPS URL`);
    meta.push([name,value]);
  }
  const refs='plugin/skills/html-slides/references/';
  const format=read(refs+'FORMAT.md').split('## Slides\n')[1];
  const catalogue=read(refs+'CATALOGUE.md').split('## Layouts\n')[1];
  const charts=read(refs+'CHARTS.md').split('\n## Add a type')[0];
  if (!format || !catalogue) throw new Error('Guide sections missing from FORMAT/CATALOGUE');
  const examples=CHART_TYPES.map(([type,label])=>{
    const data=JSON.parse(chartHTML(type).match(/<script type="application\/json">([\s\S]*?)<\/script>/)[1]);
    return `### Data example: ${type}\n\nType \`${type}\` — ${label}.\n\n\`\`\`json\n${JSON.stringify(data,null,2)}\n\`\`\``;
  }).join('\n\n');
  const inventory = `Layouts : ${LAYOUTS.map(([x])=>'`'+x+'`').join(', ')}.\nShapes: ${SHAPES.map(([x])=>'`'+x+'`').join(', ')}.\nCharts: ${CHART_TYPES.map(([x])=>'`'+x+'`').join(', ')}.\nAllowed content classes: ${CONTENT_CLASSES.map(x=>'`'+x+'`').join(', ')}.\nDeck themes (\`main[data-theme]\`): ${THEMES.map(x=>'`'+x+'`').join(', ')}. Deck fonts (\`main[data-font]\`): ${DECK_FONTS.map(x=>'`'+x+'`').join(', ')}.`;
  const text=[read('src/guide.md'),`Format ${FORMAT_VERSION} · Documentation ${version} · Skill ${version}.\n\n${inventory}\n\nChart library: ${ECHARTS_URL}\nCDN integrity: \`${ECHARTS_INTEGRITY}\`.`,
    '# Format reference\n\n## Slides\n'+format,
    '# Catalogue\n\n## Layouts\n'+catalogue,
    charts,'# Complete data examples\n\n'+examples].join('\n\n');
  const html=meta.map(([k,v])=>`<meta name="html-slides-${k}" content="${escape(v)}">`).join('\n')+
    `\n<template id="html-slides-guide" data-format-version="${FORMAT_VERSION}" data-docs-version="${escape(version)}"><pre>\n${escape(text)}\n</pre></template>`;
  return {html,text};
}
