// Run after the documented locked Rust/wasm-bindgen build; never bundle an unverified CDN response.
import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const source=resolve(process.argv[2]??'work/ironcalc-bindgen');
const destination=process.argv[3]?new URL('file://'+resolve(process.argv[3])+'/'):new URL('../engine/vendor/',import.meta.url);
await mkdir(destination,{recursive:true});
await build({entryPoints:[`${source}/wasm.js`],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'none',outfile:new URL('ironcalc.mjs',destination).pathname});
await copyFile(`${source}/wasm_bg.wasm`,new URL('ironcalc.wasm',destination));
