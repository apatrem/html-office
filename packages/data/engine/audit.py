#!/usr/bin/env python3
"""Reproduce the target-specific Cargo closure and retained licence texts. Developer tool only."""
import hashlib, html, json, re, subprocess, sys
from pathlib import Path
source, sysroot = map(Path, sys.argv[1:3])
here = Path(__file__).resolve().parent
metadata = json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--filter-platform','wasm32-unknown-unknown'],cwd=source))
tree = subprocess.check_output(['cargo','tree','--locked','-p','wasm','--target','wasm32-unknown-unknown','-e','normal,build','--prefix','none','--format','{p}'],cwd=source,text=True)
allowed = {'MIT','Apache-2.0','Zlib','Unlicense','BSL-1.0','Unicode-3.0'}
texts, packages = {}, []
def retain(label, text):
    text=text.strip()+'\n'
    digest=hashlib.sha256(text.encode()).hexdigest()
    if digest not in texts: texts[digest]={'labels':[], 'text':text}
    texts[digest]['labels'].append(label)
    return digest
for p in sorted(metadata['packages'],key=lambda p:(p['name'],p['version'])):
    if not re.search(r'^'+re.escape(p['name'])+' v'+re.escape(p['version'])+r'(?: |$)',tree,re.M): continue
    licence=p['license'] or ''
    tokens=set(re.findall(r'[A-Za-z0-9][A-Za-z0-9.-]*',licence))-{'OR','AND'}
    if not tokens or not tokens<=allowed: raise SystemExit(f'Unreviewed licence: {p["name"]}: {licence}')
    root=Path(p['manifest_path']).parent
    files=[x for x in root.iterdir() if x.is_file() and re.match(r'^(licen[cs]e|copying|notice)',x.name,re.I)]
    if (root/'licenses').is_dir(): files+=list((root/'licenses').glob('*'))
    if not files and p['source'] is None: files=list(source.glob('LICENSE*'))
    if not files and p['name']=='bitcode_derive' and p['version']=='0.6.9':
        files=[here/'license-sources/bitcode_derive-LICENSE-MIT']
    if not files: raise SystemExit(f'Missing licence text: {p["name"]}')
    retained=[retain(f'{p["name"]}@{p["version"]}/{f.name}',f.read_text()) for f in sorted(files) if f.is_file()]
    packages.append({'name':p['name'],'version':p['version'],'license':licence,'repository':p['repository'],'noticeHashes':retained})
# Retain the Rust distribution's standard-library notices, including all out-of-tree
# licence texts, conservatively including targets not compiled into this WASM.
stdlib=sysroot/'share/doc/rust/COPYRIGHT-library.html'
s=stdlib.read_text()
intro=s.split('<h2 id="out-of-tree-dependencies">')[0]
intro=re.sub('<[^>]+>',' ',intro)
retain('Rust 1.95.0 standard-library copyright/attributions',html.unescape(intro))
for i,pre in enumerate(re.findall(r'<pre>(.*?)</pre>',s,re.S)):
    retain(f'Rust 1.95.0 standard-library notice {i+1}',html.unescape(re.sub('<[^>]+>','',pre)))
for name in ['MIT.txt','Apache-2.0.txt','Unicode-3.0.txt','BSD-2-Clause.txt','LLVM-exception.txt']:
    retain('Rust 1.95.0 '+name,(sysroot/'share/doc/rust/licenses'/name).read_text())
notices='HTML Office typed IronCalc build — third-party notices\n\nIronCalc 0.9.0 source commit 297553dc3a37ec6b0f4821055220e3d26c4ac6a1; narrow custom WASM binding exposes getCellValue (see typed-binding.rs). No calculation semantics are intentionally changed.\n\n'
for digest,item in sorted(texts.items()): notices+='\n'.join(item['labels'])+'\n'+item['text']+'\n'
(here/'THIRD-PARTY-NOTICES.txt').write_text(notices)
report={'sourceCommit':'297553dc3a37ec6b0f4821055220e3d26c4ac6a1','target':'wasm32-unknown-unknown','features':'wasm default; no xlsx','rust':'1.95.0','wasmBindgen':'0.2.126','binaryen':'132.0.0','closure':'normal + build dependencies; proc-macro/build crates conservatively included; dev-only and other target dependencies excluded','packages':packages,'stdlibCopyrightSha256':hashlib.sha256(stdlib.read_bytes()).hexdigest(),'noticeBytes':len(notices.encode()),'noticesSha256':hashlib.sha256(notices.encode()).hexdigest()}
(here/'dependency-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'{len(packages)} packages; {len(texts)} retained notice texts; {len(notices.encode())} notice bytes')
