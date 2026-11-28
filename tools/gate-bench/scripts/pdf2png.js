// Renders every page of a PDF to a PNG with the system's PDFKit, for the gate bench (ADR-016 §5).
// One path for both formats: whatever produced the PDF, its pages become images here.
//   osascript -l JavaScript pdf2png.js <file.pdf> <output folder> [width in pixels, default 1600]
// Prints one line per page: "<path> <width>x<height>".
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('Quartz');

function run(argv) {
  const pdfPath = argv[0], outDir = argv[1], width = Number(argv[2] || 1600);
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdfPath));
  if (doc.isNil()) throw new Error('cannot open ' + pdfPath);
  const lines = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAtIndex(i);
    const box = page.boundsForBox($.kPDFDisplayBoxMediaBox);
    const height = Math.round(width * box.size.height / box.size.width);
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, width, height, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);
    const context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext(context);
    $.NSColor.whiteColor.setFill;
    $.NSRectFill($.NSMakeRect(0, 0, width, height));
    const cg = context.CGContext;
    $.CGContextScaleCTM(cg, width / box.size.width, height / box.size.height);
    $.CGContextTranslateCTM(cg, -box.origin.x, -box.origin.y);
    page.drawWithBoxToContext($.kPDFDisplayBoxMediaBox, cg);
    $.NSGraphicsContext.restoreGraphicsState;
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
    const out = outDir + '/page-' + String(i + 1).padStart(2, '0') + '.png';
    if (!png.writeToFileAtomically(out, true)) throw new Error('cannot write ' + out);
    lines.push(out + ' ' + width + 'x' + height);
  }
  return lines.join('\n');
}
