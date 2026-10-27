import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

if (
  process.env.RUN_DB_TESTS !== '1' ||
  !process.env.BILLING_TEST_RUN_ID ||
  !process.env.BILLING_TEST_RUN_TOKEN ||
  !process.env.BILLING_TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.BILLING_TEST_DATABASE_URL
) {
  throw new Error('W0 schema verification requires the guarded disposable PostgreSQL harness.');
}

const prisma = new PrismaClient();
try {
  const markers = await prisma.$queryRawUnsafe(
    'SELECT run_id, run_token_hash FROM billing_test_safety.marker WHERE marker_id = 1',
  );
  const tokenHash = createHash('sha256')
    .update(process.env.BILLING_TEST_RUN_TOKEN, 'utf8')
    .digest('hex');
  if (
    markers.length !== 1 ||
    markers[0].run_id !== process.env.BILLING_TEST_RUN_ID ||
    markers[0].run_token_hash.trim() !== tokenHash
  ) {
    throw new Error('Disposable database ownership marker does not match this run.');
  }

  const deployed = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { stdio: 'inherit', env: process.env, windowsHide: true },
  );
  if (deployed.status !== 0) throw new Error('Prisma migrate deploy failed in disposable database.');

  const manifest = JSON.parse(
    readFileSync('docs/operations/billing-w0-migration-manifest.json', 'utf8'),
  );
  const applied = await prisma.$queryRawUnsafe(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
  );
  if (applied.length !== manifest.length) {
    throw new Error(`Expected ${manifest.length} applied migrations, found ${applied.length}.`);
  }
  for (const [index, entry] of manifest.entries()) {
    const row = applied[index];
    if (
      row.migration_name !== entry.name ||
      row.checksum !== entry.sha256 ||
      row.finished_at === null ||
      row.rolled_back_at !== null
    ) {
      throw new Error(`Migration registry differs from reviewed SQL at ${entry.name}.`);
    }
  }

  const indexes = await prisma.$queryRawUnsafe(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'fiscal_idempotency_keys' ORDER BY indexname",
  );
  const stable = indexes.find(
    (row) => row.indexname === 'fiscal_idempotency_keys_tenant_company_operation_key',
  );
  if (
    stable?.indexdef !==
    'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, operation, key)' ||
    indexes.some(
      (row) => row.indexname === 'fiscal_idempotency_keys_tenant_company_api_key_operation_key',
    ) ||
    !indexes.some((row) => row.indexname === 'fiscal_idempotency_keys_api_key_idx')
  ) {
    throw new Error('Effective fiscal idempotency indexes differ from rotation-safe schema.');
  }
  const columns = await prisma.$queryRawUnsafe(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fiscal_idempotency_keys'",
  );
  if (!columns.some((row) => row.column_name === 'api_key_id' && row.is_nullable === 'YES')) {
    throw new Error('Effective api_key_id audit column is missing or not nullable.');
  }

  const status = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'status'],
    { stdio: 'inherit', env: process.env, windowsHide: true },
  );
  if (status.status !== 0) throw new Error('Prisma reports pending migrations in disposable database.');
  const diff = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-schema-datasource',
      'prisma/schema.prisma',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { encoding: 'utf8', env: process.env, windowsHide: true },
  );
  if (diff.status !== 0 && diff.status !== 2) {
    throw new Error('Prisma schema diff failed: ' + (diff.stderr || diff.stdout).trim());
  }
  if (process.env.BILLING_W0_DIFF_OUTPUT) {
    writeFileSync(process.env.BILLING_W0_DIFF_OUTPUT, diff.stdout, 'utf8');
  }
  if (diff.status === 2) console.log('PRISMA_EFFECTIVE_SCHEMA_DIFF\n' + diff.stdout.trim());
  console.log(
    JSON.stringify({
      result: 'W0_DISPOSABLE_SCHEMA_PASS',
      appliedMigrations: applied.length,
      matchingChecksums: applied.length,
      pendingMigrations: 0,
      logicalIdempotencyIndex: stable.indexname,
      legacyKeyScopedIndex: false,
      prismaDatamodelDiff: diff.status === 0 ? 'empty' : 'review-required',
    }),
  );
} finally {
  await prisma.$disconnect();
}
