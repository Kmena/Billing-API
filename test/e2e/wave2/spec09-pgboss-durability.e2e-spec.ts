import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { PgBossJobQueue } from '../../../src/infrastructure/queue/adapters/pgboss-job-queue.adapter';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';

describe('SPEC-09 durable submission queue on disposable PostgreSQL', () => {
  jest.setTimeout(45_000);
  const jobName = 'spec09-synthetic-submission';
  let prisma: PrismaClient;
  let databaseUrl: string;
  let first: PgBossJobQueue;
  let restarted: PgBossJobQueue;

  beforeAll(async () => {
    const guarded = await createGuardedTestPrisma();
    prisma = guarded.prisma;
    databaseUrl = guarded.database.databaseUrl;
    const config = new ConfigService({ database: { url: databaseUrl } });
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
    restarted = new PgBossJobQueue(new ConfigService({ database: { url: databaseUrl } }));
    await restarted.onModuleInit();
    const after = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pgboss.job WHERE name = ${jobName}`;
    expect(after[0]?.count).toBe(1n);
  });
});
