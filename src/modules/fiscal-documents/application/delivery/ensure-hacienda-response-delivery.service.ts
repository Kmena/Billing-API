/**
 * EnsureHaciendaResponseDeliveryService — F4 HACIENDA_RESPONSE delivery orchestration.
 *
 * F4 — TASK-011B
 * Triggered after F3 records an authoritative ACCEPTED or REJECTED response.
 * Creates/reuses HACIENDA_RESPONSE delivery row.
 * Idempotent: repeated calls create exactly one logical delivery per document.
 * Independent of INITIAL_DOCUMENT delivery status.
 *
 * INVARIANT: Does NOT modify FiscalDocument.status.
 * INVARIANT: Does NOT modify FiscalSubmission.status.
 * INVARIANT: HACIENDA_RESPONSE must not present rejected comprobante as valid.
 * FR-027: Attachment filenames follow official Hacienda convention.
 *
 * F3/F4 integration (DEC-011): Called from FiscalSubmissionStateService.applyProviderResult
 * when terminal status (ACCEPTED/REJECTED) is reached.
 * Startup recovery scan: catches documents where hook was missed.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { DELIVERY_JOB_NAME } from './delivery.constants';
import { resolveDeliveryRecipient } from './delivery-recipient.resolver';

export interface EnsureHaciendaResponseCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly fiscalDocumentId: string;
  /** Whether the Hacienda response is ACCEPTED or REJECTED. */
  readonly responseKind: 'ACCEPTED' | 'REJECTED';
}

export interface StartupRecoveryWindow {
  readonly startAt: Date;
  readonly endAt: Date;
}

const STARTUP_RECOVERY_BATCH_SIZE = 100;

