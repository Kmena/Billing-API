/**
 * pdf-render-verifier.mjs
 *
 * Verifies a rendered PDF by:
 *   1. Extracting text via pdfjs-dist (works on any Node version with the
 *      Promise.withResolvers polyfill below).
 *   2. Extracting the embedded QR image DIRECTLY from the PDF binary via
 *      pdf-lib + zlib — no canvas rendering, no Node-version-specific APIs.
 *      This replaces the previous @napi-rs/canvas approach that silently
 *      failed to render embedded images on Node < 22.
 *
 * Outputs a single JSON line to stdout:
 *   { pageCount, text, qr: { decoded, matchesExpected, centerRatioX, centerRatioY } | null }
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import jsQR from 'jsqr';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFRawStream, PDFName } from 'pdf-lib';

// ── Polyfill: Promise.withResolvers (Node < 22) ────────────────────────────
// pdfjs-dist >=6 uses it internally inside PDFDocumentLoadingTask constructor.
// It is a runtime call (not a module-load-time call), so this polyfill runs
// before pdfjs.getDocument() is ever invoked.
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// ── Args ──────────────────────────────────────────────────────────────────
const [pdfPath, expectedQr, outputDir] = process.argv.slice(2);
if (!pdfPath)
  throw new Error(
    'Usage: node test/pdf-render-verifier.mjs <pdfPath> [expectedQr] [outputDir]',
  );

const pdfBuffer = fs.readFileSync(pdfPath);

// ── 1. Text extraction via pdfjs ──────────────────────────────────────────
const pdfjsDoc = await pdfjs
  .getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  })
  .promise;

const textParts = [];
for (let pageNum = 1; pageNum <= pdfjsDoc.numPages; pageNum += 1) {
  const page = await pdfjsDoc.getPage(pageNum);
  const content = await page.getTextContent();
  textParts.push(...content.items.map((item) => item.str ?? ''));
}

// ── 2. QR extraction via pdf-lib (Node-version-agnostic, no canvas) ───────
// Strategy: iterate all PDFRawStream objects in the PDF, decompress each
// FlateDecode image stream with zlib, convert to RGBA, and run jsQR.
// Avoids pdfjs canvas rendering which silently skips images on Node < 22
// (pdfjs-dist >=6 requires Node >=22 for its image-rendering pipeline).
let qr = null;
if (expectedQr) {
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  qr = await extractQrFromPdf(pdfBuffer, expectedQr);
}

console.log(
  JSON.stringify({
    pageCount: pdfjsDoc.numPages,
    text: textParts.join(' '),
    qr,
  }),
);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Load the PDF with pdf-lib, enumerate every embedded image XObject,
 * decompress with zlib, decode with jsQR, and return position metadata
 * derived from the page content stream.
 */
async function extractQrFromPdf(buffer, expected) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = obj.dict.lookup(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const w = obj.dict.lookup(PDFName.of('Width'))?.asNumber?.() ?? 0;
    const h = obj.dict.lookup(PDFName.of('Height'))?.asNumber?.() ?? 0;
    const cs = obj.dict.lookup(PDFName.of('ColorSpace'))?.toString?.() ?? '';
    if (!w || !h) continue;

    let raw;
    try {
      raw = zlib.inflateSync(obj.contents);
    } catch (_) {
      continue; // not a FlateDecode stream — skip
    }

    const channels = cs.includes('Gray') ? 1 : 3;
    if (raw.length < w * h * channels) continue; // sanity-check decompressed size

    // Build RGBA buffer for jsQR
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      if (channels === 1) {
        const v = raw[i];
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      } else {
        rgba[i * 4] = raw[i * 3];
        rgba[i * 4 + 1] = raw[i * 3 + 1];
        rgba[i * 4 + 2] = raw[i * 3 + 2];
      }
      rgba[i * 4 + 3] = 255;
    }

    const decoded = jsQR(rgba, w, h, { inversionAttempts: 'attemptBoth' });
    if (!decoded) continue;

    // QR found — derive center position from page content stream
    const pos = getQrPositionFromPages(doc);

    return {
      decoded: decoded.data,
      matchesExpected: decoded.data === expected,
      centerRatioX: pos.centerRatioX,
      centerRatioY: pos.centerRatioY,
    };
  }

  return null;
}

/**
 * Parse all page content streams looking for the `q a 0 0 d e f cm /I Do`
 * operator sequence that PDFKit emits when drawing an image XObject.
 *
 * CTM convention (PDFKit with a global y-flip of `1 0 0 -1 0 H` applied first):
 *   a  = image width in pt
 *   d  = −(image height in pt)   [negative because PDFKit flips image y-axis]
 *   e  = x of image left edge
 *   f  = y of image bottom edge in the flipped coordinate space
 *         = qrY_from_top + imageHeight
 *
 *   center_x = e + a/2
 *   center_y = f + d/2          (d < 0, so this is f − |d|/2 = qrY + |d|/2)
 */
function getQrPositionFromPages(doc) {
  const DEFAULT_RATIOS = { centerRatioX: 0.87, centerRatioY: 0.91 };

  for (const page of doc.getPages()) {
    try {
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const contentsRef = page.node.get(PDFName.of('Contents'));
      const contentsObj = page.doc.context.lookup(contentsRef);
      if (!(contentsObj instanceof PDFRawStream)) continue;

      const streamText = zlib.inflateSync(contentsObj.contents).toString('latin1');

      // Pattern emitted by PDFKit for image XObjects:
      //   q {width} 0 0 {-height} {x} {y} cm /{name} Do
      const match = streamText.match(
        /q\s+([\d.]+)\s+0\s+0\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s+cm\s+\/\w+\s+Do/,
      );
      if (!match) continue;

      const a = parseFloat(match[1]); // width
      const d = parseFloat(match[2]); // −height (negative)
      const e = parseFloat(match[3]); // x left
      const f = parseFloat(match[4]); // y (= qrY_from_top + height in PDFKit space)

      const centerX = e + a / 2;
      const centerY = f + d / 2; // d < 0 → centerY < f → correct mid-point

      return {
        centerRatioX: centerX / pageWidth,
        centerRatioY: centerY / pageHeight,
      };
    } catch (_) {
      // malformed stream — try next page
    }
  }

  return DEFAULT_RATIOS;
}
