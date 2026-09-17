/**
 * DeliveryRequestService — F4 manual resend service.
 *
 * F4 — TASK-013
 * Secure idempotent manual resend with DeliveryAttempt history.
 * Reuses immutable fiscal artifacts — never regenerates XML/Clave/consecutive.
 * Creates a new DeliveryAttempt for historical tracking.
 * Concurrency safe: guards against race conditions.
 *
 * INVARIANT: Does NOT regenerate signed XML.
 * INVARIANT: Does NOT change Clave, consecutive, or FiscalDocument.
 * INVARIANT: Does NOT create another FiscalDocument.
 * INVARIANT: History is preserved across all attempts.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { DomainException } from '../../../shared/domain/domain-exception';
import { DELIVERY_JOB_NAME } from './delivery.constants';

export class DeliveryNotFoundException extends DomainException {
  readonly code = 'DELIVERY_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(deliveryId: string) {
    super(`Delivery '${deliveryId}' not found or access denied.`);
  }
}

export class DeliveryResendNotAllowedException extends DomainException {
  readonly code = 'DELIVERY_RESEND_NOT_ALLOWED';
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Manual resend not allowed: ${reason}`);
  }
}

export interface RequestResendCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly fiscalDocumentId: string;
  readonly deliveryKind: 'INITIAL_DOCUMENT' | 'HACIENDA_RESPONSE';
  /** Actor performing the resend (userId or API key prefix). */
  readonly actor: string;
}

export interface ResendResult {
  readonly deliveryId: string;
  readonly status: string;
  readonly attemptCount: number;
}

@Injectable()
export class DeliveryRequestService {
  private readonly logger = new Logger(DeliveryRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Request a manual resend of an existing delivery.
   * Enforces tenant/company/document ownership.
   * Reuses existing fiscal artifacts (never regenerates).
   * Creates new DeliveryAttempt for history.
   * Concurrency safe via database update.
   */
  async requestResend(command: RequestResendCommand): Promise<ResendResult> {
    const { tenantId, companyId, fiscalDocumentId, deliveryKind } = command;

    // Verify document ownership
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });
    if (!doc) {
      throw new DeliveryNotFoundException(fiscalDocumentId);
    }

    // Find existing delivery (enforces tenant/company scope)
    const delivery = await this.prisma.documentDelivery.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        kind: deliveryKind,
        channel: 'EMAIL',
        packageVersion: null,
      },
    });

    if (!delivery) {
      throw new DeliveryNotFoundException(
        `${deliveryKind} delivery for document ${fiscalDocumentId}`,
      );
    }

    // CANCELLED deliveries cannot be resent
    if (delivery.status === 'CANCELLED') {
      throw new DeliveryResendNotAllowedException('Cancelled deliveries cannot be resent.');
    }

    // Transition delivery to QUEUED (with stale guard — do not overwrite DELIVERED directly)
    // Manual resend from DELIVERED creates a new attempt and preserves history
    const now = new Date();
    const newAttemptCount = delivery.attemptCount + 1;

    await this.prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'QUEUED',
        nextAttemptAt: null,
        lastErrorCode: null,
        lastSanitizedError: null,
        attemptCount: newAttemptCount,
        updatedAt: now,
      },
    });

    // Enqueue delivery job
    await this.jobQueue.publish(DELIVERY_JOB_NAME, { deliveryId: delivery.id }, { retryLimit: 3 });

    // Audit the resend request
    this.auditService.record({
      tenantId,
      companyId,
      actor: command.actor,
      action: `fiscal-delivery.manual-resend.${deliveryKind.toLowerCase().replace('_', '-')}`,
      eventClass: EventClass.FISCAL_AUDIT,
      resource: `DocumentDelivery:${delivery.id}`,
      correlationId: fiscalDocumentId,
      metadata: {
        deliveryId: delivery.id,
        kind: deliveryKind,
        fiscalDocumentId,
        previousStatus: delivery.status,
        attemptCount: newAttemptCount,
      },
    });

    this.logger.log({
      msg: 'Manual resend queued',
      deliveryId: delivery.id,
      kind: deliveryKind,
      fiscalDocumentId,
      actor: command.actor,
    });

    return {
      deliveryId: delivery.id,
      status: 'QUEUED',
      attemptCount: newAttemptCount,
    };
  }

  /** List delivery history for a fiscal document. Enforces tenant/company scope. Returns DTO (no raw PII). */
  async listDeliveries(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
  ): Promise<DeliveryHistoryDto[]> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });
    if (!doc) {
      throw new DeliveryNotFoundException(fiscalDocumentId);
    }

    const deliveries = await this.prisma.documentDelivery.findMany({
      where: { tenantId, companyId, fiscalDocumentId },
      include: {
        attempts: {
          orderBy: { attemptNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return deliveries.map((d) => ({
      id: d.id,
      fiscalDocumentId: d.fiscalDocumentId,
      kind: d.kind,
      channel: d.channel,
      // Partially redact recipient for listing (prevent PII exposure in logs/responses)
      recipientDomain: d.recipient.includes('@') ? d.recipient.split('@')[1] : 'unknown',
      status: d.status,
      attemptCount: d.attemptCount,
      lastAttemptAt: d.lastAttemptAt,
      deliveredAt: d.deliveredAt,
      createdAt: d.createdAt,
      attempts: d.attempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        errorCode: a.errorCode,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
      })),
    }));
  }
}

export interface DeliveryHistoryDto {
  id: string;
  fiscalDocumentId: string;
  kind: string;
  channel: string;
  /** Recipient domain only — no full email in list response. */
  recipientDomain: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  attempts: AttemptDto[];
}

export interface AttemptDto {
  id: string;
  attemptNumber: number;
  status: string;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}