@Injectable()
export class EnsureHaciendaResponseDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(EnsureHaciendaResponseDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Startup recovery: scan for terminal fiscal documents without HACIENDA_RESPONSE delivery.
   * Runs at module init to catch any deliveries missed due to process restart.
   * Recovery is idempotent — existing deliveries are not duplicated.
   */
  async onModuleInit(): Promise<void> {
    const window = this.getStartupRecoveryWindow();
    if (!window) {
      this.logger.log({ msg: 'EnsureHaciendaResponseDelivery: startup recovery disabled' });
      return;
    }

    setImmediate(async () => {
      try {
        await this.recoverMissedDeliveries(window);
      } catch (err: unknown) {
        this.logger.warn({
          msg: 'EnsureHaciendaResponseDelivery: startup recovery scan failed',
          error: String(err),
        });
      }
    });
  }

  /**
   * Ensure HACIENDA_RESPONSE delivery is created and queued.
   * Idempotent: returns immediately if already created.
   * Independent of INITIAL_DOCUMENT delivery status.
   * Does NOT modify FiscalDocument.status.
   */
  async ensure(command: EnsureHaciendaResponseCommand): Promise<void> {
    const { tenantId, companyId, fiscalDocumentId, responseKind } = command;

    // Verify Hacienda response artifact is available
    const submission = await this.prisma.fiscalSubmission.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        responseStorageKey: { not: null },
        responseSha256: { not: null },
      },
    });

    if (!submission?.responseStorageKey || !submission.responseSha256) {
      this.logger.warn({
        msg: 'EnsureHaciendaResponseDelivery: response artifact not yet available',
        fiscalDocumentId,
        responseKind,
      });
      return;
    }

    // Load fiscal document for recipient email
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });

    if (!doc) {
      this.logger.warn({
        msg: 'EnsureHaciendaResponseDelivery: document not found',
        fiscalDocumentId,
      });
      return;
    }

    const recipientResolution = resolveDeliveryRecipient(doc.receiverSnapshot);
    if (recipientResolution.kind !== 'RESOLVED') {
      this.logger.warn({
        msg: 'EnsureHaciendaResponseDelivery: delivery recipient unavailable — no delivery',
        fiscalDocumentId,
        documentType: doc.type,
        recipientResolution: recipientResolution.code,
      });
      return;
    }
    const recipient = recipientResolution.recipient;

    const deliveryId = await this.findOrCreateDelivery({
      tenantId,
      companyId,
      fiscalDocumentId,
      kind: 'HACIENDA_RESPONSE',
      recipient,
      responseKind,
    });

    if (!deliveryId) return;

    await this.jobQueue.publish(DELIVERY_JOB_NAME, { deliveryId }, { retryLimit: 3 });

    this.logger.log({
      msg: 'EnsureHaciendaResponseDelivery: delivery queued',
      deliveryId,
      fiscalDocumentId,
      responseKind,
    });
  }

  /**
   * Startup recovery scan: find terminal fiscal documents without HACIENDA_RESPONSE delivery.
   * Ensures no delivery obligation is permanently lost due to missed hook.
   */
  async recoverMissedDeliveries(window: StartupRecoveryWindow): Promise<void> {
    // The window prevents compatibility changes from replaying all historical documents.
    // Ordering by the unique submission id and cursor pagination avoid a silent 100-row cap.
    let cursor: string | undefined;

    do {
      const orphanedSubmissions = await this.prisma.fiscalSubmission.findMany({
        where: {
          responseStorageKey: { not: null },
          responseSha256: { not: null },
          OR: [
            {
              status: 'ACCEPTED',
              acceptedAt: { gte: window.startAt, lt: window.endAt },
            },
            {
              status: 'REJECTED',
              rejectedAt: { gte: window.startAt, lt: window.endAt },
            },
          ],
        },
        include: {
          fiscalDocument: {
            select: {
              id: true,
              tenantId: true,
              companyId: true,
              type: true,
              receiverSnapshot: true,
              documentDeliveries: {
                where: { kind: 'HACIENDA_RESPONSE' },
                select: { id: true },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: STARTUP_RECOVERY_BATCH_SIZE,
      });

      for (const submission of orphanedSubmissions) {
        const doc = submission.fiscalDocument;
        if (doc.documentDeliveries.length > 0) continue; // Already has delivery

        const responseKind = submission.status === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED';
        this.logger.log({
          msg: 'EnsureHaciendaResponseDelivery: recovering missed delivery',
          fiscalDocumentId: doc.id,
          responseKind,
        });

        await this.ensure({
          tenantId: doc.tenantId,
          companyId: doc.companyId,
          fiscalDocumentId: doc.id,
          responseKind: responseKind as 'ACCEPTED' | 'REJECTED',
        });
      }

      cursor = orphanedSubmissions.at(-1)?.id;
      if (orphanedSubmissions.length < STARTUP_RECOVERY_BATCH_SIZE) break;
    } while (cursor);
  }

  private getStartupRecoveryWindow(): StartupRecoveryWindow | null {
    if (this.configService.get<boolean>('FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED') !== true) {
      return null;
    }

    const configuredStartAt = this.configService.get<string>(
      'FISCAL_DELIVERY_STARTUP_RECOVERY_START_AT',
    );
    const configuredEndAt = this.configService.get<string>(
      'FISCAL_DELIVERY_STARTUP_RECOVERY_END_AT',
    );
    if (!configuredStartAt || !configuredEndAt) {
      throw new Error(
        'FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED=true requires an explicit bounded recovery window.',
      );
    }

    const startAt = new Date(configuredStartAt);
    const endAt = new Date(configuredEndAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
      throw new Error('Fiscal delivery startup recovery window is invalid.');
    }

    return { startAt, endAt };
  }

  private async findOrCreateDelivery(params: {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    kind: string;
    recipient: string;
    responseKind: string;
  }): Promise<string | null> {
    const existing = await this.prisma.documentDelivery.findFirst({
      where: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        fiscalDocumentId: params.fiscalDocumentId,
        kind: 'HACIENDA_RESPONSE',
        channel: 'EMAIL',
        recipient: params.recipient,
        packageVersion: null,
      },
    });

    if (existing) {
      if (existing.status === 'DELIVERED') {
        this.logger.log({
          msg: 'EnsureHaciendaResponseDelivery: already DELIVERED — no re-trigger',
          deliveryId: existing.id,
        });
        return null;
      }
      if (existing.status === 'QUEUED' || existing.status === 'SENDING') {
        return null;
      }
      await this.prisma.documentDelivery.update({
        where: { id: existing.id },
        data: { status: 'QUEUED', updatedAt: new Date() },
      });
      return existing.id;
    }

    try {
      const id = randomUUID();
      await this.prisma.documentDelivery.create({
        data: {
          id,
          tenantId: params.tenantId,
          companyId: params.companyId,
          fiscalDocumentId: params.fiscalDocumentId,
          kind: 'HACIENDA_RESPONSE',
          channel: 'EMAIL',
          recipient: params.recipient,
          packageVersion: null,
          status: 'QUEUED',
          updatedAt: new Date(),
        },
      });
      return id;
    } catch {
      const winner = await this.prisma.documentDelivery.findFirst({
        where: {
          tenantId: params.tenantId,
          companyId: params.companyId,
          fiscalDocumentId: params.fiscalDocumentId,
          kind: 'HACIENDA_RESPONSE',
          channel: 'EMAIL',
          recipient: params.recipient,
          packageVersion: null,
        },
      });
      return winner?.id ?? null;
    }
  }
}
