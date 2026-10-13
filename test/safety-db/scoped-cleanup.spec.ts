import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createGuardedTestPrisma } from '../helpers/guarded-test-prisma';
import {
  assertOwnedTestTenants,
  registerOwnedTestTenant,
  releaseOwnedTestTenants,
} from '../helpers/test-database-ownership';

describe('disposable database scoped cleanup', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('denies cleanup without an owned tenant set', async () => {
    await expect(assertOwnedTestTenants(prisma, [])).rejects.toThrow(
      'one or more valid owned tenant IDs',
    );
  });

  it('denies cleanup for a foreign tenant', async () => {
    await expect(assertOwnedTestTenants(prisma, [randomUUID()])).rejects.toThrow(
      'foreign or unowned tenant',
    );
  });

  it('denies cleanup when the marker disappears immediately before deletion', async () => {
    const tenantId = randomUUID();
    await registerOwnedTestTenant(prisma, tenantId);
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'P0 marker removal tenant',
        slug: 'p0-marker-' + tenantId.slice(0, 8),
      },
    });

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(
          Prisma.raw('DELETE FROM billing_test_safety.marker WHERE marker_id = 1'),
        );
        await assertOwnedTestTenants(transaction as unknown as PrismaClient, [tenantId]);
        await transaction.tenant.deleteMany({ where: { id: tenantId } });
      }),
    ).rejects.toThrow('marker');

    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
    await assertOwnedTestTenants(prisma, [tenantId]);
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await releaseOwnedTestTenants(prisma, [tenantId]);
  });

  it('accepts cleanup only for a tenant owned by this run', async () => {
    const tenantId = randomUUID();
    await registerOwnedTestTenant(prisma, tenantId);
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'P0 owned cleanup tenant',
        slug: 'p0-owned-' + tenantId.slice(0, 8),
      },
    });

    await assertOwnedTestTenants(prisma, [tenantId]);
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await releaseOwnedTestTenants(prisma, [tenantId]);

    expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
  });
});
