import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss = require('pg-boss');
import { JobPublishOptions, JobQueuePort } from '../ports/job-queue.port';

@Injectable()
export class PgBossJobQueue implements JobQueuePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossJobQueue.name);
  private boss!: PgBoss;
  private readonly ensuredQueues = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.configService.get<string>('database.url');

    if (!connectionString) {
      throw new Error('DATABASE_URL is required for pg-boss queue initialization.');
    }

    this.boss = new PgBoss({ connectionString, schema: 'pgboss' });

    this.boss.on('error', (err) => {
      this.logger.error({ error: err.message }, 'pg-boss error');
    });

    await this.boss.start();
    this.logger.log('pg-boss queue started successfully');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) {
      await this.boss.stop();
      this.logger.log('pg-boss queue stopped');
    }
  }

  async publish<T extends object>(
    jobName: string,
    payload: T,
    options?: JobPublishOptions,
  ): Promise<void> {
    await this.ensureQueue(jobName);
    const jobId = await this.boss.send(jobName, payload as Record<string, unknown>, {
      retryLimit: options?.retryLimit ?? 3,
      retryDelay: options?.retryDelay ?? 10,
      ...(options?.expireInSeconds ? { expireInSeconds: options.expireInSeconds } : {}),
      ...(options?.startAfterSeconds
        ? { startAfter: new Date(Date.now() + options.startAfterSeconds * 1000) }
        : {}),
      ...(options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options?.singletonSeconds ? { singletonSeconds: options.singletonSeconds } : {}),
    });

    if (jobId === null && !options?.singletonKey) {
      throw new Error(`pg-boss did not persist job '${jobName}'. Queue publication failed.`);
    }
  }

  async schedule<T extends object>(
    jobName: string,
    cronExpression: string,
    payload: T,
  ): Promise<void> {
    await this.ensureQueue(jobName);
    await this.boss.schedule(jobName, cronExpression, payload as Record<string, unknown>);
  }

  /**
   * Registers a job handler to process jobs of the given name.
   */
  async registerHandler<T extends object>(
    jobName: string,
    handler: (job: { data: T }) => Promise<void>,
  ): Promise<void> {
    await this.ensureQueue(jobName);
    await this.boss.work<T>(jobName, async (jobs) => {
      for (const job of jobs) {
        await handler({ data: job.data });
      }
    });
  }

  private async createQueueWithRetry(jobName: string): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.boss.createQueue(jobName);
        return;
      } catch (error: unknown) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        const retryable = code === '40P01' || code === '40001';
        if (!retryable || attempt === maxAttempts) throw error;
        this.logger.warn({ jobName, attempt, code }, 'pg-boss queue creation contention; retrying');
        await new Promise<void>((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  }
  private async ensureQueue(jobName: string): Promise<void> {
    const existing = this.ensuredQueues.get(jobName);
    if (existing) return existing;

    const promise = this.createQueueWithRetry(jobName).catch((error: unknown) => {
      this.ensuredQueues.delete(jobName);
      throw error;
    });
    this.ensuredQueues.set(jobName, promise);
    await promise;
  }
}
