import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { configureApiPrefixes } from '../../../src/bootstrap/api-prefix';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { FiscalConsumersLabModule } from '../../../src/modules/fiscal-consumers/fiscal-consumers-lab.module';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { createTestCompany, createTestTenant, createTestUser } from '../../helpers/test-factories';
import {
  assertOwnedTestTenants,
  releaseOwnedTestTenants,
} from '../../helpers/test-database-ownership';

const hash = 'a'.repeat(64);

describe('W1 isolated v2 HTTP integration, with v1 loaded but unchanged', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let lab: ConsumerV2LabService;
  let tenantId: string;
  let otherTenantId: string;
  let companyId: string;
  let otherCompanyId: string;
  let adminJwt: string;
  let memberJwt: string;
  let foreignJwt: string;
  let consumerId: string;
  let associationId: string;
  let keyId: string;
  let keySecret: string;

  const adminPath = '/api/v2/integrations/consumers';
  const readiness = (id = companyId, env = 'SANDBOX') =>
    `/api/v2/companies/${id}/fiscal-readiness/${env}`;
  const lookup = (id = companyId, env = 'SANDBOX') =>
    `/api/v2/companies/${id}/fiscal-documents/${env}/operations/lookup`;
  const lookupBody = {
    operation: 'CREATE_INVOICE',
    idempotencyKey: 'lab-only-1',
    requestHashVersion: 'synthetic-sha256-v1',
    requestHash: hash,
  };
  const login = async (tenant: string, email: string, password: string) => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenant, email, password })
      .expect(200);
    return result.body.accessToken as string;
  };

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
    const module = await Test.createTestingModule({
      imports: [AppModule, FiscalConsumersLabModule],
    }).compile();
    app = module.createNestApplication();
    configureApiPrefixes(app);
    app.useGlobalFilters(new GlobalExceptionFilter('test'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    lab = app.get(ConsumerV2LabService);
    tenantId = (await createTestTenant(prisma)).id;
    otherTenantId = (await createTestTenant(prisma)).id;
    companyId = (await createTestCompany(prisma, tenantId)).id;
    otherCompanyId = (await createTestCompany(prisma, otherTenantId)).id;
    const admin = await createTestUser(prisma, tenantId);
    const member = await createTestUser(prisma, tenantId, { role: 'MEMBER' });
    const foreign = await createTestUser(prisma, otherTenantId);
    adminJwt = await login(tenantId, admin.email, admin.password);
    memberJwt = await login(tenantId, member.email, member.password);
    foreignJwt = await login(otherTenantId, foreign.email, foreign.password);
  });

  afterAll(async () => {
    if (prisma && tenantId && otherTenantId) {
      const owned = await assertOwnedTestTenants(prisma, [tenantId, otherTenantId]);
      const where = { tenantId: { in: [...owned] } };
      await prisma.fiscalIdempotencyKeyV2.deleteMany({ where });
      await prisma.fiscalConsumerKeyBinding.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.apiKey.deleteMany({ where });
      await prisma.fiscalConsumerAssociation.deleteMany({ where });
      await prisma.fiscalConsumerCompany.deleteMany({ where });
      await prisma.fiscalConsumer.deleteMany({ where });
      await prisma.refreshToken.deleteMany({ where: { tenantId: { in: [...owned] } } });
      await prisma.user.deleteMany({ where });
      await prisma.company.deleteMany({ where });
      await prisma.tenant.deleteMany({ where: { id: { in: [...owned] } } });
      await releaseOwnedTestTenants(prisma, owned);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it('enforces admin JWT/role, provider catalogue, tenant and idempotent registration', async () => {
    const body = {
      provider: 'AFFILIATIONS',
      externalConsumerKey: 'lab-app',
      externalCompanyKey: 'lab-issuer',
      companyId,
      environment: 'SANDBOX',
      profileVersion: 'fiscal-consumer-v2',
    };
    await request(app.getHttpServer()).post(adminPath).send(body).expect(401);
    await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${memberJwt}`)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${foreignJwt}`)
      .send(body)
      .expect(404);
    await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...body, provider: 'UNAPPROVED' })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body)
      .expect(201);
    consumerId = created.body.consumerId;
    associationId = created.body.associationId;
    expect(created.body).toMatchObject({ companyId, environment: 'SANDBOX', status: 'ACTIVE' });
    await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body)
      .expect(200)
      .expect(({ body: replay }) => expect(replay.associationId).toBe(associationId));
    await request(app.getHttpServer())
      .get(`${adminPath}/${consumerId}`)
      .set('Authorization', `Bearer ${foreignJwt}`)
      .expect(404);
    const read = await request(app.getHttpServer())
      .get(`${adminPath}/${consumerId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    expect(read.body.associations).toHaveLength(1);
    expect(JSON.stringify(read.body)).not.toContain('secret');
  });

  it('binds minimum scopes, environment and origin; revocation blocks both v2 and v1 escalation', async () => {
    const keysPath = `${adminPath}/${consumerId}/keys`;
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ associationId, scopes: ['invoices:read'], expiresAt })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${adminPath}/${randomUUID()}/keys`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ associationId, scopes: ['fiscal-v2:readiness:read'], expiresAt })
      .expect(404);
    const issued = await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        associationId,
        scopes: ['fiscal-v2:readiness:read', 'fiscal-v2:operations:read'],
        expiresAt,
      })
      .expect(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    keyId = issued.body.keyId;
    keySecret = issued.body.secret;
    await request(app.getHttpServer())
      .get(readiness())
      .set('X-API-Key', keySecret)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          ready: false,
          blockers: [{ code: 'W1_LAB_FISCAL_ISSUANCE_DISABLED' }],
        }),
      );
    await request(app.getHttpServer())
      .get(readiness(otherCompanyId))
      .set('X-API-Key', keySecret)
      .expect(404);
    await request(app.getHttpServer())
      .get(readiness(companyId, 'PRODUCTION'))
      .set('X-API-Key', keySecret)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/fiscal-onboarding/v1/SANDBOX/readiness`)
      .set('X-API-Key', keySecret)
      .expect(403);
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', keySecret)
      .send(lookupBody)
      .expect(404);
    await lab.reserveSyntheticLab({
      principal: {
        tenantId,
        consumerId,
        associationId,
        companyId,
        environment: 'SANDBOX',
        apiKeyId: keyId,
      },
      operation: 'CREATE_INVOICE',
      idempotencyKey: lookupBody.idempotencyKey,
      requestHashVersion: lookupBody.requestHashVersion,
      requestHash: hash,
      correlationId: randomUUID(),
    });
    const found = await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', keySecret)
      .send(lookupBody)
      .expect(202);
    expect(found.headers['cache-control']).toBe('no-store');
    expect(found.body).toMatchObject({ state: 'RESERVED', operation: 'CREATE_INVOICE' });
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', keySecret)
      .send({ ...lookupBody, requestHash: 'b'.repeat(64) })
      .expect(404);
    await request(app.getHttpServer())
      .post(lookup(otherCompanyId))
      .set('X-API-Key', keySecret)
      .send(lookupBody)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${adminPath}/${randomUUID()}/keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${adminPath}/${consumerId}/keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(204);
    await request(app.getHttpServer()).get(readiness()).set('X-API-Key', keySecret).expect(401);
    expect(await prisma.fiscalDocument.count({ where: { tenantId } })).toBe(0);
  });

  it('enforces one scope per route, bounded rotation and hash-bound lookup over HTTP', async () => {
    const created = await request(app.getHttpServer())
      .post(adminPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        provider: 'PARTNER',
        externalConsumerKey: 'scoped-lab-app',
        externalCompanyKey: 'scoped-lab-issuer',
        companyId,
        environment: 'SANDBOX',
        profileVersion: 'fiscal-consumer-v2',
      })
      .expect(201);
    const scopedConsumerId = created.body.consumerId as string;
    const scopedAssociationId = created.body.associationId as string;
    const keysPath = `${adminPath}/${scopedConsumerId}/keys`;
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const first = await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        associationId: scopedAssociationId,
        scopes: ['fiscal-v2:readiness:read'],
        expiresAt,
      })
      .expect(201);
    const firstSecret = first.body.secret as string;

    await request(app.getHttpServer()).get(readiness()).set('X-API-Key', firstSecret).expect(200);
    await request(app.getHttpServer())
      .get(readiness('not-a-uuid'))
      .set('X-API-Key', firstSecret)
      .expect(404);
    await request(app.getHttpServer())
      .get(readiness(companyId, 'INVALID'))
      .set('X-API-Key', firstSecret)
      .expect(404);
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', firstSecret)
      .send(lookupBody)
      .expect(403);
    await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        associationId: scopedAssociationId,
        scopes: ['fiscal-v2:operations:read'],
        expiresAt,
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        associationId: scopedAssociationId,
        scopes: ['fiscal-v2:operations:read'],
        expiresAt,
        rotationEndsAt: new Date(Date.now() + 25 * 3600_000).toISOString(),
      })
      .expect(409);
    const rotated = await request(app.getHttpServer())
      .post(keysPath)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        associationId: scopedAssociationId,
        scopes: ['fiscal-v2:operations:read'],
        expiresAt,
        rotationEndsAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);
    const rotatedSecret = rotated.body.secret as string;
    expect(rotated.body.keyId).not.toBe(first.body.keyId);
    await request(app.getHttpServer()).get(readiness()).set('X-API-Key', rotatedSecret).expect(403);
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', rotatedSecret)
      .send({ ...lookupBody, requestHash: undefined })
      .expect(400);
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', rotatedSecret)
      .send(lookupBody)
      .expect(404);
    await request(app.getHttpServer())
      .post(lookup(companyId, 'PRODUCTION'))
      .set('X-API-Key', rotatedSecret)
      .send(lookupBody)
      .expect(403);
    await request(app.getHttpServer())
      .post(`${adminPath}/${scopedConsumerId}/keys/${first.body.keyId}/revoke`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(204);
    await request(app.getHttpServer()).get(readiness()).set('X-API-Key', firstSecret).expect(401);
    await request(app.getHttpServer())
      .post(lookup())
      .set('X-API-Key', rotatedSecret)
      .send(lookupBody)
      .expect(404);
  });
});
