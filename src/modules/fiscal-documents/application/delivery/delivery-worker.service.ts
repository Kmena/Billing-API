/**
 * DeliveryWorkerService — F4 email delivery worker.
 *
 * F4 — TASK-012
 * Processes delivery jobs from pg-boss queue.
 * Verifies artifact SHA-256 before attachment (TASK-015).
 * Applies retry classification (TASK-003) on failure.
 * Uses official filename convention for attachments (FR-027).
 * Stale SENDING protection: uses updateMany with status guard.
 *
 * INVARIANT: Never writes to FiscalDocument.status.
 * INVARIANT: Never regenerates signed XML.
 * INVARIANT: Attachment bytes are exact persisted bytes (SHA-256 verified).
 * INVARIANT: DELIVERED cannot regress to FAILED due to stale worker.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import {
  EMAIL_DELIVERY_PORT,
  EmailDeliveryPort,
  EmailAttachment,
} from '../email/email-delivery.port';
import { FiscalEvidenceResolverService } from '../artifacts/fiscal-evidence-resolver.service';
import { FiscalArtifactService } from '../artifacts/fiscal-artifact.service';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import {
  DeliveryRetryClassifier,
  DeliveryErrorClass,
} from '../../domain/delivery/delivery-retry-classifier';
import { DocumentDeliveryKind } from '../../domain/delivery/document-delivery-kind.enum';
import { DEFAULT_MAX_DELIVERY_RETRIES, DELIVERY_JOB_NAME } from './delivery.constants';

export interface DeliveryJobPayload {
  readonly deliveryId: string;
}

@Injectable()
export class DeliveryWorkerService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(EMAIL_DELIVERY_PORT) private readonly emailPort: EmailDeliveryPort,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly evidenceResolver: FiscalEvidenceResolverService,
    private readonly artifactService: FiscalArtifactService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Register the delivery job handler with pg-boss on module init.
   * This is the correct pattern used by FiscalSubmissionWorkerService.
   */
  async onModuleInit(): Promise<void> {
    if (!this.jobQueue.registerHandler) return;
    await this.jobQueue.registerHandler<DeliveryJobPayload>(
      DELIVERY_JOB_NAME,
      async (job: { data: DeliveryJobPayload }) => {
        await this.processDelivery(job.data);
      },
    );
    this.logger.log({
      msg: 'DeliveryWorkerService registered pg-boss handler',
      job: DELIVERY_JOB_NAME,
    });
  }

  /**
   * Process a delivery job.
   * Called by pg-boss worker when a DELIVERY_JOB_NAME job is available.
   */
  async processDelivery(payload: DeliveryJobPayload): Promise<void> {
    const { deliveryId } = payload;
    const startedAt = new Date();

    // Load delivery with fiscal document
    const delivery = await this.prisma.documentDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        fiscalDocument: {
          select: {
            id: true,
            tenantId: true,
            companyId: true,
            clave: true,
            type: true,
            status: true,
          },
        },
      },
    });

    if (!delivery) {
      this.logger.warn({ msg: 'DeliveryWorker: delivery not found', deliveryId });
      return;
    }

    const { fiscalDocument: doc } = delivery;

    // Idempotency: check for duplicate trigger (already DELIVERED)
    if (delivery.status === 'DELIVERED') {
      this.logger.log({
        msg: 'DeliveryWorker: duplicate trigger — already DELIVERED',
        deliveryId,
      });
      return;
    }

    // Mark as SENDING (with stale protection: only if QUEUED/RETRY_PENDING)
    const claimed = await this.prisma.documentDelivery.updateMany({
      where: {
        id: deliveryId,
        status: { in: ['QUEUED', 'RETRY_PENDING'] },
      },
      data: { status: 'SENDING', lastAttemptAt: startedAt, updatedAt: new Date() },
    });

    if (claimed.count === 0) {
      this.logger.log({
        msg: 'DeliveryWorker: could not claim delivery (already SENDING or terminal)',
        deliveryId,
        currentStatus: delivery.status,
      });
      return;
    }

    const attemptNumber = delivery.attemptCount + 1;
    const attemptId = randomUUID();

    // Create attempt record
    await this.prisma.deliveryAttempt.create({
      data: {
        id: attemptId,
        deliveryId,
        attemptNumber,
        status: 'SENDING',
        startedAt,
      },
    });

    try {
      const attachments = await this.buildAttachments(delivery, doc);
      const emailResult = await this.emailPort.sendEmail({
        to: delivery.recipient,
        subject: this.buildSubject(delivery.kind as DocumentDeliveryKind, doc.clave, doc.type),
        text: this.buildEmailBody(
          delivery.kind as DocumentDeliveryKind,
          doc.clave,
          doc.type,
          doc.status,
        ),
        attachments,
      });

      if (emailResult.outcome === 'DELIVERED') {
        const now = new Date();
        await this.prisma.documentDelivery.updateMany({
          where: { id: deliveryId, status: { not: 'DELIVERED' } }, // Stale terminal guard
          data: {
            status: 'DELIVERED',
            deliveredAt: now,
            providerMessageId: emailResult.providerMessageId ?? null,
            lastErrorCode: null,
            lastSanitizedError: null,
            attemptCount: attemptNumber,
            lastAttemptAt: now,
            updatedAt: now,
          },
        });

        await this.prisma.deliveryAttempt.update({
          where: { id: attemptId },
          data: {
            status: 'DELIVERED',
            providerMessageId: emailResult.providerMessageId ?? null,
            completedAt: now,
          },
        });

        this.auditService.record({
          tenantId: doc.tenantId,
          companyId: doc.companyId,
          action: `fiscal-delivery.delivered.${delivery.kind.toLowerCase()}`,
          eventClass: EventClass.FISCAL_AUDIT,
          resource: `DocumentDelivery:${deliveryId}`,
          correlationId: doc.id,
          metadata: {
            deliveryId,
            kind: delivery.kind,
            fiscalDocumentId: doc.id,
            recipient: '***', // Redacted
          },
        });

        this.logger.log({
          msg: 'DeliveryWorker: delivery DELIVERED',
          deliveryId,
          kind: delivery.kind,
        });
      } else {
        await this.handleFailure(
          delivery,
          doc,
          attemptId,
          attemptNumber,
          emailResult.outcome,
          emailResult.sanitizedErrorCode,
          emailResult.sanitizedErrorMessage,
        );
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Classify the error
      let errorClass: DeliveryErrorClass = 'UNKNOWN_PROVIDER_RESPONSE';
      if (errorMessage.includes('hash mismatch') || errorMessage.includes('integrity')) {
        errorClass = 'ARTIFACT_HASH_MISMATCH';
      } else if (errorMessage.includes('not found') || errorMessage.includes('missing')) {
        errorClass = 'ARTIFACT_MISSING';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        errorClass = 'NETWORK_TIMEOUT';
      }

      await this.handleFailure(
        delivery,
        doc,
        attemptId,
        attemptNumber,
        'UNKNOWN',
        errorClass,
        errorMessage.substring(0, 200),
      );
    }
  }

  private async buildAttachments(
    delivery: { kind: string; fiscalDocumentId: string },
    doc: { id: string; tenantId: string; companyId: string; clave: string },
  ): Promise<EmailAttachment[]> {
    const attachments: EmailAttachment[] = [];

    if (delivery.kind === 'INITIAL_DOCUMENT') {
      // Attach exact signed XML bytes (SHA-256 verified)
      const signedXml = await this.evidenceResolver.resolveSignedXmlBytes(
        doc.tenantId,
        doc.companyId,
        doc.id,
      );
      attachments.push({
        filename: `${doc.clave}.xml`, // FR-027: official filename
        content: signedXml.bytes,
        contentType: signedXml.contentType,
      });

      // Attach PDF if available
      const pdfArtifact = await this.prisma.fiscalArtifact.findFirst({
        where: {
          tenantId: doc.tenantId,
          companyId: doc.companyId,
          fiscalDocumentId: doc.id,
          type: 'PDF',
          supersededAt: null,
        },
      });

      if (pdfArtifact) {
        const pdfBytes = await this.storage.download(pdfArtifact.storageKey);
        // Verify PDF integrity
        await this.evidenceResolver.verifyIntegrity(pdfBytes, pdfArtifact.sha256, doc.id, 'PDF');
        attachments.push({
          filename: `${doc.clave}.pdf`, // FR-027: official filename
          content: pdfBytes,
          contentType: 'application/pdf',
        });
      }
    } else if (delivery.kind === 'HACIENDA_RESPONSE') {
      // Attach exact Hacienda response bytes (SHA-256 verified)
      const responseXml = await this.evidenceResolver.resolveHaciendaResponseBytes(
        doc.tenantId,
        doc.companyId,
        doc.id,
      );
      attachments.push({
        filename: `${doc.clave}_respuesta.xml`, // FR-027: official filename
        content: responseXml.bytes,
        contentType: responseXml.contentType,
      });
    }

    return attachments;
  }

  private buildSubject(kind: DocumentDeliveryKind, clave: string, docType: string): string {
    const typeLabel = docType === 'INVOICE' ? 'Factura Electrónica' : 'Tiquete Electrónico';
    const shortClave = clave.substring(clave.length - 8); // Last 8 digits for readability

    if (kind === DocumentDeliveryKind.INITIAL_DOCUMENT) {
      return `${typeLabel} emitida - Clave ...${shortClave}`;
    } else {
      return `Confirmación Hacienda - ${typeLabel} Clave ...${shortClave}`;
    }
  }

  private buildEmailBody(
    kind: DocumentDeliveryKind,
    clave: string,
    docType: string,
    fiscalStatus: string,
  ): string {
    const typeLabel = docType === 'INVOICE' ? 'Factura Electrónica' : 'Tiquete Electrónico';

    if (kind === DocumentDeliveryKind.INITIAL_DOCUMENT) {
      return [
        `Se adjunta su ${typeLabel} electrónica emitida.`,
        ``,
        `Clave: ${clave}`,
        ``,
        `Documentos adjuntos:`,
        `- XML firmado del comprobante`,
        `- Representación gráfica (PDF)`,
        ``,
        `Nota: Este comprobante está pendiente de confirmación por parte de Hacienda.`,
        `Recibirá la confirmación de Hacienda una vez procesada.`,
      ].join('\n');
    } else {
      // HACIENDA_RESPONSE — must not present rejected comprobante as valid
      const isRejected = fiscalStatus === 'REJECTED';
      return [
        isRejected
          ? `Se adjunta la respuesta de Hacienda para su ${typeLabel}.`
          : `Hacienda ha confirmado la aceptación de su ${typeLabel}.`,
        ``,
        `Clave: ${clave}`,
        `Estado Hacienda: ${isRejected ? 'RECHAZADO' : 'ACEPTADO'}`,
        ``,
        isRejected
          ? `NOTA IMPORTANTE: El comprobante con esta clave fue RECHAZADO por Hacienda.`
          : `El comprobante ha sido aceptado como válido por Hacienda.`,
        ``,
        `Documentos adjuntos:`,
        `- Respuesta oficial de Hacienda (XML)`,
      ].join('\n');
    }
  }

  private async handleFailure(
    delivery: {
      id: string;
      kind: string;
      tenantId: string;
      companyId: string;
      fiscalDocumentId: string;
      attemptCount: number;
    },
    doc: { tenantId: string; companyId: string; id: string },
    attemptId: string,
    attemptNumber: number,
    providerOutcome: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    const errorClass = this.mapOutcomeToErrorClass(providerOutcome, errorCode);
    const classification = DeliveryRetryClassifier.classify({
      errorClass,
      retryCount: delivery.attemptCount,
      maxRetries: DEFAULT_MAX_DELIVERY_RETRIES,
    });

    const now = new Date();
    const nextAttemptAt = classification.retryDelaySeconds
      ? new Date(now.getTime() + classification.retryDelaySeconds * 1000)
      : null;

    // Use updateMany with NOT 'DELIVERED' guard (stale terminal protection)
    await this.prisma.documentDelivery.updateMany({
      where: { id: delivery.id, status: { not: 'DELIVERED' } },
      data: {
        status: classification.nextStatus,
        lastErrorCode: errorCode?.substring(0, 120) ?? null,
        lastSanitizedError: errorMessage?.substring(0, 500) ?? null,
        nextAttemptAt,
        attemptCount: attemptNumber,
        lastAttemptAt: now,
        updatedAt: now,
      },
    });

    await this.prisma.deliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: classification.nextStatus,
        errorCode: errorCode?.substring(0, 120) ?? null,
        sanitizedError: errorMessage?.substring(0, 500) ?? null,
        completedAt: now,
      },
    });

    if (classification.emitSecurityAudit) {
      this.auditService.record({
        tenantId: doc.tenantId,
        companyId: doc.companyId,
        action: 'fiscal-delivery.artifact-integrity-failure',
        eventClass: EventClass.SECURITY,
        resource: `DocumentDelivery:${delivery.id}`,
        correlationId: doc.id,
        metadata: {
          deliveryId: delivery.id,
          kind: delivery.kind,
          errorClass,
        },
      });
    }

    this.logger.warn({
      msg: 'DeliveryWorker: delivery failure classified',
      deliveryId: delivery.id,
      kind: delivery.kind,
      nextStatus: classification.nextStatus,
      errorClass,
    });
  }

  private mapOutcomeToErrorClass(outcome: string, errorCode?: string): DeliveryErrorClass {
    if (errorCode === 'ARTIFACT_HASH_MISMATCH') return 'ARTIFACT_HASH_MISMATCH';
    if (errorCode === 'ARTIFACT_MISSING') return 'ARTIFACT_MISSING';

    switch (outcome) {
      case 'TRANSIENT_FAILURE':
        return 'TRANSIENT_PROVIDER_FAILURE';
      case 'PERMANENT_FAILURE':
        return 'PERMANENT_PROVIDER_REJECTION';
      case 'RATE_LIMITED':
        return 'PROVIDER_RATE_LIMIT';
      case 'UNKNOWN':
      default:
        return 'UNKNOWN_PROVIDER_RESPONSE';
    }
  }
}
