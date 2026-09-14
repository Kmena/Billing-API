import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss = require('pg-boss');
import { JobPublishOptions, JobQueuePort } from '../ports/job-queue.port';

@Injectable()
export class PgBossJobQueue implements JobQueuePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossJobQueue.name);
  private boss!: PgBoss;

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
    await this.boss.send(jobName, payload as Record<string, unknown>, {
      retryLimit: options?.retryLimit ?? 3,
      retryDelay: options?.retryDelay ?? 10,
      ...(options?.expireInSeconds ? { expireInSeconds: options.expireInSeconds } : {}),
      ...(options?.startAfterSeconds
        ? { startAfter: new Date(Date.now() + options.startAfterSeconds * 1000) }
        : {}),
    });
  }

  async schedule<T extends object>(
    jobName: string,
    cronExpression: string,
    payload: T,
  ): Promise<void> {
    await this.boss.schedule(jobName, cronExpression, payload as Record<string, unknown>);
  }

  /**
   * Registers a job handler to process jobs of the given name.
   */
  async registerHandler<T extends object>(
    jobName: string,
    handler: (job: { data: T }) => Promise<void>,
  ): Promise<void> {
    await this.boss.work(jobName, async (job) => {
      await handler(job as unknown as { data: T });
    });
  }
}
