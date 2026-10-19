#!/usr/bin/env python3
"""Fetch public assessment workbooks outside the checkout; never run workbook macros."""
import hashlib,io,json,sys,urllib.request,zipfile
from pathlib import Path
here=Path(__file__).resolve().parent
root=here.parents[3]
output=Path(sys.argv[1]).resolve()
if output.is_relative_to(root): raise SystemExit('Keep source workbooks outside the repository')
output.mkdir(parents=True,exist_ok=True)
local=[]
for spec in json.loads((here/'sources.json').read_text()):
    dest=output/(spec['id']+spec['extension'])
    if not dest.exists():
        data=urllib.request.urlopen(spec['url']).read()
        if 'zipMember' in spec:
            with zipfile.ZipFile(io.BytesIO(data)) as z: data=z.read(spec['zipMember'])
        dest.write_bytes(data)
    if hashlib.sha256(dest.read_bytes()).hexdigest()!=spec['sha256']: raise SystemExit('Source digest mismatch: '+spec['id'])
    local.append({'id':spec['id'],'file':str(dest),'description':spec['description'],'source':{'url':spec['url'],'sha256':spec['sha256']},'rowLimit':spec['rowLimit']})
(output/'measurement-sources.json').write_text(json.dumps(local,indent=2)+'\n')
print('Verified five public workbooks; local manifest:',output/'measurement-sources.json')
