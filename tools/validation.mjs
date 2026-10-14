// Parses without a browser: no tag or resource of the document is executed.
// build.mjs bundles this module and parse5 into the plugin.
import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import {FORMAT_VERSION, ACTIVE_TAGS, attributeProblem, styleProblem, assetProblem} from '../src/format.js';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const attr = (n, k) => n.attrs?.find(a => a.name === k)?.value;
const children = n => (n.childNodes || []).filter(n => n.tagName);
const text = n => (n.childNodes || []).map(n => n.value || text(n)).join('');
const classes = n => (attr(n, 'class') || '').split(/\s+/);
const walk = function* (n) { yield n; for (const c of n.childNodes || []) yield* walk(c); if (n.content) yield* walk(n.content); };
const inDeck = n => attr(n, 'id') === 'deck' || !!(n.parentNode && inDeck(n.parentNode));
const slideOf = n => classes(n).includes('slide') ? attr(n, 'id') : n.parentNode && slideOf(n.parentNode);
export const scriptHash = s => createHash('sha256').update(s.trim()).digest('hex');
const DOC_META = ['format-version','docs-version','skill-version','repository','documentation','skill-download'].map(k=>'html-slides-'+k);

export function inspectHTML(html, trusted) {
  const doc = parse(html, {sourceCodeLocationInfo:true});
  const nodes = [...walk(doc)].filter(n => n.tagName);
  const out = [];
  const add = (n, msg) => out.push({level:'error',slide:slideOf(n) || '-',id:attr(n,'data-id') || null,msg});
  const zones = ['deck','engine','assets','theme','charte'];
  for (const id of zones) if (nodes.filter(n=>attr(n,'id')===id).length !== 1) add(doc, `Zone "${id}" missing or duplicated`);
  const main = nodes.find(n=>attr(n,'id')==='deck');
  if (main?.tagName !== 'main' || main.parentNode?.tagName !== 'body') add(doc, 'deck must be a main element directly inside body');
  if (!children(main || {}).some(n=>n.tagName==='section' && classes(n).includes('slide'))) add(doc,'The deck must contain at least one slide');
  const guides=nodes.filter(n=>attr(n,'id')==='html-slides-guide');
  const metadata={};
  for (const name of DOC_META) {
    const found=nodes.filter(n=>n.tagName==='meta' && attr(n,'name')===name);
    if (found.length>1) add(doc,`Duplicate metadata "${name}"`);
    if (found.length) {
      metadata[name]=attr(found[0],'content');
      if (found[0].parentNode?.tagName!=='head') add(found[0],'Documentation metadata must be in head');
    }
  }
  if (guides.length>1) add(doc,'Duplicate html-slides guide');
  if (!guides.length && Object.keys(metadata).length) add(doc,'Missing html-slides guide');
  if (guides.length) {
    const g=guides[0],pre=children(g.content || {});
    if (g.tagName!=='template' || g.parentNode?.tagName!=='head' || pre.length!==1 || pre[0].tagName!=='pre' || children(pre[0]).length)
      add(g,'Guide must be a template in head containing a text-only pre');
    if (metadata['html-slides-format-version']!==attr(g,'data-format-version') || metadata['html-slides-format-version']!==FORMAT_VERSION) add(g,'Guide format version inconsistent or unsupported');
    const version=metadata['html-slides-docs-version'];
    const engine=nodes.find(n=>attr(n,'id')==='engine');
    if (!version || version!==attr(g,'data-docs-version') || version!==attr(engine,'data-version') || metadata['html-slides-skill-version']!==version) add(g,'Documentation version incompatible with engine');
  }
  for (const name of DOC_META.slice(3)) if (metadata[name]) {
    try { if (new URL(metadata[name]).protocol!=='https:') throw new Error(); }
    catch { add(doc,`HTTPS URL required for "${name}"`); }
  }
  for (const n of nodes) {
    for (const a of n.attrs || []) {
      const problem = attributeProblem(a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value, n.namespaceURI === HTML_NS);
      if (problem) add(n, problem);
    }
    if (ACTIVE_TAGS.includes(n.tagName.toLowerCase())) add(n,`Forbidden tag <${n.tagName}>`);
    if (n.tagName==='meta' && attr(n,'http-equiv')) add(n,'meta http-equiv is forbidden');
    if (inDeck(n) && attr(n,'data-ui') !== undefined) add(n,'data-ui is reserved for the engine');
    if (n.tagName==='style' && !(n.parentNode?.tagName==='head' && ['theme','charte'].includes(attr(n,'id')))) add(n,'Styles outside theme zones are forbidden');
    else if (n.tagName==='style') { const problem = styleProblem(text(n)); if (problem) add(n, problem); }
    if (n.tagName==='script') {
      const id=attr(n,'id'), body=n.parentNode?.tagName==='body';
      if (attr(n,'src') !== undefined) add(n,'External script tags are forbidden');
      if (body && (id==='engine' || id==='echarts')) {
        if (!(trusted[id] || []).includes(scriptHash(text(n)))) add(n,`Unrecognised script "${id}"; plugin engine required`);
      } else if (attr(n,'type')==='application/json' && (body && id==='assets' || inDeck(n) && n.parentNode?.tagName==='figure' && classes(n.parentNode).includes('chart'))) {
        try {
          const data=JSON.parse(text(n));
          if (id==='assets') {
            if (!data || typeof data!=='object' || Array.isArray(data)) add(n,'assets must be a JSON object');
            else for (const [key,a] of Object.entries(data)) {
              const problem = assetProblem(key, a);
              if (problem) add(n, problem);
            }
          }
        } catch { add(n,'Invalid JSON'); }
      } else add(n,'Scripts allowed only in engine, assets and chart data zones');
    }
    if (n.parentNode?.tagName==='body' && !['main','script'].includes(n.tagName)) add(n,'Element outside deck zones');
  }
  return {doc, main, out, n:children(main || {}).filter(n=>classes(n).includes('slide')).length};
}

