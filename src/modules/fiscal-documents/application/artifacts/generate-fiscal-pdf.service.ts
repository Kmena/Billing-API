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
import { PDF_RENDERER, PdfRendererPort } from '../pdf/pdf-renderer.port';
import { QR_CONTENT_BUILDER, QrContentBuilderPort } from '../qr/qr-content-builder.port';
import { CompanyPdfSettingsService } from '../pdf/company-pdf-settings.service';
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
    @Inject(PDF_RENDERER) private readonly pdfRenderer: PdfRendererPort,
    @Inject(QR_CONTENT_BUILDER) private readonly qrBuilder: QrContentBuilderPort,
    private readonly pdfSettings: CompanyPdfSettingsService,
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
   * @param rendererVersion - Renderer version (default: 1.0.0)
   */
  async generateOrReuse(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
    templateId: string = BILLING_DEFAULT_V1_TEMPLATE_ID,
    rendererVersion: string = BILLING_DEFAULT_V1_RENDERER_VERSION,
  ): Promise<GeneratePdfResult> {
    // Check for existing artifact (idempotency)
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
      this.logger.log({
        msg: 'PDF artifact already exists — reusing',
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

    // Load immutable fiscal document
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });

    if (!doc) {
      throw new PdfGenerationException(fiscalDocumentId, 'Fiscal document not found.');
    }

    // Build QR content from immutable Clave
    const qrPayload = this.qrBuilder.buildQrContent(doc.clave);

    // Load safe branding (cannot override fiscal content)
    const branding = await this.pdfSettings.getBrandingView(tenantId, companyId);

    // Build immutable fiscal view (no mutable data reads beyond this document)
    const fiscalView = {
      type: doc.type as 'INVOICE' | 'TICKET',
      clave: doc.clave,
      consecutive: doc.consecutive,
      issueDate: doc.issueDate,
      issuerSnapshot: doc.issuerSnapshot as Record<string, unknown>,
      receiverSnapshot: doc.receiverSnapshot as Record<string, unknown> | null,
      lineItems: doc.lines as Array<Record<string, unknown>>,
      totals: doc.totals as Record<string, unknown>,
      currency: doc.currency,
      exchangeRate: doc.exchangeRate ? Number(doc.exchangeRate) : undefined,
      saleCondition: doc.saleCondition,
      paymentMethod: doc.paymentMethod,
    };

    // Render PDF
    const rendered = await this.pdfRenderer.render({
      document: fiscalView,
      branding,
      qrPayload,
      templateId,
      rendererVersion,
    });

    // Store PDF in object storage
    const storageKey = `fiscal-pdfs/${tenantId}/${companyId}/${doc.environment}/${doc.clave}/${templateId}-${rendererVersion}.pdf`;
    await this.storage.upload(storageKey, rendered.bytes, {
      contentType: 'application/pdf',
      sha256: rendered.sha256,
      clave: doc.clave,
      fiscalDocumentId,
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

      if (winner) {
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

      throw new PdfGenerationException(
        fiscalDocumentId,
        `Failed to persist PDF artifact: ${String(err)}`,
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
}
