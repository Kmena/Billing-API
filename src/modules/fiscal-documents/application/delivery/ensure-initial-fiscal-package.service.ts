/**
 * EnsureInitialFiscalPackageService — F4 INITIAL_DOCUMENT delivery orchestration.
 *
 * F4 — TASK-011A
 * Triggered at FiscalDocument.status = READY_TO_SUBMIT + signed XML present.
 * Does NOT require ACCEPTED.
 * Creates/reuses PDF artifact and INITIAL_DOCUMENT delivery row.
 * Idempotent: repeated calls create exactly one logical DocumentDelivery per document.
 * Missing recipient email is a non-error condition (TE may not have receptor email).
 *
 * INVARIANT: Does NOT modify FiscalDocument.status.
 * INVARIANT: Does NOT regenerate signed XML.
 * INVARIANT: Does NOT create new Clave or consecutive.
 * FR-027: Attachment filenames follow official Hacienda convention.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { GenerateFiscalPdfService } from '../artifacts/generate-fiscal-pdf.service';
import { FiscalPdfArtifactPolicyException } from '../artifacts/fiscal-pdf-artifact-state.service';
import { FiscalXmlProjectionError } from '../fiscal-representation/read-only-fiscal-xml-parser';
import { PdfRenderTimeoutError } from '../pdf/bounded-pdf-render-attempt';
import { PdfValidationError } from '../pdf/valid-pdf-verifier.port';
import { DEFAULT_MAX_DELIVERY_RETRIES, DELIVERY_JOB_NAME } from './delivery.constants';
import { resolveDeliveryRecipient } from './delivery-recipient.resolver';
import {
  DeliveryErrorClass,
  DeliveryRetryClassifier,
} from '../../domain/delivery/delivery-retry-classifier';

export interface EnsureInitialPackageCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly fiscalDocumentId: string;
}

interface ClassifiedPdfPrerequisiteFailure {
  readonly errorClass: DeliveryErrorClass;
  readonly failureCode: string;
}

@Injectable()
export class EnsureInitialFiscalPackageService {
  private readonly logger = new Logger(EnsureInitialFiscalPackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly generatePdfService: GenerateFiscalPdfService,
  ) {}

  /**
   * Ensure INITIAL_DOCUMENT delivery is created and queued for a fiscal document.
   * Idempotent: returns existing delivery if already created.
   * Does NOT modify FiscalDocument.status on failure or success.
   */
  async ensure(command: EnsureInitialPackageCommand): Promise<void> {
    const { tenantId, companyId, fiscalDocumentId } = command;

    // Verify document exists and is in READY_TO_SUBMIT state with signed XML
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
      include: { xmlArtifacts: true },
    });

    if (!doc) {
      this.logger.warn({
        msg: 'EnsureInitialPackage: document not found',
        fiscalDocumentId,
        tenantId,
        companyId,
      });
      return;
    }

    // Document must be at least READY_TO_SUBMIT
    const eligibleStatuses = ['READY_TO_SUBMIT', 'ACCEPTED', 'REJECTED'];
    if (!eligibleStatuses.includes(doc.status)) {
      this.logger.log({
        msg: 'EnsureInitialPackage: document not eligible for initial delivery',
        status: doc.status,
        fiscalDocumentId,
      });
      return;
    }

    // Signed XML artifact must be present
    const hasSignedXml = doc.xmlArtifacts.some((a) => a.signedXmlStorageKey && a.signedXmlSha256);
    if (!hasSignedXml) {
      this.logger.warn({
        msg: 'EnsureInitialPackage: signed XML not yet available — skipping',
        fiscalDocumentId,
      });
      return;
    }

    // Generate (or reuse) PDF artifact independently of email delivery.
    // Missing recipient email must not make the PDF artifact disappear. Obvious in hindsight,
    // but apparently software enjoys hiding invoices behind mailboxes. Woof.
    try {
      await this.generatePdfService.generateOrReuse(tenantId, companyId, fiscalDocumentId);
    } catch (err: unknown) {
      // A current, verified PDF is mandatory for INITIAL_DOCUMENT. Do not create
      // a queueable XML-only delivery when generation/reuse fails.
      this.logger.error({
        msg: 'EnsureInitialPackage: PDF generation/reuse failed — INITIAL_DOCUMENT not queued',
        fiscalDocumentId,
        error: String(err),
      });
      const recipientResolution = resolveDeliveryRecipient(doc.receiverSnapshot);
      if (recipientResolution.kind === 'RESOLVED') {
        await this.recordPdfPrerequisiteFailure({
          tenantId,
          companyId,
          fiscalDocumentId,
          recipient: recipientResolution.recipient,
          error: err,
        });
      }
      return;
    }

    // Extract recipient email from immutable receiverSnapshot
    const recipientResolution = resolveDeliveryRecipient(doc.receiverSnapshot);
    if (recipientResolution.kind !== 'RESOLVED') {
      this.logger.warn({
        msg: 'EnsureInitialPackage: delivery recipient unavailable — PDF ensured, no delivery',
        fiscalDocumentId,
        documentType: doc.type,
        recipientResolution: recipientResolution.code,
      });
      return; // A missing or unsafe recipient must never queue delivery.
    }
    const recipient = recipientResolution.recipient;

    // Create/reuse INITIAL_DOCUMENT delivery row (idempotent via unique constraint)
    const deliveryId = await this.findOrCreateDelivery({
      tenantId,
      companyId,
      fiscalDocumentId,
      kind: 'INITIAL_DOCUMENT',
      recipient,
    });

    if (!deliveryId) return; // Already delivered or cancelled

    // Enqueue delivery job
    await this.jobQueue.publish(DELIVERY_JOB_NAME, { deliveryId }, { retryLimit: 3 });

    this.logger.log({
      msg: 'EnsureInitialPackage: delivery queued',
      deliveryId,
      fiscalDocumentId,
      documentType: doc.type,
    });
  }

  private async findOrCreateDelivery(params: {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    kind: string;
    recipient: string;
  }): Promise<string | null> {
    // Check for existing delivery
    const existing = await this.prisma.documentDelivery.findFirst({
      where: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        fiscalDocumentId: params.fiscalDocumentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: params.recipient,
        packageVersion: null,
      },
    });

    if (existing) {
      // Already delivered — do not re-trigger automatically
      if (existing.status === 'DELIVERED') {
        this.logger.log({
          msg: 'EnsureInitialPackage: already DELIVERED — no re-trigger',
          deliveryId: existing.id,
        });
        return null;
      }
      // Already queued/sending — do not duplicate
      if (existing.status === 'QUEUED' || existing.status === 'SENDING') {
        this.logger.log({
          msg: 'EnsureInitialPackage: already QUEUED/SENDING — no duplicate',
          deliveryId: existing.id,
        });
        return null;
      }
      // RETRY_PENDING, FAILED — re-queue
      await this.prisma.documentDelivery.update({
        where: { id: existing.id },
        data: { status: 'QUEUED', updatedAt: new Date() },
      });
      return existing.id;
    }

    // Create new delivery row
    try {
      const id = randomUUID();
      await this.prisma.documentDelivery.create({
        data: {
          id,
          tenantId: params.tenantId,
          companyId: params.companyId,
          fiscalDocumentId: params.fiscalDocumentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: params.recipient,
          packageVersion: null,
          status: 'QUEUED',
          updatedAt: new Date(),
        },
      });
      return id;
    } catch (err: unknown) {
      // Unique constraint violation — another worker created it concurrently
      const winner = await this.prisma.documentDelivery.findFirst({
        where: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          fiscalDocumentId: params.fiscalDocumentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: params.recipient,
          packageVersion: null,
        },
      });
      return winner?.id ?? null;
    }
  }

  private async recordPdfPrerequisiteFailure(params: {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    recipient: string;
    error: unknown;
  }): Promise<void> {
    const existing = await this.prisma.documentDelivery.findFirst({
      where: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        fiscalDocumentId: params.fiscalDocumentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: params.recipient,
        packageVersion: null,
      },
    });
    if (existing && ['DELIVERED', 'CANCELLED', 'QUEUED', 'SENDING'].includes(existing.status)) {
      return;
    }

    const message = params.error instanceof Error ? params.error.message : String(params.error);
    const failure = this.classifyPdfPrerequisiteFailure(params.error);
    const retryCount = existing?.attemptCount ?? 0;
    const classification = DeliveryRetryClassifier.classify({
      errorClass: failure.errorClass,
      retryCount,
      maxRetries: DEFAULT_MAX_DELIVERY_RETRIES,
    });
    const nextAttemptAt = classification.retryDelaySeconds
      ? new Date(Date.now() + classification.retryDelaySeconds * 1000)
      : null;
    const data = {
      status: classification.nextStatus,
      lastErrorCode: failure.failureCode,
      lastSanitizedError: message.substring(0, 500),
      nextAttemptAt,
      attemptCount: retryCount + 1,
      updatedAt: new Date(),
    };

    if (existing) {
      await this.prisma.documentDelivery.update({ where: { id: existing.id }, data });
      return;
    }

    await this.prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        companyId: params.companyId,
        fiscalDocumentId: params.fiscalDocumentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: params.recipient,
        packageVersion: null,
        ...data,
      },
    });
  }

  private classifyPdfPrerequisiteFailure(error: unknown): ClassifiedPdfPrerequisiteFailure {
    if (error instanceof PdfValidationError) {
      return {
        errorClass: error.code === 'PDF_MOCK_DETECTED' ? 'HISTORICAL_MOCK' : 'ARTIFACT_CORRUPT',
        failureCode: error.code,
      };
    }

    if (error instanceof FiscalXmlProjectionError) {
      return {
        errorClass:
          error.code === 'SIGNED_XML_HASH_MISMATCH' ? 'ARTIFACT_HASH_MISMATCH' : 'ARTIFACT_CORRUPT',
        failureCode: error.code,
      };
    }

    if (error instanceof FiscalPdfArtifactPolicyException) {
      switch (error.code) {
        case 'ARTIFACT_MISSING':
          return { errorClass: 'ARTIFACT_MISSING', failureCode: error.code };
        case 'ARTIFACT_HASH_MISMATCH':
          return { errorClass: 'ARTIFACT_HASH_MISMATCH', failureCode: error.code };
        case 'ARTIFACT_WRONG_VERSION':
          return { errorClass: 'ARTIFACT_WRONG_VERSION', failureCode: error.code };
        case 'LEGACY_PDF_UNAVAILABLE':
          return { errorClass: 'HISTORICAL_MOCK', failureCode: error.code };
        case 'PDF_INVALID_STRUCTURE':
        case 'PDF_OVERSIZED':
          return { errorClass: 'ARTIFACT_CORRUPT', failureCode: error.code };
      }
    }

    if (error instanceof PdfRenderTimeoutError) {
      return { errorClass: 'PDF_NOT_YET_GENERATED', failureCode: error.code };
    }

    // Unclassified generation/resource failures keep the frozen bounded-retry
    // behavior. Canonical validation/security failures are handled above by type.
    return { errorClass: 'PDF_NOT_YET_GENERATED', failureCode: 'RENDER_FAILED' };
  }
}
