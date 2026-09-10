import { ConfigService } from '@nestjs/config';
import PgBoss = require('pg-boss');
import { PgBossJobQueue } from '../pgboss-job-queue.adapter';

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
});
