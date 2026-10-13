import { Inject, Injectable } from '@nestjs/common';
import { runBoundedPdfRenderAttempt } from './bounded-pdf-render-attempt';
import {
  FISCAL_REPRESENTATION_PDF_RENDERER,
  FiscalRepresentationPdfRendererPort,
  FiscalRepresentationRenderOptions,
  PdfRendererOutput,
} from './pdf-renderer.port';
import {
  PdfValidationLimits,
  VALID_PDF_VERIFIER,
  ValidPdfVerifier,
  VerifiedPdf,
} from './valid-pdf-verifier.port';
import { FiscalRepresentationView } from '../fiscal-representation/read-only-fiscal-xml-parser';

export interface FiscalRepresentationPdfAttemptOptions {
  readonly timeoutMs: number;
  readonly limits: PdfValidationLimits;
  readonly render?: Omit<FiscalRepresentationRenderOptions, 'signal'>;
}

export interface VerifiedFiscalRepresentationPdf {
  readonly rendered: PdfRendererOutput;
  readonly verified: VerifiedPdf;
}

/**
 * Wave 3 isolated composition root. It returns no bytes until bounded rendering
 * and runtime verification both succeed. Persistence and delivery are
 * deliberately absent until the atomic TASK-016 activation.
 */
@Injectable()
export class FiscalRepresentationPdfPipeline {
  constructor(
    @Inject(FISCAL_REPRESENTATION_PDF_RENDERER)
    private readonly renderer: FiscalRepresentationPdfRendererPort,
    @Inject(VALID_PDF_VERIFIER)
    private readonly verifier: ValidPdfVerifier,
  ) {}

  async generateVerified(
    view: FiscalRepresentationView,
    options: FiscalRepresentationPdfAttemptOptions,
  ): Promise<VerifiedFiscalRepresentationPdf> {
    const rendered = await runBoundedPdfRenderAttempt(
      ({ signal }) =>
        this.renderer.renderRepresentation(view, {
          ...options.render,
          signal,
        }),
      options.timeoutMs,
    );
    const verified = await this.verifier.verify(
      rendered.bytes,
      {
        documentType: view.document.type,
        clave: view.document.clave,
        consecutive: view.document.consecutive,
      },
      options.limits,
    );
    return { rendered, verified };
  }
}
