/**
 * Database-discovered delivery recovery. Queue presence is only a notification;
 * DocumentDelivery remains the durable source of work.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { DELIVERY_JOB_NAME } from './delivery.constants';

export interface DeliveryRecoverySummary {
  readonly discovered: number;
  readonly republished: number;
  readonly dueRetriesQueued: number;
  readonly staleClaimsEscalated: number;
  readonly publicationFailures: number;
}

@Injectable()
export class DurableDeliveryRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DurableDeliveryRecoveryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<boolean>('FISCAL_DELIVERY_RECOVERY_ENABLED') !== true) {
      this.logger.log({ msg: 'Durable delivery recovery disabled by configuration' });
      return;
    }

    // An explicit watermark prevents a new worker from silently replaying legacy mail.
    this.activationStartAt();
    await this.recoverOnce();
    const cadenceMs = this.config.get<number>('FISCAL_DELIVERY_RECOVERY_INTERVAL_MS') ?? 60_000;
    this.timer = setInterval(() => {
      void this.recoverOnce().catch((error: unknown) =>
        this.logger.warn({ msg: 'Durable delivery recovery scan failed', error: String(error) }),
      );
    }, cadenceMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recoverOnce(now = new Date()): Promise<DeliveryRecoverySummary> {
    const startAt = this.activationStartAt();
    const maxAgeHours = this.config.get<number>('FISCAL_DELIVERY_RECOVERY_MAX_AGE_HOURS') ?? 72;
    const maxBatch = this.config.get<number>('FISCAL_DELIVERY_RECOVERY_MAX_BATCH') ?? 100;
    const leaseSeconds = this.config.get<number>('FISCAL_DELIVERY_RECOVERY_LEASE_SECONDS') ?? 300;
    const oldestAllowed = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);
    const scopeStart = startAt > oldestAllowed ? startAt : oldestAllowed;
    const staleBefore = new Date(now.getTime() - leaseSeconds * 1000);

    // A stale SENDING row has an unknowable SMTP outcome. Do not replay it.
    const stale = await this.prisma.documentDelivery.updateMany({
      where: {
        status: 'SENDING',
        createdAt: { gte: scopeStart },
        lastAttemptAt: { lt: staleBefore },
      },
      data: {
        status: 'MANUAL_REVIEW_REQUIRED',
        lastErrorCode: 'UNKNOWN_EXTERNAL_OUTCOME',
        lastSanitizedError: 'Worker lease expired; SMTP acceptance is unknown.',
        updatedAt: now,
      },
    });

    const dueRetries = await this.prisma.documentDelivery.updateMany({
      where: {
        status: 'RETRY_PENDING',
        createdAt: { gte: scopeStart },
        nextAttemptAt: { lte: now },
      },
      data: { status: 'QUEUED', nextAttemptAt: null, updatedAt: now },
    });

    const candidates = await this.prisma.documentDelivery.findMany({
      where: { status: 'QUEUED', createdAt: { gte: scopeStart } },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: maxBatch,
    });

    let republished = 0;
    let publicationFailures = 0;
    for (const candidate of candidates) {
      try {
        await this.jobQueue.publish(
          DELIVERY_JOB_NAME,
          { deliveryId: candidate.id },
          {
            retryLimit: 3,
            retryDelay: 60,
            singletonKey: `fiscal-delivery:${candidate.id}`,
            singletonSeconds: 15 * 60,
          },
        );
        republished += 1;
      } catch (error: unknown) {
        publicationFailures += 1;
        // Keep QUEUED work intact; the next scan will retry publication.
        this.logger.warn({
          msg: 'Durable delivery recovery could not publish queued delivery',
          deliveryId: candidate.id,
          error: String(error),
        });
      }
    }

    const summary = {
      discovered: candidates.length,
      republished,
      dueRetriesQueued: dueRetries.count,
      staleClaimsEscalated: stale.count,
      publicationFailures,
    };
    this.logger.log({ msg: 'Durable delivery recovery scan completed', ...summary });
    return summary;
  }

  private activationStartAt(): Date {
    const configured = this.config.get<string>('FISCAL_DELIVERY_RECOVERY_START_AT');
    if (!configured) {
      throw new Error(
        'FISCAL_DELIVERY_RECOVERY_ENABLED=true requires FISCAL_DELIVERY_RECOVERY_START_AT.',
      );
    }
    const startAt = new Date(configured);
    if (Number.isNaN(startAt.getTime())) {
      throw new Error('FISCAL_DELIVERY_RECOVERY_START_AT must be an ISO date.');
    }
    return startAt;
  }
}
