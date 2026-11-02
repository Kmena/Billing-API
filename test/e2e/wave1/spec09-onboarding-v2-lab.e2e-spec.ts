import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { configureApiPrefixes } from '../../../src/bootstrap/api-prefix';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../../src/api/interceptors/tenant-context.interceptor';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { CONSUMER_V2_LAB_SCOPES } from '../../../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import { FiscalOnboardingAdminV2LabModule } from '../../../src/modules/fiscal-consumers/fiscal-onboarding-admin-v2-lab.module';
import { createTestSigningMaterialWithFiscalId } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import {
  createFiscalTenantFixture,
  resetFiscalE2eData,
  FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';

describe('SPEC-09 isolated administrative M2M v2 HTTP contract', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let context: FiscalE2eContext;
  let lab: ConsumerV2LabService;
  let tenantId: string;
  let companyId: string;
  let consumerId: string;
  let associationId: string;
  let keyId: string;
  let secret: string;
  const base = () => `/api/v2/companies/${companyId}/fiscal-onboarding/SANDBOX`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_REAL_HACIENDA = 'false';
    installGuardedTestDatabaseEnvironment();
    ({ prisma } = await createGuardedTestPrisma());
    const module = await Test.createTestingModule({
      imports: [AppModule, FiscalOnboardingAdminV2LabModule],
    }).compile();
    app = module.createNestApplication();
    configureApiPrefixes(app);
    app.useGlobalFilters(new GlobalExceptionFilter('test'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(app.get(CorrelationIdInterceptor), app.get(TenantContextInterceptor));
    await app.init();
    context = { app, prisma, ownedTenantIds: new Set<string>() };
    lab = app.get(ConsumerV2LabService);
    const fixture = await createFiscalTenantFixture(context);
    tenantId = fixture.tenantId;
    companyId = fixture.companyId;
    const association = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AFFILIATIONS',
      externalConsumerKey: 'spec09-lab-app',
      externalCompanyKey: 'spec09-lab-company',
      environment: 'SANDBOX',
      actorId: fixture.userId,
      correlationId: randomUUID(),
    });
    consumerId = association.consumerId;
    associationId = association.associationId;
    const issued = await lab.issueKey({
      tenantId,
      consumerId,
      associationId,
      scopes: [...CONSUMER_V2_LAB_SCOPES],
      expiresAt: new Date(Date.now() + 86_400_000),
      actorId: fixture.userId,
      correlationId: randomUUID(),
    });
    keyId = issued.apiKeyId;
    secret = issued.secret;
  });

  afterAll(async () => {
    if (context) await resetFiscalE2eData(context);
    await app?.close();
    await prisma?.$disconnect();
  });

  it('enforces M2M scope, company, environment, origin and v1 separation', async () => {
    await request(app.getHttpServer()).get(base()).expect(401);
    await request(app.getHttpServer()).get(base()).set('X-API-Key', secret).expect(200);
    await request(app.getHttpServer())
      .get(base())
      .set('X-API-Key', secret)
      .set('Origin', 'https://synthetic.example')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${randomUUID()}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', secret)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${companyId}/fiscal-onboarding/PRODUCTION`)
      .set('X-API-Key', secret)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/fiscal-onboarding/v1/SANDBOX/readiness`)
      .set('X-API-Key', secret)
      .expect(403);
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { scopes: ['fiscal-v2:onboarding:read'] },
    });
    await request(app.getHttpServer())
      .post(`${base()}/connection-test`)
      .set('X-API-Key', secret)
      .expect(403);
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { scopes: [...CONSUMER_V2_LAB_SCOPES] },
    });
  });

  it('reuses Billing stores, handles synthetic PKCS#12 and hides credentials', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const prefix = `CPJ-${company.identificationNumber}`;
    const signing = createTestSigningMaterialWithFiscalId(prefix, 'spec09-synthetic-pin');
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    Object.defineProperty(isolatedSecrets, 'isDurable', { value: true });
    await request(app.getHttpServer())
      .post(`${base()}/certificate`)
      .set('X-API-Key', secret)
      .field('pin', 'wrong-pin')
      .attach('certificate', signing.pkcs12Bytes, {
        filename: 'synthetic.p12',
        contentType: 'application/x-pkcs12',
      })
      .expect(422);
    const uploaded = await request(app.getHttpServer())
      .post(`${base()}/certificate`)
      .set('X-API-Key', secret)
      .field('pin', signing.passphrase)
      .attach('certificate', signing.pkcs12Bytes, {
        filename: 'synthetic.p12',
        contentType: 'application/x-pkcs12',
      })
      .expect(201);
    expect(JSON.stringify(uploaded.body)).not.toContain(signing.passphrase);
    expect(JSON.stringify(uploaded.body)).not.toContain('SecretReference');
    const credentials = await request(app.getHttpServer())
      .put(`${base()}/credentials`)
      .set('X-API-Key', secret)
      .send({ username: 'synthetic-user', password: 'synthetic-password' })
      .expect(200);
    expect(JSON.stringify(credentials.body)).not.toContain('synthetic-password');
    const first = await prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId, companyId, environment: 'SANDBOX' },
    });
    await request(app.getHttpServer())
      .post(`${base()}/credentials/rotate`)
      .set('X-API-Key', secret)
      .send({ username: 'synthetic-user-2', password: 'synthetic-password-2' })
      .expect(200);
    const second = await prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId, companyId, environment: 'SANDBOX' },
    });
    expect(second.secretReference).not.toBe(first.secretReference);
    await expect(isolatedSecrets.getSecret(first.secretReference)).rejects.toBeDefined();
    const point = await request(app.getHttpServer())
      .put(`${base()}/issuance-point`)
      .set('X-API-Key', secret)
      .send({
        branchCode: '001',
        branchName: 'Synthetic branch',
        terminalCode: '00001',
        terminalName: 'Synthetic terminal',
      })
      .expect(200);
    expect(point.body.issuancePoint.isDefault).toBe(true);
    const test = await request(app.getHttpServer())
      .post(`${base()}/connection-test`)
      .set('X-API-Key', secret)
      .expect(200);
    expect(test.body).toMatchObject({
      productionAuthorization: 'NOT_VERIFIED',
      issuedDocument: false,
      externalCall: false,
    });
    expect(JSON.stringify(test.body)).not.toContain('synthetic-password');
    const audit = await request(app.getHttpServer())
      .get(`${base()}/audit`)
      .set('X-API-Key', secret)
      .expect(200);
    expect(
      audit.body.some((e: { action: string }) => e.action === 'onboarding-v2.credentials.rotated'),
    ).toBe(true);
  });

  it('associates idempotently and rejects in-place legal issuer changes', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const body = { externalCompanyKey: 'spec09-lab-company' };
    const first = await request(app.getHttpServer())
      .post(`${base()}/associations`)
      .set('X-API-Key', secret)
      .send(body)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`${base()}/associations`)
      .set('X-API-Key', secret)
      .send(body)
      .expect(201);
    expect(replay.body.associationId).toBe(first.body.associationId);
    await request(app.getHttpServer())
      .post(`${base()}/associations`)
      .set('X-API-Key', secret)
      .send({ externalCompanyKey: 'different-key' })
      .expect(409);
    await request(app.getHttpServer())
      .put(`${base()}/issuer`)
      .set('X-API-Key', secret)
      .send({
        legalName: 'Synthetic changed',
        identificationNumber: '999999999',
        identificationType: company.identificationType,
      })
      .expect(409);
  });
});
