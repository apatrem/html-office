// One rendering for both formats (ADR-016 §5): the final file becomes a PDF, and the PDF becomes
// page images. Only the first step differs, because each format has one program that reads it:
//   html-slides → PDF: the skill's own export, in Chromium (plugin/skills/html-slides/tools/deck.mjs pdf);
//   .pptx → PDF: Microsoft PowerPoint, driven by AppleScript (what a recipient's PowerPoint shows);
//   PDF → PNG: the system's PDFKit, the same for both.
// macOS only. Nothing is installed: PowerPoint must already be on the machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SCRIPTS = path.join(HERE, '../scripts');
export const IMAGE_WIDTH = 1600;

const failure = result => (result.error ? String(result.error.message) : (result.stderr || result.stdout || `exit ${result.status}`).trim());

export function htmlToPdf(file, pdf) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'plugin/skills/html-slides/tools/deck.mjs'), 'pdf', file, pdf], { encoding: 'utf8', timeout: 180000 });
  return result.status === 0 && fs.existsSync(pdf) ? { ok: true } : { ok: false, error: failure(result) };
}

// PowerPoint is one application for the whole machine: conversions must not overlap. The deck is
// copied under a name no other presentation has, so that only that copy is closed.
export function pptxToPdf(file, pdf) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ppt-'));
  const name = `gate-${crypto.randomBytes(6).toString('hex')}.pptx`;
  try {
    fs.copyFileSync(file, path.join(stage, name));
    const out = path.join(stage, 'deck.pdf');
    const result = spawnSync('osascript', [path.join(SCRIPTS, 'pptx2pdf.applescript'), path.join(stage, name), out, name], { encoding: 'utf8', timeout: 200000 });
    if (result.status !== 0 || !fs.existsSync(out)) return { ok: false, error: failure(result) };
    fs.copyFileSync(out, pdf);
    return { ok: true };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

// Returns the page images, in page order.
export function pdfToImages(pdf, folder, width = IMAGE_WIDTH) {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const out = execFileSync('osascript', ['-l', 'JavaScript', path.join(SCRIPTS, 'pdf2png.js'), pdf, folder, String(width)], { encoding: 'utf8', timeout: 180000 });
  return out.split('\n').filter(Boolean).map(line => line.replace(/ \d+x\d+$/, ''));
}

// "The file opens" (ADR-016 §6): it converts to a PDF of at least one page.
export function render(format, file, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const pdf = path.join(folder, 'deck.pdf');
  fs.rmSync(pdf, { force: true });
  const converted = format === 'pptx' ? pptxToPdf(file, pdf) : htmlToPdf(file, pdf);
  if (!converted.ok) return { opens: false, error: converted.error, pdf: null, pages: [] };
  const pages = pdfToImages(pdf, path.join(folder, 'pages'));
  return pages.length ? { opens: true, pdf, pages } : { opens: false, error: 'the PDF has no page', pdf, pages };
}

export function renderingTools() {
  const version = (command, args) => { const r = spawnSync(command, args, { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  return {
    macOS: version('sw_vers', ['-productVersion']),
    powerpoint: version('defaults', ['read', '/Applications/Microsoft PowerPoint.app/Contents/Info', 'CFBundleShortVersionString']),
    chromium: 'Playwright, as required by the html-slides skill'
  };
}
