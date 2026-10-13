import { Provider } from '@nestjs/common';
import {
  FISCAL_REPRESENTATION_PDF_RENDERER,
  FiscalRepresentationPdfRendererPort,
  PDF_RENDERER,
} from './pdf-renderer.port';
import { BillingDefaultV1PdfRendererAdapter } from '../../infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';

export type FiscalPdfRendererKind = 'REAL' | 'MOCK_TEST_ONLY';
export type FiscalPdfEmailKind = 'CAPTURED' | 'SMTP';

export interface FiscalPdfBootstrapState {
  readonly renderer: FiscalPdfRendererKind;
  readonly email: FiscalPdfEmailKind;
  readonly verifierActive: boolean;
  readonly isolatedTestOverride?: boolean;
}

export class FiscalPdfConfigurationError extends Error {
  readonly code = 'INVALID_CONFIGURATION';

  constructor(message: string) {
    super(message);
    this.name = 'FiscalPdfConfigurationError';
  }
}

/** Normal construction is environment-independent and always resolves PDFKit. */
export const FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER: Provider = {
  provide: FISCAL_REPRESENTATION_PDF_RENDERER,
  useExisting: BillingDefaultV1PdfRendererAdapter,
};

export const NORMAL_PDF_RENDERER_PROVIDER: Provider = {
  provide: PDF_RENDERER,
  useExisting: BillingDefaultV1PdfRendererAdapter,
};

export function assertFiscalPdfBootstrapState(state: FiscalPdfBootstrapState): void {
  if (state.renderer === 'MOCK_TEST_ONLY') {
    if (!state.isolatedTestOverride || state.email !== 'CAPTURED') {
      throw new FiscalPdfConfigurationError(
        'Mock PDF rendering is allowed only by an explicit isolated-test provider override with captured email.',
      );
    }
    return;
  }

  if (state.email === 'SMTP' && !state.verifierActive) {
    throw new FiscalPdfConfigurationError(
      'Real SMTP requires the active ValidPdfVerifier contract.',
    );
  }
}

export function selectNormalFiscalPdfRenderer<T extends FiscalRepresentationPdfRendererPort>(
  realRenderer: T,
): T {
  return realRenderer;
}
