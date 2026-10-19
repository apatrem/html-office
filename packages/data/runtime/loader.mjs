export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function verify(bytes,expected){if(await sha256(bytes)!==expected)throw new Error('Engine integrity check failed. Nothing was executed.');return bytes;}
function decode(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export async function loadEngine(config,{signal}={}){
  async function component(name){
    const item=config[name];
    if(config.embedded?.[name])return verify(decode(config.embedded[name]),item.sha256);
    const response=await fetch(item.url,{signal,credentials:'omit',referrerPolicy:'no-referrer',mode:'cors'});
    if(!response.ok)throw new Error(`Engine download failed (${response.status}). Your attempted edit is retained.`);
    return verify(await response.arrayBuffer(),item.sha256);
  }
  // Both components must pass integrity before any downloaded JS executes.
  const [js,wasm]=await Promise.all([component('js'),component('wasm')]);
  signal?.throwIfAborted();
  const url=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
  try{const module=await import(url);const exports=await module.default({module_or_path:wasm});signal?.throwIfAborted();return {...module,wasmMemory:exports.memory};}
  finally{URL.revokeObjectURL(url);}
}
