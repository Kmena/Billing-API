/**
 * GenerateFiscalPdfService — F4 PDF artifact creation/reuse.
 *
 * F4 — TASK-008
 * Creates or reuses a PDF artifact for a fiscal document.
 * Idempotent: concurrent workers create/reuse exactly one PDF per document+template+version.
 * Uses immutable fiscal evidence only.
 * SHA-256 stored in FiscalArtifact for integrity verification.
 *
 * INVARIANT: PDF generation failure does NOT modify FiscalDocument.status.
 * INVARIANT: PDF bytes derived from immutable evidence only (no mutable company data).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED,
  PDF_RENDERER,
  PdfRendererPort,
} from '../pdf/pdf-renderer.port';
import { QR_CONTENT_BUILDER, QrContentBuilderPort } from '../qr/qr-content-builder.port';
import { CompanyPdfSettingsService } from '../pdf/company-pdf-settings.service';
import { FiscalPdfArtifactStateService } from './fiscal-pdf-artifact-state.service';
import { FiscalEvidenceResolverService } from './fiscal-evidence-resolver.service';
import {
  FiscalXmlProjectionError,
  ReadOnlyFiscalXmlParser,
} from '../fiscal-representation/read-only-fiscal-xml-parser';
import { FiscalRepresentationPdfPipeline } from '../pdf/fiscal-representation-pdf-pipeline';
import { PDF_MAX_SIZE_BYTES_DEFAULT } from '../pdf/valid-pdf-verifier.port';
import {
  BILLING_DEFAULT_V1_RENDERER_VERSION,
  BILLING_DEFAULT_V1_TEMPLATE_ID,
} from '../delivery/delivery.constants';
import { DomainException } from '../../../shared/domain/domain-exception';

export class PdfGenerationException extends DomainException {
  readonly code = 'PDF_GENERATION_FAILED';
  readonly httpStatus = 500;
  constructor(documentId: string, reason: string) {
    super(`PDF generation failed for document '${documentId}': ${reason}`);
  }
}

export interface GeneratePdfResult {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly wasCreated: boolean;
}

@Injectable()
export class GenerateFiscalPdfService {
  private readonly logger = new Logger(GenerateFiscalPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(PDF_RENDERER) _pdfRenderer: PdfRendererPort,
    @Inject(QR_CONTENT_BUILDER) _qrBuilder: QrContentBuilderPort,
    private readonly pdfSettings: CompanyPdfSettingsService,
    @Inject(FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED)
    private readonly atomicRuntimeActivated: boolean,
    private readonly artifactState?: FiscalPdfArtifactStateService,
    private readonly evidenceResolver?: FiscalEvidenceResolverService,
    private readonly representationPipeline?: FiscalRepresentationPdfPipeline,
  ) {}

  /**
   * Generate (or reuse) the PDF artifact for a fiscal document.
   * Idempotent: if a PDF artifact already exists for this document+template+version, return it.
   * Does NOT modify FiscalDocument.status on failure.
   *
   * @param tenantId - Tenant scope
   * @param companyId - Company scope
   * @param fiscalDocumentId - Fiscal document to generate PDF for
   * @param templateId - Template identifier (default: BILLING_DEFAULT_V1)
   * @param rendererVersion - Renderer version (default: 2.0.0)
   */
  async generateOrReuse(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
    templateId: string = BILLING_DEFAULT_V1_TEMPLATE_ID,
    rendererVersion: string = BILLING_DEFAULT_V1_RENDERER_VERSION,
  ): Promise<GeneratePdfResult> {
    if (!this.atomicRuntimeActivated) {
      throw new PdfGenerationException(
        fiscalDocumentId,
        'Fiscal PDF generation is paused until the complete safety floor is activated.',
      );
    }

    // Load immutable fiscal document
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });

    if (!doc) {
      throw new PdfGenerationException(fiscalDocumentId, 'Fiscal document not found.');
    }

    if (
      templateId !== BILLING_DEFAULT_V1_TEMPLATE_ID ||
      rendererVersion !== BILLING_DEFAULT_V1_RENDERER_VERSION
    ) {
      throw new PdfGenerationException(
        fiscalDocumentId,
        `Current generation requires ${BILLING_DEFAULT_V1_TEMPLATE_ID}@${BILLING_DEFAULT_V1_RENDERER_VERSION}.`,
      );
    }

    // Reuse only a fully verified current artifact. Metadata alone can never make
    // historical, corrupt or hash-invalid bytes reusable.
    const existing = await this.prisma.fiscalArtifact.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        type: 'PDF',
        templateId,
        rendererVersion,
        supersededAt: null,
      },
    });
    if (existing) {
      const artifactState = this.requireArtifactState();
      const assessment = await artifactState.assess(existing, {
        documentType: doc.type as 'INVOICE' | 'TICKET',
        clave: doc.clave,
        consecutive: doc.consecutive,
      });
      artifactState.requireCurrent(assessment);
      this.logger.log({
        msg: 'Current fiscal PDF artifact reused after verification',
        artifactId: existing.id,
        fiscalDocumentId,
        templateId,
        rendererVersion,
      });
      return {
        artifactId: existing.id,
        storageKey: existing.storageKey,
        sha256: existing.sha256,
        sizeBytes: existing.sizeBytes,
        wasCreated: false,
      };
    }

    // Evidence records are immutable. A document that already has a PDF from a
    // prior renderer, or an invalid historical record, must be remediated by an
    // explicit workflow — never overwritten as a side effect of delivery.
    const historicalArtifact = await this.prisma.fiscalArtifact.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        type: 'PDF',
        supersededAt: null,
      },
    });
    if (historicalArtifact) {
      const artifactState = this.requireArtifactState();
      const assessment = await artifactState.assess(historicalArtifact, {
        documentType: doc.type as 'INVOICE' | 'TICKET',
        clave: doc.clave,
        consecutive: doc.consecutive,
      });
      artifactState.requireCurrent(assessment);
      throw new PdfGenerationException(
        fiscalDocumentId,
        'Existing fiscal PDF evidence unexpectedly passed current-artifact validation.',
      );
    }

    // Load safe branding (cannot override fiscal content)
    const branding = await this.pdfSettings.getBrandingView(
      tenantId,
      companyId,
      CompanyPdfSettingsService.systemAuthorization(),
    );

    // The activated path has exactly one fiscal source: the persisted signed XML.
    // Mutable document snapshots are used only for ownership and expected identity.
    const evidenceResolver = this.requireEvidenceResolver(fiscalDocumentId);
    const pipeline = this.requireRepresentationPipeline(fiscalDocumentId);
    const signedXml = await evidenceResolver.resolveSignedXmlBytes(
      tenantId,
      companyId,
      fiscalDocumentId,
    );
    const view = new ReadOnlyFiscalXmlParser().project({
      bytes: signedXml.bytes,
      expectedSha256: signedXml.sha256,
      documentType: doc.type as 'INVOICE' | 'TICKET',
    });
    if (view.document.clave !== doc.clave || view.document.consecutive !== doc.consecutive) {
      throw new FiscalXmlProjectionError(
        'PROJECTION_FAILED',
        'Signed XML identity does not match the immutable fiscal document identity.',
      );
    }

    const { rendered } = await pipeline.generateVerified(view, {
      timeoutMs: 30_000,
      limits: { maxSizeBytes: PDF_MAX_SIZE_BYTES_DEFAULT },
      render: { branding, qr: { enabled: false } },
    });
    if (rendered.templateId !== templateId || rendered.rendererVersion !== rendererVersion) {
      throw new PdfGenerationException(
        fiscalDocumentId,
        'Verified renderer returned an incompatible template/version identity.',
      );
    }

    // Store PDF in object storage
    const storageKey =
      `fiscal-pdfs/${tenantId}/${companyId}/${doc.environment}/${doc.clave}/` +
      `${templateId}-${rendererVersion}-${rendered.sha256.substring(0, 12)}.pdf`;
    await this.storage.upload({
      key: storageKey,
      bytes: rendered.bytes,
      contentType: 'application/pdf',
      metadata: {
        sha256: rendered.sha256,
        clave: doc.clave,
        fiscalDocumentId,
      },
    });

    // Persist artifact metadata (unique constraint prevents duplicate rows)
    const artifactId = randomUUID();
    try {
      await this.prisma.fiscalArtifact.create({
        data: {
          id: artifactId,
          tenantId,
          companyId,
          fiscalDocumentId,
          type: 'PDF',
          storageKey,
          sha256: rendered.sha256,
          contentType: 'application/pdf',
          sizeBytes: rendered.sizeBytes,
          templateId,
          rendererVersion,
        },
      });
    } catch (err: unknown) {
      // Unique constraint violation: another worker created the artifact concurrently
      // Fetch the winning artifact and return it
      const winner = await this.prisma.fiscalArtifact.findFirst({
        where: {
          tenantId,
          companyId,
          fiscalDocumentId,
          type: 'PDF',
          templateId,
          rendererVersion,
          supersededAt: null,
        },
      });

      if (
        winner &&
        winner.storageKey === storageKey &&
        winner.sha256 === rendered.sha256 &&
        winner.sizeBytes === rendered.sizeBytes
      ) {
        const winnerAssessment = await this.requireArtifactState().assess(winner, {
          documentType: doc.type as 'INVOICE' | 'TICKET',
          clave: doc.clave,
          consecutive: doc.consecutive,
        });
        if (winnerAssessment.state === 'VALID_REAL_CURRENT') {
          this.logger.log({
            msg: 'PDF artifact created concurrently by another worker — returning winner',
            artifactId: winner.id,
            fiscalDocumentId,
          });
          return {
            artifactId: winner.id,
            storageKey: winner.storageKey,
            sha256: winner.sha256,
            sizeBytes: winner.sizeBytes,
            wasCreated: false,
          };
        }
      }

      try {
        await this.storage.delete(storageKey);
      } catch {
        this.logger.warn({
          msg: 'PDF compensation delete failed; reconciliation required',
          fiscalDocumentId,
          templateId,
          rendererVersion,
        });
      }

      throw new PdfGenerationException(
        fiscalDocumentId,
        winner
          ? 'Artifact collision did not match the generated hash, size and immutable key.'
          : `Failed to persist PDF artifact: ${String(err)}`,
      );
    }

    this.logger.log({
      msg: 'PDF artifact created',
      artifactId,
      fiscalDocumentId,
      templateId,
      rendererVersion,
      sizeBytes: rendered.sizeBytes,
    });

    return {
      artifactId,
      storageKey,
      sha256: rendered.sha256,
      sizeBytes: rendered.sizeBytes,
      wasCreated: true,
    };
  }

  private requireArtifactState(): FiscalPdfArtifactStateService {
    if (!this.artifactState) {
      throw new PdfGenerationException(
        'unknown',
        'Fiscal PDF artifact state verifier is not configured.',
      );
    }
    return this.artifactState;
  }

  private requireEvidenceResolver(documentId: string): FiscalEvidenceResolverService {
    if (!this.evidenceResolver) {
      throw new PdfGenerationException(
        documentId,
        'Signed XML evidence resolver is not configured.',
      );
    }
    return this.evidenceResolver;
  }

  private requireRepresentationPipeline(documentId: string): FiscalRepresentationPdfPipeline {
    if (!this.representationPipeline) {
      throw new PdfGenerationException(documentId, 'Verified PDF pipeline is not configured.');
    }
    return this.representationPipeline;
  }
}
