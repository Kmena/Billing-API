import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { assertDisposableDatabaseMarker, TestEnvironment } from './test-database-safety';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OwnedTenantRow {
  readonly tenant_id: string;
}

function requireTenantIds(tenantIds: readonly string[]): readonly string[] {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0 || unique.some((tenantId) => !UUID_PATTERN.test(tenantId))) {
    throw new Error('Scoped test cleanup requires one or more valid owned tenant IDs.');
  }
  return unique;
}

export async function registerOwnedTestTenant(
  prisma: PrismaClient,
  tenantId: string,
  env: TestEnvironment = process.env,
): Promise<void> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error('Test tenant ownership requires a valid tenant UUID.');
  }
  const guarded = await assertDisposableDatabaseMarker(prisma, env);
  const sql =
    'INSERT INTO billing_test_safety.tenant_ownership ' +
    '(tenant_id, run_id, run_token_hash, expires_at) VALUES (' +
    "'" +
    tenantId +
    "', '" +
    guarded.runId +
    "', '" +
    guarded.runTokenHash +
    "', (SELECT expires_at FROM billing_test_safety.marker WHERE marker_id = 1)) " +
    'ON CONFLICT (tenant_id) DO UPDATE SET ' +
    'run_id = EXCLUDED.run_id, run_token_hash = EXCLUDED.run_token_hash, ' +
    'expires_at = EXCLUDED.expires_at';
  await prisma.$executeRaw(Prisma.raw(sql));
}

export async function assertOwnedTestTenants(
  prisma: PrismaClient,
  tenantIds: readonly string[],
  env: TestEnvironment = process.env,
): Promise<readonly string[]> {
  const unique = requireTenantIds(tenantIds);
  const guarded = await assertDisposableDatabaseMarker(prisma, env);
  const ids = unique.map((tenantId) => "'" + tenantId + "'").join(', ');
  const sql =
    'SELECT tenant_id::text FROM billing_test_safety.tenant_ownership WHERE ' +
    "run_id = '" +
    guarded.runId +
    "' AND run_token_hash = '" +
    guarded.runTokenHash +
    "' AND expires_at > now() AND tenant_id IN (" +
    ids +
    ')';
  const rows = await prisma.$queryRaw<OwnedTenantRow[]>(Prisma.raw(sql));
  const owned = new Set(rows.map((row) => row.tenant_id));
  if (unique.some((tenantId) => !owned.has(tenantId))) {
    throw new Error('Scoped test cleanup refused a foreign or unowned tenant.');
  }
  return unique;
}

export async function releaseOwnedTestTenants(
  prisma: PrismaClient,
  tenantIds: readonly string[],
  env: TestEnvironment = process.env,
): Promise<void> {
  const unique = await assertOwnedTestTenants(prisma, tenantIds, env);
  const guarded = await assertDisposableDatabaseMarker(prisma, env);
  const ids = unique.map((tenantId) => "'" + tenantId + "'").join(', ');
  const sql =
    'DELETE FROM billing_test_safety.tenant_ownership WHERE ' +
    "run_id = '" +
    guarded.runId +
    "' AND run_token_hash = '" +
    guarded.runTokenHash +
    "' AND tenant_id IN (" +
    ids +
    ')';
  await prisma.$executeRaw(Prisma.raw(sql));
}
