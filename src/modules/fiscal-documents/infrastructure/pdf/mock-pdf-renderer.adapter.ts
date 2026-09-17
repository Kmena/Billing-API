/**
 * MockPdfRendererAdapter — Deterministic CI PDF renderer.
 *
 * Used in test and CI environments only.
 * Returns a minimal valid PDF with deterministic content for test assertions.
 * Does not require an external PDF engine to be fully initialized.
 * Captures render inputs for test assertion.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  PdfRendererPort,
  PdfRendererInput,
  PdfRendererOutput,
} from '../../application/pdf/pdf-renderer.port';

export const MOCK_RENDERER_VERSION = '0.0.0-test';
export const MOCK_TEMPLATE_ID = 'BILLING_DEFAULT_V1';

// Minimal valid PDF (uses actual pdfkit to generate a tiny but valid PDF)
// For determinism we use a fixed small PDF binary marker
const MOCK_PDF_MARKER = '%PDF-1.4-MOCK-BILLING-DEFAULT-V1';

@Injectable()
export class MockPdfRendererAdapter implements PdfRendererPort {
  private _lastInput: PdfRendererInput | null = null;
  private _renderCount = 0;

  get lastInput(): PdfRendererInput | null {
    return this._lastInput;
  }

  get renderCount(): number {
    return this._renderCount;
  }

  async render(input: PdfRendererInput): Promise<PdfRendererOutput> {
    this._lastInput = input;
    this._renderCount++;

    // Deterministic content: embed key fiscal identifiers for test assertion
    const content = [
      MOCK_PDF_MARKER,
      `templateId=${input.templateId}`,
      `rendererVersion=${input.rendererVersion}`,
      `clave=${input.document.clave}`,
      `consecutive=${input.document.consecutive}`,
      `type=${input.document.type}`,
      `currency=${input.document.currency}`,
      `qr=${input.qrPayload}`,
      `issuer=${JSON.stringify(input.document.issuerSnapshot).substring(0, 100)}`,
      `lines=${input.document.lineItems.length}`,
      `total=${JSON.stringify(input.document.totals).substring(0, 100)}`,
    ].join('\n');

    const bytes = Buffer.from(content, 'utf-8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    return {
      bytes,
      contentType: 'application/pdf',
      sha256,
      sizeBytes: bytes.length,
      templateId: input.templateId,
      rendererVersion: input.rendererVersion,
    };
  }
}
