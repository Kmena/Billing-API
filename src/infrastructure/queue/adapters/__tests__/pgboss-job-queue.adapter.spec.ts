import { ConfigService } from '@nestjs/config';
import PgBoss = require('pg-boss');
import { PgBossJobQueue } from '../pgboss-job-queue.adapter';

type BossDouble = {
  createQueue: jest.Mock<Promise<void>, [string]>;
  send: jest.Mock<Promise<string | null>, [string, object, object?]>;
  work: jest.Mock<Promise<string>, [string, (jobs: unknown[]) => Promise<void>]>;
};

function bossOf(queue: PgBossJobQueue): BossDouble {
  return (queue as unknown as { boss: BossDouble }).boss;
}

describe('PgBossJobQueue lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('constructs the real CommonJS export and starts and stops the queue', async () => {
    const start = jest.spyOn(PgBoss.prototype, 'start').mockResolvedValue(undefined as never);
    const stop = jest.spyOn(PgBoss.prototype, 'stop').mockResolvedValue();
    const queue = new PgBossJobQueue(
      new ConfigService({ database: { url: 'postgresql://localhost/billing_queue_test' } }),
    );

    await queue.onModuleInit();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.instances[0]).toBeInstanceOf(PgBoss);

    await queue.onModuleDestroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports missing configuration and allows cleanup after initialization fails', async () => {
    const queue = new PgBossJobQueue(new ConfigService());

    await expect(queue.onModuleInit()).rejects.toThrow(
      'DATABASE_URL is required for pg-boss queue initialization.',
    );
    await expect(queue.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('creates the queue before durable publish and uses singleton options', async () => {
    jest.spyOn(PgBoss.prototype, 'start').mockResolvedValue(undefined as never);
    const queue = new PgBossJobQueue(
      new ConfigService({ database: { url: 'postgresql://localhost/billing_queue_test' } }),
    );

    await queue.onModuleInit();
    const boss = bossOf(queue);
    boss.createQueue = jest.fn().mockResolvedValue(undefined);
    boss.send = jest.fn().mockResolvedValue('job-id');
    await queue.publish(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      { retryLimit: 3, retryDelay: 60, singletonKey: 'submit:submission-id' },
    );

    expect(boss.createQueue).toHaveBeenCalledWith('fiscal-documents.submit-to-hacienda');
    expect(boss.send).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.objectContaining({ singletonKey: 'submit:submission-id' }),
    );
  });

  it('throws when pg-boss does not persist a non-singleton job', async () => {
    jest.spyOn(PgBoss.prototype, 'start').mockResolvedValue(undefined as never);
    const queue = new PgBossJobQueue(
      new ConfigService({ database: { url: 'postgresql://localhost/billing_queue_test' } }),
    );

    await queue.onModuleInit();
    const boss = bossOf(queue);
    boss.createQueue = jest.fn().mockResolvedValue(undefined);
    boss.send = jest.fn().mockResolvedValue(null);
    await expect(queue.publish('missing-durable-job', { ok: true })).rejects.toThrow(
      "pg-boss did not persist job 'missing-durable-job'",
    );
  });

  it('treats singleton send null as duplicate active work and processes worker batches', async () => {
    jest.spyOn(PgBoss.prototype, 'start').mockResolvedValue(undefined as never);
    const handler = jest.fn().mockResolvedValue(undefined);
    const queue = new PgBossJobQueue(
      new ConfigService({ database: { url: 'postgresql://localhost/billing_queue_test' } }),
    );

    await queue.onModuleInit();
    const boss = bossOf(queue);
    boss.createQueue = jest.fn().mockResolvedValue(undefined);
    boss.send = jest.fn().mockResolvedValue(null);
    boss.work = jest.fn(
      async (_name: string, registeredHandler: (jobs: unknown[]) => Promise<void>) => {
        await registeredHandler([{ data: { submissionId: 'submission-id' } }]);
        return 'worker-id';
      },
    );
    await expect(
      queue.publish(
        'fiscal-documents.submit-to-hacienda',
        { submissionId: 'submission-id' },
        {
          singletonKey: 'submit:submission-id',
        },
      ),
    ).resolves.toBeUndefined();
    await queue.registerHandler('fiscal-documents.submit-to-hacienda', handler);

    expect(boss.work).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ data: { submissionId: 'submission-id' } });
  });

  it('processes every job in a pg-boss batch instead of silently discarding later jobs', async () => {
    jest.spyOn(PgBoss.prototype, 'start').mockResolvedValue(undefined as never);
    const handler = jest.fn().mockResolvedValue(undefined);
    const queue = new PgBossJobQueue(
      new ConfigService({ database: { url: 'postgresql://localhost/billing_queue_test' } }),
    );

    await queue.onModuleInit();
    const boss = bossOf(queue);
    boss.createQueue = jest.fn().mockResolvedValue(undefined);
    boss.work = jest.fn(
      async (_name: string, registeredHandler: (jobs: unknown[]) => Promise<void>) => {
        await registeredHandler([
          { data: { submissionId: 'submission-1' } },
          { data: { submissionId: 'submission-2' } },
          { data: { submissionId: 'submission-3' } },
        ]);
        return 'worker-id';
      },
    );

    await queue.registerHandler('fiscal-documents.submit-to-hacienda', handler);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, { data: { submissionId: 'submission-1' } });
    expect(handler).toHaveBeenNthCalledWith(2, { data: { submissionId: 'submission-2' } });
    expect(handler).toHaveBeenNthCalledWith(3, { data: { submissionId: 'submission-3' } });
  });
});
