// SheetJS CE for XLSX import (ADR-015): the pinned file in vendor/xlsx is the
// exact xlsx.mini.min.js that cdn.sheetjs.com serves for this version. Builds
// check it against the runtime's SRI digest before embedding it (offline,
// base64) or
// listing its licence (always: standard builds fetch it on demand).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { packageAt } from "../../shared/notices.mjs";
import { XLSX_VERSION, XLSX_INTEGRITY } from "../runtime/xlsx-reader.mjs";

const dir = new URL("../vendor/xlsx/", import.meta.url);
export const XLSX_FILE = new URL("xlsx.mini.min.js", dir);
export function verifyXLSX(bytes, version) {
  if (version !== XLSX_VERSION)
    throw new Error(
      `SheetJS: version ${version} unexpected; ${XLSX_VERSION} required`,
    );
  const digest =
    "sha384-" + createHash("sha384").update(bytes).digest("base64");
  if (digest !== XLSX_INTEGRITY)
    throw new Error(
      "SheetJS: the vendored file differs from the approved digest; verify the dependency before changing the SRI hash",
    );
}
export async function xlsxLibrary() {
  const bytes = await readFile(XLSX_FILE),
    { version } = JSON.parse(
      await readFile(new URL("package.json", dir), "utf8"),
    );
  verifyXLSX(bytes, version);
  // Base64: the file holds "<!--", which inline script text cannot carry
  // byte for byte.
  return bytes.toString("base64");
}
export const xlsxPackage = () =>
  packageAt(dir.pathname.replace(/\/$/, ""), [XLSX_FILE.pathname]);
