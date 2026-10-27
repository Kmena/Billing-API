import { Controller, Get, INestApplication, Req, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { FiscalConsumersLabModule } from '../../../src/modules/fiscal-consumers/fiscal-consumers-lab.module';
import {
  ConsumerV2Guard,
  ConsumerV2Principal,
} from '../../../src/modules/fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2RequiredScope } from '../../../src/modules/fiscal-consumers/infrastructure/http/consumer-v2-scope.decorator';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { createTestCompany, createTestTenant } from '../../helpers/test-factories';
import {
  assertOwnedTestTenants,
  releaseOwnedTestTenants,
} from '../../helpers/test-database-ownership';

@Controller('api/v2/lab/companies/:companyId/:environment')
@UseGuards(ConsumerV2Guard)
class LabOnlyConsumerController {
  @Get('readiness')
  @ConsumerV2RequiredScope('fiscal-v2:readiness:read')
  readiness(@Req() requestContext: { consumerV2: ConsumerV2Principal }) {
    return requestContext.consumerV2;
  }

  @Get('operations')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  operations(@Req() requestContext: { consumerV2: ConsumerV2Principal }) {
    return requestContext.consumerV2;
  }
}

const hash = 'a'.repeat(64);
const expiresAt = () => new Date(Date.now() + 30 * 86_400_000);
const scopes = ['fiscal-v2:readiness:read', 'fiscal-v2:operations:read'] as const;
type Link = {
  consumerId: string;
  associationId: string;
  companyId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
};
type Issued = { apiKeyId: string; secret: string };

describe('W1-D2 isolated PostgreSQL and M2M guard lab', () => {
  jest.setTimeout(120000);
  let prisma: PrismaClient;
  let app: INestApplication;
  let service: ConsumerV2LabService;
  let tenantA: string;
  let tenantB: string;
  let companyA1: string;
  let companyA2: string;
  let companyB: string;
  let first: Link;
  let partner: Link;
  let otherIssuer: Link;
  let foreign: Link;
  let production: Link;
  let firstKey: Issued;
  let partnerKey: Issued;
  let otherKey: Issued;
  let foreignKey: Issued;
  let productionKey: Issued;

  const path = (companyId: string, environment = 'SANDBOX', operation = 'operations') =>
    `/api/v2/lab/companies/${companyId}/${environment}/${operation}`;
  const principal = (link: Link, key: Issued, tenantId: string): ConsumerV2Principal => ({
    tenantId,
    consumerId: link.consumerId,
    associationId: link.associationId,
    companyId: link.companyId,
    environment: link.environment,
    apiKeyId: key.apiKeyId,
  });
  const register = (
    tenantId: string,
    companyId: string,
    provider: string,
    externalConsumerKey: string,
    externalCompanyKey: string,
    environment: 'SANDBOX' | 'PRODUCTION',
  ) =>
    service.registerAssociation({
      tenantId,
      companyId,
      provider,
      externalConsumerKey,
      externalCompanyKey,
      environment,
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
  const issue = (tenantId: string, associationId: string, requestedScopes = [...scopes]) =>
    service.issueKey({
      tenantId,
      associationId,
      scopes: requestedScopes,
      expiresAt: expiresAt(),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
  const operation = (
    p: ConsumerV2Principal,
    requestHash = hash,
    idempotencyKey = 'synthetic-invoice-1',
  ) => ({
    principal: p,
    operation: 'CREATE_INVOICE' as const,
    idempotencyKey,
    requestHashVersion: 'synthetic-sha256-v1',
    requestHash,
    correlationId: randomUUID(),
  });

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
    const module = await Test.createTestingModule({
      imports: [FiscalConsumersLabModule],
      controllers: [LabOnlyConsumerController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    service = app.get(ConsumerV2LabService);
    tenantA = (await createTestTenant(prisma)).id;
    tenantB = (await createTestTenant(prisma)).id;
    companyA1 = (await createTestCompany(prisma, tenantA)).id;
    companyA2 = (await createTestCompany(prisma, tenantA)).id;
    companyB = (await createTestCompany(prisma, tenantB)).id;
    first = await register(tenantA, companyA1, 'AFFILIATIONS', 'app-1', 'issuer-1', 'SANDBOX');
    partner = await register(tenantA, companyA1, 'PARTNER', 'app-2', 'issuer-1', 'SANDBOX');
    otherIssuer = await register(
      tenantA,
      companyA2,
      'AFFILIATIONS',
      'app-1',
      'issuer-2',
      'SANDBOX',
    );
    foreign = await register(tenantB, companyB, 'FOREIGN', 'app-3', 'issuer-3', 'SANDBOX');
    production = await register(
      tenantA,
      companyA1,
      'AFFILIATIONS',
      'app-1',
      'issuer-1',
      'PRODUCTION',
    );
    firstKey = await issue(tenantA, first.associationId);
    partnerKey = await issue(tenantA, partner.associationId);
    otherKey = await issue(tenantA, otherIssuer.associationId);
    foreignKey = await issue(tenantB, foreign.associationId);
    productionKey = await issue(tenantA, production.associationId);
  });

  afterAll(async () => {
    if (prisma && tenantA && tenantB) {
      const ids = await assertOwnedTestTenants(prisma, [tenantA, tenantB]);
      const tenantScope = { tenantId: { in: [...ids] } };
      await prisma.fiscalIdempotencyKeyV2.deleteMany({ where: tenantScope });
      await prisma.fiscalDocument.deleteMany({ where: tenantScope });
      await prisma.fiscalIssuancePoint.deleteMany({ where: tenantScope });
      await prisma.fiscalConsumerKeyBinding.deleteMany({ where: tenantScope });
      await prisma.auditLog.deleteMany({ where: tenantScope });
      await prisma.apiKey.deleteMany({ where: tenantScope });
      await prisma.fiscalConsumerAssociation.deleteMany({ where: tenantScope });
      await prisma.fiscalConsumerCompany.deleteMany({ where: tenantScope });
      await prisma.fiscalConsumer.deleteMany({ where: tenantScope });
      await prisma.company.deleteMany({ where: tenantScope });
      await prisma.tenant.deleteMany({ where: { id: { in: [...ids] } } });
      await releaseOwnedTestTenants(prisma, ids);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it('applies 25 migrations and has five new tables with namespace and tenant constraints', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(migrations).toHaveLength(25);
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
        AND table_name IN ('fiscal_consumers', 'fiscal_consumer_companies',
          'fiscal_consumer_associations', 'fiscal_consumer_key_bindings', 'fiscal_idempotency_keys_v2')`;
    expect(tables).toHaveLength(5);
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('fiscal_idempotency_keys_v2_namespace_key',
          'fiscal_consumer_companies_tenant_consumer_external_key',
          'fiscal_consumer_associations_company_environment_key')`;
    expect(indexes).toHaveLength(3);
    expect(await prisma.fiscalIntegrationAssociation.count()).toBe(0);
    expect(await prisma.fiscalIdempotencyKey.count()).toBe(0);
  });

  it('preserves stable association identity across environments and blocks remapping', async () => {
    const replay = await register(
      tenantA,
      companyA1,
      'AFFILIATIONS',
      'app-1',
      'issuer-1',
      'SANDBOX',
    );
    expect(replay).toEqual(first);
    expect(production.consumerId).toBe(first.consumerId);
    expect(production.associationId).not.toBe(first.associationId);
    await expect(
      register(tenantA, companyA2, 'AFFILIATIONS', 'app-1', 'issuer-1', 'SANDBOX'),
    ).rejects.toMatchObject({ status: 409 });
    expect(partner.consumerId).not.toBe(first.consumerId);
    expect(partner.companyId).toBe(first.companyId);
  });

  it('enforces the key binding, scope, tenant, issuer, environment and profile over HTTP', async () => {
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', firstKey.secret)
      .expect(200)
      .expect(({ body }) => expect(body.associationId).toBe(first.associationId));
    await request(app.getHttpServer())
      .get(path(companyA2))
      .set('X-API-Key', firstKey.secret)
      .expect(403);
    await request(app.getHttpServer())
      .get(path(companyB))
      .set('X-API-Key', firstKey.secret)
      .expect(404);
    await request(app.getHttpServer())
      .get(path(companyA1, 'PRODUCTION'))
      .set('X-API-Key', firstKey.secret)
      .expect(403);
    await request(app.getHttpServer())
      .get(path(companyA1, 'PRODUCTION'))
      .set('X-API-Key', productionKey.secret)
      .expect(200);
    await request(app.getHttpServer()).get(path(companyA1)).set('X-API-Key', 'invalid').expect(401);
    await request(app.getHttpServer()).get(path(companyA1)).expect(401);
    await request(app.getHttpServer())
      .get(path(companyB))
      .set('X-API-Key', foreignKey.secret)
      .expect(200);
    const readinessOnly = await service.issueKey({
      tenantId: tenantA,
      associationId: partner.associationId,
      scopes: ['fiscal-v2:readiness:read'],
      expiresAt: expiresAt(),
      rotationEndsAt: new Date(Date.now() + 3600_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await request(app.getHttpServer())
      .get(path(companyA1, 'SANDBOX', 'readiness'))
      .set('X-API-Key', readinessOnly.secret)
      .expect(200);
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', readinessOnly.secret)
      .expect(403);
  });

  it('denies a suspended tenant and restores the synthetic fixture', async () => {
    await prisma.tenant.update({ where: { id: tenantB }, data: { status: 'SUSPENDED' } });
    try {
      await request(app.getHttpServer())
        .get(path(companyB))
        .set('X-API-Key', foreignKey.secret)
        .expect(403);
      await expect(issue(tenantB, foreign.associationId)).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.tenant.update({ where: { id: tenantB }, data: { status: 'ACTIVE' } });
    }
  });

  it('reserves once under 100 racing requests and replays across rotation without fiscal issuance', async () => {
    const p = principal(first, firstKey, tenantA);
    const results = [];
    for (let batch = 0; batch < 4; batch++) {
      results.push(
        ...(await Promise.all(
          Array.from({ length: 25 }, () => service.reserveSyntheticLab(operation(p))),
        )),
      );
    }
    expect(results.filter((item) => item.created)).toHaveLength(1);
    expect(new Set(results.map((item) => item.reservationId)).size).toBe(1);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({ where: { associationId: first.associationId } }),
    ).toBe(1);
    expect(await prisma.fiscalDocument.count({ where: { tenantId: tenantA } })).toBe(0);
    expect(await service.lookupOperation(operation(p))).toMatchObject({
      status: 202,
      state: 'RESERVED',
    });
    expect(await service.lookupOperation(operation(p, 'b'.repeat(64)))).toMatchObject({
      status: 404,
    });
    await expect(service.reserveSyntheticLab(operation(p, 'b'.repeat(64)))).rejects.toMatchObject({
      status: 409,
    });
    const second = await service.reserveSyntheticLab(
      operation(principal(partner, partnerKey, tenantA)),
    );
    expect(second.created).toBe(true);
    expect(second.reservationId).not.toBe(results[0].reservationId);
    const anotherIssuer = await service.reserveSyntheticLab(
      operation(principal(otherIssuer, otherKey, tenantA)),
    );
    expect(anotherIssuer.created).toBe(true);
    await prisma.fiscalIdempotencyKeyV2.update({
      where: { id: results[0].reservationId },
      data: { state: 'RECOVERY_REQUIRED' },
    });
    expect(await service.lookupOperation(operation(p))).toMatchObject({
      status: 202,
      state: 'RECOVERY_REQUIRED',
    });
  });

  it('rotates with at most two active keys and revokes immediately without losing reservation identity', async () => {
    await service.reserveSyntheticLab(operation(principal(first, firstKey, tenantA)));
    await prisma.fiscalIdempotencyKeyV2.updateMany({
      where: { associationId: first.associationId, key: 'synthetic-invoice-1' },
      data: { state: 'RECOVERY_REQUIRED' },
    });
    const rotationEndsAt = new Date(Date.now() + 3600_000);
    const rotation = await service.issueKey({
      tenantId: tenantA,
      associationId: first.associationId,
      scopes: [...scopes],
      expiresAt: expiresAt(),
      rotationEndsAt,
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    expect(
      (
        await prisma.apiKey.findUniqueOrThrow({ where: { id: firstKey.apiKeyId } })
      ).expiresAt!.getTime(),
    ).toBeLessThanOrEqual(rotationEndsAt.getTime());
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', rotation.secret)
      .expect(200);
    await expect(
      service.issueKey({
        tenantId: tenantA,
        associationId: first.associationId,
        scopes: [...scopes],
        expiresAt: expiresAt(),
        rotationEndsAt: new Date(Date.now() + 3600_000),
        actorId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await service.lookupOperation(operation(principal(first, rotation, tenantA))),
    ).toMatchObject({ status: 202, state: 'RECOVERY_REQUIRED' });
    expect(
      await service.revokeKey({
        tenantId: tenantA,
        associationId: first.associationId,
        apiKeyId: firstKey.apiKeyId,
        actorId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).toEqual({ revoked: true });
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', firstKey.secret)
      .expect(401);
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', rotation.secret)
      .expect(200);
    expect(
      await service.revokeKey({
        tenantId: tenantA,
        associationId: first.associationId,
        apiKeyId: firstKey.apiKeyId,
        actorId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).toEqual({ revoked: false });
    await expect(
      service.revokeKey({
        tenantId: tenantA,
        associationId: partner.associationId,
        apiKeyId: rotation.apiKeyId,
        actorId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects cross-tenant FKs, legacy key binding and wrong key environment in SQL', async () => {
    await expect(
      prisma.fiscalConsumerCompany.create({
        data: {
          id: randomUUID(),
          tenantId: tenantB,
          consumerId: first.consumerId,
          companyId: companyB,
          externalCompanyKey: 'invalid-cross-tenant',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const legacyPrefix = randomUUID().replace(/-/g, '').slice(0, 8);
    const legacySecret = `bk_test_${legacyPrefix}_${randomUUID().replace(/-/g, '')}`;
    const legacy = await prisma.apiKey.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        name: 'legacy-test',
        environment: 'TEST',
        keyPrefix: legacyPrefix,
        keyHash: await argon2.hash(legacySecret),
        scopes: ['invoices:read'],
        integrationProfile: 'inventori-fiscal-v1',
        expiresAt: expiresAt(),
      },
    });
    await request(app.getHttpServer())
      .get(path(companyA1))
      .set('X-API-Key', legacySecret)
      .expect(403);
    await expect(
      prisma.fiscalConsumerKeyBinding.create({
        data: {
          apiKeyId: legacy.id,
          tenantId: tenantA,
          associationId: first.associationId,
        },
      }),
    ).rejects.toThrow('invalid v2 credential binding');
    const wrongEnvironment = await prisma.apiKey.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        name: 'wrong-environment-test',
        environment: 'TEST',
        keyPrefix: randomUUID().replace(/-/g, '').slice(0, 8),
        keyHash: 'unused',
        scopes: ['fiscal-v2:operations:read'],
        integrationProfile: 'billing-consumer-v2',
      },
    });
    await expect(
      prisma.fiscalConsumerKeyBinding.create({
        data: {
          apiKeyId: wrongEnvironment.id,
          tenantId: tenantA,
          associationId: production.associationId,
        },
      }),
    ).rejects.toThrow('invalid v2 credential binding');
    expect(await prisma.fiscalIdempotencyKey.count()).toBe(0);
  });

  it('rolls back an association if its audit insert fails and exposes no raw key in audit', async () => {
    const before = await prisma.fiscalConsumer.count({ where: { tenantId: tenantA } });
    await expect(
      service.registerAssociation({
        tenantId: tenantA,
        companyId: companyA1,
        provider: 'AUDIT_TEST',
        externalConsumerKey: 'rollback-me',
        externalCompanyKey: 'rollback-issuer',
        environment: 'SANDBOX',
        actorId: randomUUID(),
        correlationId: 'x'.repeat(37),
      }),
    ).rejects.toBeDefined();
    expect(await prisma.fiscalConsumer.count({ where: { tenantId: tenantA } })).toBe(before);
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: tenantA, action: { startsWith: 'consumer.' } },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(firstKey.secret);
    expect(logs.some((item) => item.action === 'consumer.operation.reserved')).toBe(true);
  });

  it('filters legacy and foreign-origin documents from the v2 origin reader', async () => {
    const originLink = await register(
      tenantA,
      companyA1,
      'ORIGIN_TEST',
      'origin-app',
      'origin-issuer',
      'SANDBOX',
    );
    const originKey = await issue(tenantA, originLink.associationId);
    const point = await prisma.fiscalIssuancePoint.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        companyId: companyA1,
        environment: 'SANDBOX',
        branchCode: '001',
        terminalCode: '00001',
        isDefault: true,
      },
    });
    const baseDocument = {
      tenantId: tenantA,
      companyId: companyA1,
      environment: 'SANDBOX' as const,
      type: 'INVOICE' as const,
      status: 'READY_FOR_XML' as const,
      issuancePointId: point.id,
      branchCode: '001',
      terminalCode: '00001',
      securityCode: '12345678',
      issuerSnapshot: {},
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [],
      totals: {},
    };
    const originDocument = await prisma.fiscalDocument.create({
      data: {
        ...baseDocument,
        id: randomUUID(),
        sequenceValue: 1,
        consecutive: '00100001010000000001',
        clave: '50601012500310112345600100001010000000001100000001',
        originConsumerId: originLink.consumerId,
        originAssociationId: originLink.associationId,
      },
    });
    const legacyDocument = await prisma.fiscalDocument.create({
      data: {
        ...baseDocument,
        id: randomUUID(),
        sequenceValue: 2,
        consecutive: '00100001010000000002',
        clave: '50601012500310112345600100001010000000001100000002',
      },
    });
    expect(
      await service.findOwnedDocument(principal(originLink, originKey, tenantA), originDocument.id),
    ).toMatchObject({ id: originDocument.id });
    expect(
      await service.findOwnedDocument(principal(partner, partnerKey, tenantA), originDocument.id),
    ).toBeNull();
    expect(
      await service.findOwnedDocument(principal(originLink, originKey, tenantA), legacyDocument.id),
    ).toBeNull();
    await expect(
      prisma.fiscalDocument.update({
        where: { id: originDocument.id },
        data: { originConsumerId: partner.consumerId },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.fiscalDocument.update({
        where: { id: originDocument.id },
        data: { originAssociationId: null },
      }),
    ).rejects.toBeDefined();
  });
});
