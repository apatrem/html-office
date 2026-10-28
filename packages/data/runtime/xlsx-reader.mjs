// Reads an XLSX file with SheetJS CE (ADR-015), part of the import chunk.
// The library is pinned: offline builds embed it (script#xlsx-source, base64,
// checked at build time), standard builds fetch it from the vendor's CDN only
// when an XLSX file is picked. Either way the SHA-384 of its bytes is checked
// before it runs, and
// it runs only in a worker whose network functions are removed, with the
// file's bytes; the page receives plain data (model/xlsx.mjs › summarise).
import { READ_OPTIONS, XLSX_LIMITS, summarise } from "../model/xlsx.mjs";

export const XLSX_VERSION = "0.20.3";
export const XLSX_URL = `https://cdn.sheetjs.com/xlsx-${XLSX_VERSION}/package/dist/xlsx.mini.min.js`;
export const XLSX_INTEGRITY =
  "sha384-NG/W3xvO3ynQEcDQYIOcZTXRtwUs83cLv1FIl9PuqWPDuNhsMRF6wutlNLFwlb71";

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-384", bytes));
  return "sha384-" + btoa(String.fromCharCode(...hash));
}
let library = null;
function libraryText() {
  library ??= (async () => {
    const embedded = document.getElementById("xlsx-source");
    let bytes;
    if (embedded?.type === "text/plain")
      bytes = Uint8Array.from(atob(embedded.textContent.trim()), (c) =>
        c.charCodeAt(0),
      );
    else {
      let response;
      try {
        response = await fetch(XLSX_URL, {
          integrity: XLSX_INTEGRITY,
          credentials: "omit",
          mode: "cors",
          referrerPolicy: "no-referrer",
        });
      } catch {
        throw new Error(
          "The XLSX reader could not be loaded (no connection, blocked, or it failed its integrity check). Nothing was run. An offline build imports XLSX without a connection.",
        );
      }
      if (!response.ok)
        throw new Error(
          `The XLSX reader could not be downloaded (${response.status}). Nothing was run.`,
        );
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if ((await digest(bytes)) !== XLSX_INTEGRITY)
      throw new Error(
        "The XLSX reader failed its integrity check. Nothing was run.",
      );
    return bytes;
  })().catch((error) => {
    library = null;
    throw error;
  });
  return library;
}
// The worker: network functions removed before the library is defined, then
// one read of the bytes it receives.
const PRELUDE =
  'for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker"]) try { self[k] = undefined; } catch {}\n';
const BODY = `
self.onmessage = (event) => {
  try {
    const wb = XLSX.read(new Uint8Array(event.data), ${JSON.stringify(READ_OPTIONS)});
    self.postMessage({ summary: (${summarise.toString()})(XLSX, wb, ${JSON.stringify(XLSX_LIMITS)}) });
  } catch (error) {
    self.postMessage({ error: String((error && error.message) || error) });
  }
};`;
// The worker script around the library (bytes, or text in tests).
export const workerParts = (library) => [PRELUDE, library, "\n;", BODY];

// What the first bytes say about a file that should be an XLSX workbook.
export function checkSignature(bytes, name) {
  const b = bytes;
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return;
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)
    throw new Error(
      `${name} is password-protected or an Excel 97–2003 workbook (.xls). Remove the password or save it as .xlsx, then import it.`,
    );
  throw new Error(`${name} is not an XLSX workbook.`);
}

// Resolves with the summary of the workbook; `signal` stops the worker.
export async function readXLSX(bytes, { name = "The file", signal } = {}) {
  if (bytes.byteLength > XLSX_LIMITS.bytes)
    throw new Error(
      `${name} is larger than ${XLSX_LIMITS.bytes / 1024 / 1024} MB, the import limit.`,
    );
  checkSignature(bytes, name);
  const library = await libraryText();
  signal?.throwIfAborted();
  const url = URL.createObjectURL(
      new Blob(workerParts(library), { type: "text/javascript" }),
    ),
    worker = new Worker(url);
  return new Promise((resolve, reject) => {
    const done = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      done();
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      done();
      if (data.error)
        reject(new Error(`${name} cannot be read: ${data.error}`));
      else resolve(data.summary);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      done();
      reject(
        new Error(
          `${name} cannot be read${event.message ? `: ${event.message}` : "."}`,
        ),
      );
    };
    const copy = bytes.slice().buffer;
    worker.postMessage(copy, [copy]);
  });
}
