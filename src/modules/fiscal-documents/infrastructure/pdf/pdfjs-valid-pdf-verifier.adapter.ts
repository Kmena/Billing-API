import { Injectable } from '@nestjs/common';
import {
  ExpectedPdfIdentity,
  PDF_MAX_SIZE_BYTES_DEFAULT,
  PdfValidationError,
  PdfValidationLimits,
  ValidPdfVerifier,
  VerifiedPdf,
} from '../../application/pdf/valid-pdf-verifier.port';
import { HISTORICAL_MOCK_PDF_MARKER } from '../../application/pdf/fiscal-pdf-version-policy';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const importEsm = Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<PdfJsModule>;

const loadPdfJs = (): Promise<PdfJsModule> => importEsm('pdfjs-dist/legacy/build/pdf.mjs');

@Injectable()
export class PdfjsValidPdfVerifierAdapter implements ValidPdfVerifier {
  async verify(
    bytes: Buffer,
    expected: ExpectedPdfIdentity,
    limits: PdfValidationLimits = { maxSizeBytes: PDF_MAX_SIZE_BYTES_DEFAULT },
  ): Promise<VerifiedPdf> {
    this.assertPreflight(bytes, expected, limits);

    let loadingTask: ReturnType<PdfJsModule['getDocument']> | undefined;
    let document: Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;

    try {
      const pdfjs = await loadPdfJs();
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      document = await loadingTask.promise;

      if (document.numPages < 1) {
        throw new PdfValidationError('PDF_INVALID', 'PDF must contain at least one page.');
      }

      const pageText: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pageText.push(
          content.items
            .map((item) => ('str' in item ? item.str : ''))
            .filter(Boolean)
            .join(' '),
        );
        page.cleanup();
      }

      const normalizedText = this.normalize(pageText.join(' '));
      this.assertIdentity(normalizedText, expected);

      return {
        pageCount: document.numPages,
        sizeBytes: bytes.length,
        normalizedText,
        parser: 'pdfjs-dist',
      };
    } catch (error: unknown) {
      if (error instanceof PdfValidationError) throw error;
      const parserReason = error instanceof Error ? error.message : String(error);
      throw new PdfValidationError(
        'PDF_INVALID',
        `PDF structural validation failed: ${parserReason}`,
      );
    } finally {
      if (loadingTask) await loadingTask.destroy();
    }
  }

  private assertPreflight(
    bytes: Buffer,
    expected: ExpectedPdfIdentity,
    limits: PdfValidationLimits,
  ): void {
    if (!Number.isInteger(limits.maxSizeBytes) || limits.maxSizeBytes <= 0) {
      throw new PdfValidationError('PDF_INVALID', 'PDF size limit is invalid.');
    }
    if (bytes.length === 0 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new PdfValidationError('PDF_INVALID', 'PDF header is invalid.');
    }
    if (bytes.length > limits.maxSizeBytes) {
      throw new PdfValidationError(
        'PDF_OVERSIZED',
        `PDF exceeds the configured ${limits.maxSizeBytes}-byte limit.`,
      );
    }
    if (bytes.includes(Buffer.from(HISTORICAL_MOCK_PDF_MARKER, 'utf8'))) {
      throw new PdfValidationError(
        'PDF_MOCK_DETECTED',
        'PDF contains the forbidden historical mock marker.',
      );
    }
    if (!/^\d{50}$/.test(expected.clave) || expected.consecutive.length === 0) {
      throw new PdfValidationError('PDF_INVALID', 'Expected PDF identity is invalid.');
    }
  }

  private assertIdentity(text: string, expected: ExpectedPdfIdentity): void {
    const expectedType =
      expected.documentType === 'INVOICE' ? 'Factura Electrónica' : 'Tiquete Electrónico';
    if (!text.includes(this.normalize(expectedType))) {
      throw new PdfValidationError('PDF_INVALID', 'PDF document type identity is missing.');
    }
    if (!text.includes(expected.clave)) {
      throw new PdfValidationError('PDF_INVALID', 'PDF clave identity is missing.');
    }
    if (!text.includes(expected.consecutive)) {
      throw new PdfValidationError('PDF_INVALID', 'PDF consecutive identity is missing.');
    }
  }

  private normalize(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  }
}
