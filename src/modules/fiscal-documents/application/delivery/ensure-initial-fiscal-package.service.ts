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
import { DELIVERY_JOB_NAME } from './delivery.constants';

export interface EnsureInitialPackageCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly fiscalDocumentId: string;
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

    // Extract recipient email from immutable receiverSnapshot
    const recipient = this.extractRecipientEmail(doc.receiverSnapshot);
    if (!recipient) {
      this.logger.log({
        msg: 'EnsureInitialPackage: no recipient email in receiverSnapshot — no delivery (expected for TE)',
        fiscalDocumentId,
        documentType: doc.type,
      });
      return; // Missing email is NOT an error (FR-025)
    }

    // Generate (or reuse) PDF artifact
    try {
      await this.generatePdfService.generateOrReuse(tenantId, companyId, fiscalDocumentId);
    } catch (err: unknown) {
      // PDF generation failure must NOT block delivery creation or change fiscal status
      this.logger.error({
        msg: 'EnsureInitialPackage: PDF generation failed — delivery will be queued but may retry',
        fiscalDocumentId,
        error: String(err),
      });
      // Continue: delivery worker will handle missing PDF gracefully
    }

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

  private extractRecipientEmail(receiverSnapshot: unknown): string | null {
    if (!receiverSnapshot || typeof receiverSnapshot !== 'object') return null;
    const snap = receiverSnapshot as Record<string, unknown>;
    const email = snap['correoElectronico'];
    if (typeof email === 'string' && email.trim().length > 0) {
      return email.trim();
    }
    return null;
  }
}
