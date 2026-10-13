import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PgBossJobQueue } from '../../../src/infrastructure/queue/adapters/pgboss-job-queue.adapter';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';

describe('Wave 2 durable queue singleton — disposable PostgreSQL', () => {
  it('allows two independent publishers but persists one active logical job', async () => {
    const { prisma } = await createGuardedTestPrisma();
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl).toBeDefined();
    const config = new ConfigService({ database: { url: databaseUrl } });
    const first = new PgBossJobQueue(config);
    const second = new PgBossJobQueue(config);
    const cases = Array.from({ length: 5 }, () => ({
      queueName: `wave2-singleton-${randomUUID()}`,
      deliveryId: randomUUID(),
    }));

    try {
      await first.onModuleInit();
      await second.onModuleInit();
      for (const { queueName, deliveryId } of cases) {
        await Promise.all([
          first.publish(
            queueName,
            { deliveryId },
            {
              singletonKey: `fiscal-delivery:${deliveryId}`,
              singletonSeconds: 15 * 60,
            },
          ),
          second.publish(
            queueName,
            { deliveryId },
            {
              singletonKey: `fiscal-delivery:${deliveryId}`,
              singletonSeconds: 15 * 60,
            },
          ),
        ]);

        const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS "count"
             FROM pgboss.job
            WHERE name = $1
              AND data ->> 'deliveryId' = $2`,
          queueName,
          deliveryId,
        );
        expect(rows).toEqual([{ count: 1 }]);
      }
    } finally {
      await Promise.allSettled([first.onModuleDestroy(), second.onModuleDestroy()]);
      await prisma.$disconnect();
    }
  });
});
