import { Injectable, Logger } from '@nestjs/common';
import { JobPublishOptions, JobQueuePort } from '../ports/job-queue.port';

type JobHandler<T> = (payload: T) => Promise<void>;

/**
 * In-memory implementation of JobQueuePort for use in tests.
 * Executes handlers synchronously when publish() is called.
 */
@Injectable()
export class InMemoryJobQueue implements JobQueuePort {
  private readonly logger = new Logger(InMemoryJobQueue.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler<unknown>);
  }

  async registerHandler<T extends object>(
    jobName: string,
    handler: (job: { data: T }) => Promise<void>,
  ): Promise<void> {
    this.register(jobName, async (payload: T) => handler({ data: payload }));
  }

  async publish<T extends object>(
    jobName: string,
    payload: T,
    _options?: JobPublishOptions,
  ): Promise<void> {
    const handler = this.handlers.get(jobName);
    if (handler) {
      await handler(payload);
    } else {
      this.logger.debug(`No handler registered for job '${jobName}' — payload queued (ignored).`);
    }
  }

  async schedule<T extends object>(
    jobName: string,
    _cronExpression: string,
    _payload: T,
  ): Promise<void> {
    this.logger.debug(`InMemoryJobQueue: schedule('${jobName}') — no-op in test mode.`);
  }
}