// Compares structure and explicit positions independently of attribute order.
export function snapshot(html) {
  const doc=parse(html);
  const main=[...walk(doc)].find(n=>attr(n,'id')==='deck');
  const elements={}, slides={}, errors=[];
  for (const [index,s] of children(main || {}).filter(n=>classes(n).includes('slide')).entries()) {
    const id=attr(s,'id');
    if (!id || slides[id]) { errors.push('Missing or duplicate slide identifier'); continue; }
    slides[id]={index, layout:attr(s,'data-layout') || 'default', detached:attr(s,'data-detached') !== undefined, dark:classes(s).includes('dark'), ids:[]};
    for (const n of children(s).filter(n=>n.tagName!=='aside')) {
      const eid=attr(n,'data-id');
      if (!eid || elements[eid]) { errors.push(`slide ${id} : Missing or duplicate data-id`); continue; }
      const style=Object.fromEntries((attr(n,'style') || '').split(';').filter(Boolean).map(v=>v.split(':').map(x=>x.trim())));
      const pos=Object.fromEntries(Object.keys(style).sort().map(k=>[k,Number(style[k])]));
      elements[eid]={slide:id, pos, placement:classes(n).filter(c=>/^(w-|r4$|in-panel$)/.test(c)).sort()};
      slides[id].ids.push(eid);
    }
  }
  return {elements,slides,errors};
}
export function compareSnapshots(a,b,allow=new Set()) {
  const out=[];
  const add=(slide,id,msg)=>out.push({level:'error',slide,id,msg:msg+'; if intended: --allow '+(id || slide)});
  const permitted=(id,sid)=>allow.has(id) || allow.has(sid);
  for (const msg of [...a.errors,...b.errors]) add('-',null,msg);
  for (const [sid,s] of Object.entries(a.slides)) {
    if (allow.has(sid)) continue;
    const next=b.slides[sid];
    if (!next) { add(sid,null,'Slide deleted without permission'); continue; }
    if (['layout','detached','dark'].some(k=>s[k]!==next[k])) add(sid,null,'Layout changed without permission');
    const before=Object.keys(a.slides).filter(id=>!allow.has(id) && b.slides[id]);
    const after=Object.keys(b.slides).filter(id=>!allow.has(id) && a.slides[id]);
    if (before.indexOf(sid)!==after.indexOf(sid)) add(sid,null,'Slide order changed without permission');
    const oldIds=s.ids.filter(id=>!permitted(id,sid) && b.elements[id]?.slide===sid);
    const newIds=next.ids.filter(id=>!permitted(id,sid) && a.elements[id]?.slide===sid);
    if (JSON.stringify(oldIds)!==JSON.stringify(newIds)) add(sid,null,'Element order changed without permission');
  }
  for (const [id,e] of Object.entries(a.elements)) {
    if (permitted(id,e.slide)) continue;
    const next=b.elements[id];
    if (!next) add(e.slide,id,'Element deleted without permission');
    else if (JSON.stringify(e)!==JSON.stringify(next)) add(e.slide,id,'Position or placement changed without permission');
  }
  return out;
}
export function replaceParsedZone(html, id, content) {
  const doc=parse(html,{sourceCodeLocationInfo:true});
  const n=[...walk(doc)].find(n=>attr(n,'id')===id);
  if (!n?.sourceCodeLocation?.endTag) throw new Error(`Zone "${id}" not found`);
  const l=n.sourceCodeLocation;
  return html.slice(0,l.startTag.endOffset)+content+html.slice(l.endTag.startOffset);
}

// A migration renews the guide with the engine; pack keeps their version.
export function replaceDocumentation(html, fragment) {
  const doc=parse(html,{sourceCodeLocationInfo:true});
  const head=[...walk(doc)].find(n=>n.tagName==='head');
  const zones=children(head || {}).filter(n=>attr(n,'id')==='html-slides-guide' || n.tagName==='meta' && DOC_META.includes(attr(n,'name')));
  let out=html;
  for (const n of zones.sort((a,b)=>b.sourceCodeLocation.startOffset-a.sourceCodeLocation.startOffset)) {
    const l=n.sourceCodeLocation;
    out=out.slice(0,l.startOffset)+out.slice(l.endOffset);
  }
  const next=parse(out,{sourceCodeLocationInfo:true});
  const h=[...walk(next)].find(n=>n.tagName==='head');
  const anchor=children(h || {}).find(n=>n.tagName==='style')?.sourceCodeLocation?.startOffset || h?.sourceCodeLocation?.endTag?.startOffset;
  if (anchor===undefined) throw new Error('An explicit head is required to add the guide');
  return out.slice(0,anchor)+fragment.trim()+'\n'+out.slice(anchor);
}
