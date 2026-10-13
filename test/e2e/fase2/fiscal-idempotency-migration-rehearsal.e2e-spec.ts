import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  resetFiscalE2eData,
  type FiscalE2eContext,
  type FiscalTenantFixture,
} from '../../helpers/fiscal-e2e-helpers';

const TARGET_MIGRATION = '20261110000000_make_fiscal_idempotency_rotation_safe';

function deployPendingMigrations() {
  return spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('Fiscal idempotency migration historical rehearsal (E2E, disposable PostgreSQL)', () => {
  let context: FiscalE2eContext;
  let fixture: FiscalTenantFixture;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
    fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
  });

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('preserves a historical reservation/document while upgrading from the legacy key-scoped index', async () => {
    const originalKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
    ]);
    const rotatedKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, originalKey.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, rotatedKey.id, fixture.companyId);

    const idempotencyKey = 'historical-rehearsal-inv-966';
    const payload = fiscalInvoicePayload(fixture.companyId);
    const original = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', originalKey.secret)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const reservationBefore = await context.prisma.fiscalIdempotencyKey.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        operation: 'fiscal-document.create.invoice',
        key: idempotencyKey,
      },
    });
    const sequenceBefore = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });

    await context.prisma.$executeRawUnsafe(
      'DROP INDEX "fiscal_idempotency_keys_tenant_company_operation_key"',
    );
    await context.prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "fiscal_idempotency_keys_tenant_company_api_key_operation_key" ON "fiscal_idempotency_keys"("tenant_id", "company_id", "api_key_id", "operation", "key")',
    );
    await context.prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = '${TARGET_MIGRATION}'`,
    );

    const migration = deployPendingMigrations();
    expect(migration.status).toBe(0);

    const reservationAfterMigration = await context.prisma.fiscalIdempotencyKey.findUniqueOrThrow({
      where: {
        tenantId_companyId_operation_key: {
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          operation: 'fiscal-document.create.invoice',
          key: idempotencyKey,
        },
      },
    });
    expect(reservationAfterMigration.id).toBe(reservationBefore.id);
    expect(reservationAfterMigration.fiscalDocumentId).toBe(reservationBefore.fiscalDocumentId);
    expect(reservationAfterMigration.apiKeyId).toBe(originalKey.id);

    const [originalReplay, rotatedReplay] = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', originalKey.secret)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', rotatedKey.secret)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
    ]);
    expect([originalReplay.status, rotatedReplay.status]).toEqual([201, 201]);
    for (const replay of [originalReplay, rotatedReplay]) {
      expect(replay.body.id).toBe(original.body.id);
      expect(replay.body.clave).toBe(original.body.clave);
      expect(replay.body.consecutive).toBe(original.body.consecutive);
    }

    const changed = fiscalInvoicePayload(fixture.companyId);
    changed.lines[0].unitPrice = '2000.00000';
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', rotatedKey.secret)
      .set('Idempotency-Key', idempotencyKey)
      .send(changed)
      .expect(409);

    const sequenceAfter = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });
    expect(sequenceAfter.nextValue).toEqual(sequenceBefore.nextValue);
    await expect(
      context.prisma.fiscalDocument.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: 'INVOICE' },
      }),
    ).resolves.toBe(1);
  });

  it('accepts the already-stable A-shaped index state without rewriting fiscal data', async () => {
    const before = {
      reservations: await context.prisma.fiscalIdempotencyKey.count(),
      documents: await context.prisma.fiscalDocument.count(),
      sequences: await context.prisma.fiscalSequence.findMany({
        select: { id: true, nextValue: true, lastAssigned: true },
        orderBy: { id: 'asc' },
      }),
    };
    await context.prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = '${TARGET_MIGRATION}'`,
    );

    const migration = deployPendingMigrations();
    expect(migration.status).toBe(0);
    await expect(context.prisma.fiscalIdempotencyKey.count()).resolves.toBe(before.reservations);
    await expect(context.prisma.fiscalDocument.count()).resolves.toBe(before.documents);
    await expect(
      context.prisma.fiscalSequence.findMany({
        select: { id: true, nextValue: true, lastAssigned: true },
        orderBy: { id: 'asc' },
      }),
    ).resolves.toEqual(before.sequences);
  });

  it('fails closed transactionally when rotated keys already own conflicting logical rows', async () => {
    const keyA = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    const keyB = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, keyA.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, keyB.id, fixture.companyId);
    await context.prisma.$executeRawUnsafe(
      'DROP INDEX "fiscal_idempotency_keys_tenant_company_operation_key"',
    );
    await context.prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "fiscal_idempotency_keys_tenant_company_api_key_operation_key" ON "fiscal_idempotency_keys"("tenant_id", "company_id", "api_key_id", "operation", "key")',
    );
    const logicalKey = 'migration-conflicting-rotated-keys';
    await context.prisma.fiscalIdempotencyKey.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          apiKeyId: keyA.id,
          operation: 'fiscal-document.create.invoice',
          key: logicalKey,
          requestHash: 'a'.repeat(64),
          status: 'IN_PROGRESS',
        },
        {
          id: randomUUID(),
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          apiKeyId: keyB.id,
          operation: 'fiscal-document.create.invoice',
          key: logicalKey,
          requestHash: 'b'.repeat(64),
          status: 'IN_PROGRESS',
        },
      ],
    });
    await context.prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = '${TARGET_MIGRATION}'`,
    );

    try {
      const migration = deployPendingMigrations();
      expect(migration.status).not.toBe(0);
      await expect(
        context.prisma.fiscalIdempotencyKey.count({ where: { key: logicalKey } }),
      ).resolves.toBe(2);
      const indexes = await context.prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'fiscal_idempotency_keys'`,
      );
      expect(indexes.map(({ indexname }) => indexname)).toContain(
        'fiscal_idempotency_keys_tenant_company_api_key_operation_key',
      );
      expect(indexes.map(({ indexname }) => indexname)).not.toContain(
        'fiscal_idempotency_keys_tenant_company_operation_key',
      );
    } finally {
      await context.prisma.fiscalIdempotencyKey.deleteMany({ where: { key: logicalKey } });
      await context.prisma.$executeRawUnsafe(
        'DROP INDEX IF EXISTS "fiscal_idempotency_keys_tenant_company_api_key_operation_key"',
      );
      await context.prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_idempotency_keys_tenant_company_operation_key" ON "fiscal_idempotency_keys"("tenant_id", "company_id", "operation", "key")',
      );
      await context.prisma.$executeRawUnsafe(
        `DELETE FROM "_prisma_migrations" WHERE migration_name = '${TARGET_MIGRATION}'`,
      );
      const restored = deployPendingMigrations();
      expect(restored.status).toBe(0);
    }
  });
});
