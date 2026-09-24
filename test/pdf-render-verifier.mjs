import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Polyfill for Node.js < 22 — Promise.withResolvers() was introduced in v22.
// pdfjs-dist >=6 uses it internally when instantiating PDFDocumentLoadingTask.
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

const [pdfPath, expectedQr, outputDir] = process.argv.slice(2);
if (!pdfPath)
  throw new Error('Usage: node test/pdf-render-verifier.mjs <pdfPath> [expectedQr] [outputDir]');

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjs.getDocument({
  data,
  disableWorker: true,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
}).promise;

const textParts = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  textParts.push(...content.items.map((item) => item.str ?? ''));
}

let qr = null;
if (expectedQr) {
  const page = await pdf.getPage(1);
  const scale = 4;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const cropSize = 700;
  const cropX = canvas.width - 650;
  const cropY = canvas.height - 650;
  const crop = ctx.getImageData(cropX, cropY, cropSize, cropSize);
  const decoded = jsQR(new Uint8ClampedArray(crop.data), crop.width, crop.height, {
    inversionAttempts: 'attemptBoth',
  });

  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(`${outputDir}/rendered-page.png`, canvas.toBuffer('image/png'));
    const cropCanvas = createCanvas(cropSize, cropSize);
    cropCanvas.getContext('2d').putImageData(crop, 0, 0);
    fs.writeFileSync(`${outputDir}/rendered-qr-crop.png`, cropCanvas.toBuffer('image/png'));
  }

  if (decoded) {
    const corners = decoded.location;
    const centerX =
      cropX +
      (corners.topLeftCorner.x +
        corners.topRightCorner.x +
        corners.bottomLeftCorner.x +
        corners.bottomRightCorner.x) /
        4;
    const centerY =
      cropY +
      (corners.topLeftCorner.y +
        corners.topRightCorner.y +
        corners.bottomLeftCorner.y +
        corners.bottomRightCorner.y) /
        4;
    qr = {
      decoded: decoded.data,
      matchesExpected: decoded.data === expectedQr,
      centerRatioX: centerX / canvas.width,
      centerRatioY: centerY / canvas.height,
    };
  }
}

console.log(
  JSON.stringify({
    pageCount: pdf.numPages,
    text: textParts.join(' '),
    qr,
  }),
);
