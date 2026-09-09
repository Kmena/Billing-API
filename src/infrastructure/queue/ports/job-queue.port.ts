export interface JobPublishOptions {
  readonly retryLimit?: number;
  readonly retryDelay?: number; // seconds
  readonly expireInSeconds?: number;
  readonly startAfterSeconds?: number;
}

export interface JobQueuePort {
  /**
   * Publishes a job to the queue.
   * The job will be picked up by a worker and processed at least once.
   */
  publish<T extends object>(
    jobName: string,
    payload: T,
    options?: JobPublishOptions,
  ): Promise<void>;

  /**
   * Schedules a recurring job using a cron expression.
   */
  schedule<T extends object>(jobName: string, cronExpression: string, payload: T): Promise<void>;
}

export const JOB_QUEUE = Symbol('JobQueuePort');
