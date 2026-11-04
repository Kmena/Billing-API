import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PgBossJobQueue } from '../../../src/infrastructure/queue/adapters/pgboss-job-queue.adapter';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';

describe('SPEC-09 durable submission queue on disposable PostgreSQL', () => {
  jest.setTimeout(45_000);
  const jobName = 'spec09-synthetic-submission';
  let prisma: PrismaClient;
  let first: PgBossJobQueue;
  let restarted: PgBossJobQueue;

  beforeAll(async () => {
    installGuardedTestDatabaseEnvironment();
    const url = process.env.BILLING_TEST_DATABASE_URL;
    if (!url) throw new Error('Disposable PostgreSQL required');
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const config = new ConfigService({ database: { url } });
    first = new PgBossJobQueue(config);
    await first.onModuleInit();
  });

  afterAll(async () => {
    if (restarted) await restarted.onModuleDestroy();
    else if (first) await first.onModuleDestroy();
    if (prisma) await prisma.$disconnect();
  });

  it('retains one queued job through a queue process restart', async () => {
    await first.publish(
      jobName,
      { documentId: 'synthetic-only' },
      { singletonKey: 'spec09-synthetic-idempotency', singletonSeconds: 3600 },
    );
    await first.publish(
      jobName,
      { documentId: 'synthetic-only' },
      { singletonKey: 'spec09-synthetic-idempotency', singletonSeconds: 3600 },
    );
    const before = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pgboss.job WHERE name = ${jobName}`;
    expect(before[0]?.count).toBe(1n);
    await first.onModuleDestroy();
    const url = process.env.BILLING_TEST_DATABASE_URL!;
    restarted = new PgBossJobQueue(new ConfigService({ database: { url } }));
    await restarted.onModuleInit();
    const after = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pgboss.job WHERE name = ${jobName}`;
    expect(after[0]?.count).toBe(1n);
  });
});
