import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync, privateDecrypt, randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MockHaciendaAdapter } from '../../../src/infrastructure/integrations/hacienda/adapters/mock-hacienda.adapter';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { configureApiPrefixes } from '../../../src/bootstrap/api-prefix';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../../src/api/interceptors/tenant-context.interceptor';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { OnboardingV2MutationService } from '../../../src/modules/fiscal-consumers/infrastructure/persistence/onboarding-v2-mutation.service';
import { SPEC09_CREDENTIAL_VERIFIER } from '../../../src/modules/fiscal-consumers/infrastructure/persistence/spec09-credential-verifier';
import { MockHaciendaAuthAdapter } from '../../../src/modules/hacienda-connection/infrastructure/auth/mock-hacienda-auth.adapter';
import { EnrollmentV2Service } from '../../../src/modules/fiscal-consumers/infrastructure/persistence/enrollment-v2.service';
import {
  AFFILIATIONS_ENROLLMENT_V2_SCOPES,
  AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES,
  CONSUMER_V2_LAB_SCOPES,
} from '../../../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import { FiscalOnboardingAdminV2LabModule } from '../../../src/modules/fiscal-consumers/fiscal-onboarding-admin-v2-lab.module';
import { createTestSigningMaterialWithFiscalId } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import {
  createFiscalTenantFixture,
  resetFiscalE2eData,
  FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { createTestCompany } from '../../helpers/test-factories';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';

describe('SPEC-09 isolated administrative M2M v2 HTTP contract', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let context: FiscalE2eContext;
  let lab: ConsumerV2LabService;
  let tenantId: string;
  let adminUserId: string;
  let adminJwt: string;
  let companyId: string;
  let consumerId: string;
  let associationId: string;
  let keyId: string;
  let secret: string;
  const recipientPublicFiles = new Set<string>();
  const base = () => `/api/v2/companies/${companyId}/fiscal-onboarding/SANDBOX`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_REAL_HACIENDA = 'false';
    process.env.SPEC09_TAXPAYER_LOOKUP_MODE = 'fixture';
    process.env.SPEC09_CREDENTIAL_VALIDATION_MODE = 'fixture';
    process.env.FISCAL_ONBOARDING_V2_HMAC_KEY =
      'synthetic-spec09-hmac-key-for-disposable-tests-only';
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
    adminUserId = fixture.userId;
    adminJwt = fixture.jwtToken;
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
    for (const file of recipientPublicFiles) if (existsSync(file)) unlinkSync(file);
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

  it('saves a fiscal profile draft, rejects stale writes and selects only a verified activity', async () => {
    const endpoint = base();
    const read = await request(app.getHttpServer())
      .get(`${endpoint}/fiscal-details`)
      .set('X-API-Key', secret)
      .expect(200);
    expect(read.body).toMatchObject({ profile: null, activities: [], externalCall: false });
    const input = {
      province: '1',
      canton: '01',
      district: '01',
      otrasSenas: 'Dirección sintética',
      email: 'emisor@example.invalid',
    };
    await request(app.getHttpServer())
      .patch(`${endpoint}/fiscal-profile`)
      .set('X-API-Key', secret)
      .set('If-Match', 'absent')
      .send({ ...input, economicActivityCode: 'invented' })
      .expect(400);
    const first = await request(app.getHttpServer())
      .patch(`${endpoint}/fiscal-profile`)
      .set('X-API-Key', secret)
      .set('If-Match', 'absent')
      .send(input)
      .expect(200);
    expect(first.body.profile).toMatchObject({
      email: input.email,
      defaultEconomicActivityId: null,
    });
    expect(first.body.profile.version).toMatch(/^\d+$/);
    expect(JSON.stringify(first.body)).not.toContain('economicActivityCode');
    const replay = await request(app.getHttpServer())
      .patch(`${endpoint}/fiscal-profile`)
      .set('X-API-Key', secret)
      .set('If-Match', 'absent')
      .send(input)
      .expect(200);
    expect(replay.body.profile.version).toBe(first.body.profile.version);
    await request(app.getHttpServer())
      .patch(`${endpoint}/fiscal-profile`)
      .set('X-API-Key', secret)
      .set('If-Match', 'absent')
      .send({ email: 'stale@example.invalid' })
      .expect(409);
    const second = await request(app.getHttpServer())
      .patch(`${endpoint}/fiscal-profile`)
      .set('X-API-Key', secret)
      .set('If-Match', first.body.profile.version)
      .send({ email: 'updated@example.invalid' })
      .expect(200);
    expect(second.body.profile).toMatchObject({
      province: input.province,
      email: 'updated@example.invalid',
    });
    expect(second.body.profile.version).not.toBe(first.body.profile.version);
    await request(app.getHttpServer())
      .put(`${endpoint}/default-activity`)
      .set('X-API-Key', secret)
      .set('If-Match', second.body.profile.version)
      .send({ code: '9999.0' })
      .expect(404);
    const activityId = randomUUID();
    await prisma.companyEconomicActivity.create({
      data: {
        id: activityId,
        tenantId,
        companyId,
        code: '9609.0',
        description: 'Actividad sintética verificada en fixture descartable',
        haciendaStatus: 'A',
        billingEnabled: true,
        verifiedAt: new Date(),
        lastSeenAt: new Date(),
        verificationSource: 'HACIENDA_FE_AE',
      },
    });
    const selected = await request(app.getHttpServer())
      .put(`${endpoint}/default-activity`)
      .set('X-API-Key', secret)
      .set('If-Match', second.body.profile.version)
      .send({ code: '9609.0' })
      .expect(200);
    expect(selected.body.code).toBe('9609.0');
    const persisted = await request(app.getHttpServer())
      .get(`${endpoint}/fiscal-details`)
      .set('X-API-Key', secret)
      .expect(200);
    expect(persisted.body.profile).toMatchObject({
      email: 'updated@example.invalid',
      defaultEconomicActivityId: activityId,
      version: selected.body.version,
    });
    expect(persisted.body.activities).toEqual([
      expect.objectContaining({ code: '9609.0', selected: true }),
    ]);
    expect(JSON.stringify(persisted.body)).not.toMatch(/password|pin|secret|certificate/i);
    const audit = await prisma.auditLog.findMany({
      where: {
        companyId,
        action: { in: ['onboarding-v2.profile.updated', 'onboarding-v2.activity.selected'] },
      },
    });
    expect(audit).toHaveLength(3);
    const concurrent = await Promise.all([
      request(app.getHttpServer())
        .patch(`${endpoint}/fiscal-profile`)
        .set('X-API-Key', secret)
        .set('If-Match', selected.body.version)
        .send({ email: 'concurrent-a@example.invalid' }),
      request(app.getHttpServer())
        .patch(`${endpoint}/fiscal-profile`)
        .set('X-API-Key', secret)
        .set('If-Match', selected.body.version)
        .send({ email: 'concurrent-b@example.invalid' }),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.auditLog.count({
        where: { companyId, action: 'onboarding-v2.profile.updated' },
      }),
    ).toBe(3);
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { scopes: ['fiscal-v2:onboarding:read'] },
    });
    try {
      await request(app.getHttpServer())
        .patch(`${endpoint}/fiscal-profile`)
        .set('X-API-Key', secret)
        .set('If-Match', selected.body.version)
        .send({ email: 'denied@example.invalid' })
        .expect(403);
    } finally {
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { scopes: [...CONSUMER_V2_LAB_SCOPES] },
      });
    }
  });

  it('imports activities for the bound issuer with M2M authorization and audit', async () => {
    const lookup = jest.spyOn(app.get(MockHaciendaAdapter), 'getTaxpayer');
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { identificationNumber: true, identificationType: true },
    });
    lookup.mockResolvedValue({
      identification: company.identificationNumber,
      identificationType: company.identificationType === 'FISICA' ? '01' : '02',
      name: 'Emisor de prueba',
      found: true,
      taxSituation: 'Inscrito',
      moroso: false,
      omiso: false,
      economicActivities: [
        { code: '9609.0', description: 'Actividad sintética', status: 'A', type: 'P' },
      ],
    });
    try {
      const endpoint = `${base()}/taxpayer-verification`;
      await request(app.getHttpServer()).post(endpoint).expect(401);
      await request(app.getHttpServer())
        .post(endpoint)
        .set('X-API-Key', secret)
        .set('Origin', 'https://synthetic.example')
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v2/companies/${randomUUID()}/fiscal-onboarding/SANDBOX/taxpayer-verification`)
        .set('X-API-Key', secret)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v2/companies/${companyId}/fiscal-onboarding/PRODUCTION/taxpayer-verification`)
        .set('X-API-Key', secret)
        .expect(403);
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { scopes: ['fiscal-v2:onboarding:read'] },
      });
      await request(app.getHttpServer()).post(endpoint).set('X-API-Key', secret).expect(403);
      expect(lookup).not.toHaveBeenCalled();
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { scopes: [...CONSUMER_V2_LAB_SCOPES] },
      });
      const response = await request(app.getHttpServer())
        .post(endpoint)
        .set('X-API-Key', secret)
        .expect(200);
      expect(response.body).toMatchObject({ status: 'VERIFIED', activitiesCount: 1 });
      expect(JSON.stringify(response.body)).not.toContain(company.identificationNumber);
      expect(lookup).toHaveBeenCalledWith(company.identificationNumber);
      expect(
        await prisma.auditLog.count({
          where: { companyId, action: 'onboarding-v2.taxpayer.verified' },
        }),
      ).toBe(1);
      const details = await request(app.getHttpServer())
        .get(`${base()}/fiscal-details`)
        .set('X-API-Key', secret)
        .expect(200);
      expect(details.body.activities).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: '9609.0' })]),
      );
      lookup.mockResolvedValueOnce({
        identification: company.identificationNumber,
        identificationType: company.identificationType === 'FISICA' ? '02' : '01',
        name: 'Otro emisor',
        found: true,
        taxSituation: 'Inscrito',
        moroso: false,
        omiso: false,
        economicActivities: [{ code: '9999.0', description: 'Actividad ajena', status: 'A' }],
      });
      await request(app.getHttpServer()).post(endpoint).set('X-API-Key', secret).expect(409);
      expect(
        await prisma.companyEconomicActivity.count({ where: { companyId, code: '9999.0' } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { companyId, action: 'onboarding-v2.taxpayer.verified' },
        }),
      ).toBe(1);
    } finally {
      lookup.mockRestore();
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { scopes: [...CONSUMER_V2_LAB_SCOPES] },
      });
    }
  });

  it('requires a current Billing administrator for the first association and rejects M2M self-grant', async () => {
    const body = {
      companyId,
      provider: 'AFFILIATIONS',
      externalConsumerKey: 'spec09-lab-app',
      externalCompanyKey: 'spec09-lab-company',
      environment: 'SANDBOX',
      profileVersion: 'fiscal-consumer-v2',
    };
    await request(app.getHttpServer())
      .post('/api/v2/integrations/consumers')
      .set('X-API-Key', secret)
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base()}/associations/reassign`)
      .set('X-API-Key', secret)
      .send({ targetCompanyId: randomUUID(), newExternalCompanyKey: 'self-granted-issuer' })
      .expect(404);
    const replay = await request(app.getHttpServer())
      .post('/api/v2/integrations/consumers')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body)
      .expect(200);
    expect(replay.body.associationId).toBe(associationId);
    await request(app.getHttpServer())
      .post('/api/v2/integrations/consumers')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ ...body, companyId: randomUUID() })
      .expect(404);
    await prisma.user.update({ where: { id: adminUserId }, data: { role: 'MEMBER' } });
    try {
      await request(app.getHttpServer())
        .post('/api/v2/integrations/consumers')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ ...body, externalCompanyKey: 'new-binding-blocked' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v2/integrations/consumers/${consumerId}/keys`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          associationId,
          scopes: ['fiscal-v2:onboarding:read'],
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(403);
    } finally {
      await prisma.user.update({ where: { id: adminUserId }, data: { role: 'TENANT_ADMIN' } });
    }
  });

  it('isolates credential writes from another company and another tenant', async () => {
    const sibling = await createTestCompany(prisma, tenantId);
    const foreign = await createFiscalTenantFixture(context);
    for (const [target, expected] of [
      [sibling.id, 403],
      [foreign.companyId, 404],
    ] as const) {
      await request(app.getHttpServer())
        .put(`/api/v2/companies/${target}/fiscal-onboarding/SANDBOX/credentials`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'isolation-check-001')
        .send({ username: 'foreign-user', password: 'foreign-password' })
        .expect(expected);
    }
    expect(
      await prisma.haciendaConnection.count({
        where: { companyId: { in: [sibling.id, foreign.companyId] } },
      }),
    ).toBe(0);
  });

  it('provisions the first SANDBOX binding from a local admin command and safely replays after interruption', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { email: true },
    });
    const args = [
      'node_modules/ts-node/dist/bin.js',
      '-r',
      'tsconfig-paths/register',
      join('scripts', 'spec09-bind-affiliations-lab.ts'),
      tenantId,
      companyId,
      admin.email,
      'spec09-local-app',
      'spec09-local-company',
    ];
    const invoke = (password: string) =>
      spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        input: `${password}\n`,
        encoding: 'utf8',
        windowsHide: true,
      });
    const denied = invoke('invalid-synthetic-password');
    expect(denied.status).toBe(1);
    expect(denied.stdout).toBe('');
    const first = invoke('SecurePass123!');
    expect(first.status).toBe(0);
    const binding = JSON.parse(first.stdout) as { associationId: string; created: boolean };
    expect(binding.created).toBe(true);
    const replay = invoke('SecurePass123!');
    expect(replay.status).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({
      associationId: binding.associationId,
      created: false,
    });
    expect(
      await prisma.fiscalConsumerAssociation.count({
        where: { tenantId, consumerCompany: { externalCompanyKey: 'spec09-local-company' } },
      }),
    ).toBe(1);
  });

  it('auto-approves a pre-authorized Afiliaciones request only after certificate validation', async () => {
    const enrolled = await createFiscalTenantFixture(context);
    const billingCompanyId = enrolled.companyId;
    const affiliationsCompanyId = randomUUID();
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: enrolled.userId },
      select: { email: true },
    });
    const recipient = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const recipientPublicFile = join(tmpdir(), `billing-spec09-recipient-${randomUUID()}.pem`);
    writeFileSync(recipientPublicFile, recipient.publicKey.export({ format: 'pem', type: 'spki' }));
    recipientPublicFiles.add(recipientPublicFile);
    const command = [
      'node_modules/ts-node/dist/bin.js',
      '-r',
      'tsconfig-paths/register',
      join('scripts', 'spec09-issue-enrollment-key-lab.ts'),
      enrolled.tenantId,
      billingCompanyId,
      affiliationsCompanyId,
      admin.email,
    ];
    const persistentEnvironment = {
      ...process.env,
      SPEC09_SANDBOX_MARKER: 'billing-spec09-synthetic-v1',
      BILLING_SPEC09_PERSISTENT_SANDBOX: 'true',
      FISCAL_WORKER_ENABLE_IN_TESTS: 'false',
      SPEC09_ADMIN_ISOLATED_TEST: '1',
    };
    const invoke = (password: string, extra: string[] = []) => {
      const outputFile = join(tmpdir(), `billing-spec09-key-${randomUUID()}.json`);
      const result = spawnSync(
        process.execPath,
        [
          ...command,
          ...extra,
          '--output-file',
          outputFile,
          '--recipient-public-key',
          recipientPublicFile,
        ],
        {
          cwd: process.cwd(),
          env: extra[0] === '--persistent-sandbox' ? persistentEnvironment : process.env,
          input: `${password}\n`,
          encoding: 'utf8',
          windowsHide: true,
        },
      );
      const encryptedFile = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : null;
      const issued = encryptedFile
        ? (() => {
            const envelope = JSON.parse(encryptedFile) as {
              ciphertext: string;
              keyId: string;
              companyId: string;
            };
            expect(envelope.companyId).toBe(affiliationsCompanyId);
            const key = privateDecrypt(
              { key: recipient.privateKey, oaepHash: 'sha256' },
              Buffer.from(envelope.ciphertext, 'base64'),
            ).toString('utf8');
            expect(encryptedFile).not.toContain(key);
            return { key, keyId: envelope.keyId };
          })()
        : null;
      if (existsSync(outputFile)) unlinkSync(outputFile);
      return { ...result, issued };
    };
    expect(invoke('invalid-synthetic-password').status).toBe(1);
    const provisioned = invoke('SecurePass123!');
    expect(provisioned.status).toBe(0);
    const key = provisioned.issued!.key;
    expect(provisioned.stdout).not.toContain(key);
    expect(invoke('SecurePass123!').status).toBe(1);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: billingCompanyId } });
    const signing = createTestSigningMaterialWithFiscalId(
      `CPJ-${company.identificationNumber}`,
      'enrollment-synthetic-pin',
    );
    const endpoint = `/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX/requests`;
    const submit = (
      pin: string,
      idempotencyKey: string,
      externalCompanyKey = `affiliations:${affiliationsCompanyId}`,
    ) =>
      request(app.getHttpServer())
        .post(endpoint)
        .set('X-API-Key', key)
        .set('Idempotency-Key', idempotencyKey)
        .field('externalCompanyKey', externalCompanyKey)
        .field('pin', pin)
        .field('username', 'synthetic-hacienda-user')
        .field('password', 'synthetic-hacienda-password')
        .attach('certificate', signing.pkcs12Bytes, {
          filename: 'synthetic.p12',
          contentType: 'application/x-pkcs12',
        });
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    Object.defineProperty(isolatedSecrets, 'isDurable', { value: true });
    await submit('wrong-pin', 'enroll-wrong-pin-001').expect(422);
    await submit(
      signing.passphrase,
      'enroll-wrong-company-001',
      `affiliations:${randomUUID()}`,
    ).expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'enroll-self-grant-001')
      .expect(403);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('X-API-Key', key)
      .set('Origin', 'https://synthetic.example')
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v2/companies/${randomUUID()}/fiscal-onboarding/SANDBOX/requests`)
      .set('X-API-Key', key)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/PRODUCTION/requests`)
      .set('X-API-Key', key)
      .expect(403);
    expect(
      await prisma.fiscalSigningCertificate.count({
        where: { companyId: billingCompanyId, status: 'ACTIVE' },
      }),
    ).toBe(0);
    const approved = await submit(signing.passphrase, 'enroll-approved-001').expect(200);
    expect(approved.body).toMatchObject({
      companyId: billingCompanyId,
      environment: 'SANDBOX',
      status: 'APPROVED',
      haciendaStatus: 'PENDING_VALIDATION',
      productionAuthorized: false,
    });
    const replay = await submit(signing.passphrase, 'enroll-approved-001').expect(200);
    expect(replay.body).toEqual(approved.body);
    await submit(signing.passphrase, 'enroll-duplicate-001').expect(409);
    const rendered = JSON.stringify(approved.body);
    expect(rendered).not.toContain(signing.passphrase);
    expect(rendered).not.toContain('synthetic-hacienda-password');
    expect(rendered).not.toContain('SecretReference');
    const cert = await prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: { companyId: billingCompanyId, status: 'ACTIVE' },
    });
    const conn = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId: billingCompanyId, environment: 'SANDBOX' },
    });
    expect(conn.status).toBe('PENDING_VALIDATION');
    expect(await isolatedSecrets.getSecret(cert.passwordSecretReference)).toBe(signing.passphrase);
    expect(await isolatedSecrets.getSecret(conn.secretReference)).toContain(
      'synthetic-hacienda-user',
    );
    const auditActions = (
      await prisma.auditLog.findMany({
        where: { tenantId: enrolled.tenantId },
        select: { action: true },
      })
    ).map((row) => row.action);
    expect(auditActions).toContain('onboarding-v2.enrollment.approved');
    const keyId = (
      await prisma.apiKey.findFirstOrThrow({
        where: { keyPrefix: key.split('_')[2] },
        select: { id: true },
      })
    ).id;
    await prisma.apiKey.update({ where: { id: keyId }, data: { status: 'REVOKED' } });
    await submit(signing.passphrase, 'enroll-revoked-001').expect(401);
    const renewed = invoke('SecurePass123!');
    expect(renewed.status).toBe(0);
    const newKey = renewed.issued!.key;
    expect(newKey).not.toBe(key);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', newKey)
      .expect(200);
    await prisma.tenant.update({
      where: { id: enrolled.tenantId },
      data: { slug: 'spec09-sandbox-synthetic' },
    });
    await prisma.company.update({
      where: { id: billingCompanyId },
      data: { legalName: 'SPEC-09 EMISOR DEMO' },
    });
    const deniedPersistent = invoke('invalid-synthetic-password', [
      '--persistent-sandbox',
      '--rotate',
    ]);
    expect(deniedPersistent.status).toBe(1);
    expect(deniedPersistent.issued).toBeNull();
    const wrongCompanyCommand = [...command];
    wrongCompanyCommand[5] = randomUUID();
    const deniedOutput = join(tmpdir(), `billing-spec09-key-${randomUUID()}.json`);
    const wrongCompany = spawnSync(
      process.execPath,
      [
        ...wrongCompanyCommand,
        '--persistent-sandbox',
        '--rotate',
        '--output-file',
        deniedOutput,
        '--recipient-public-key',
        recipientPublicFile,
      ],
      {
        cwd: process.cwd(),
        env: persistentEnvironment,
        input: 'SecurePass123!\n',
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(wrongCompany.status).toBe(1);
    expect(existsSync(deniedOutput)).toBe(false);
    const rotated = invoke('SecurePass123!', ['--persistent-sandbox', '--rotate']);
    expect(rotated.status).toBe(0);
    const rotatedKey = rotated.issued!.key;
    expect(rotated.stdout).not.toContain(rotatedKey);
    const rotatedRecord = await prisma.apiKey.findUniqueOrThrow({
      where: { id: rotated.issued!.keyId },
      include: { companies: true, consumerKeyBinding: true },
    });
    expect(rotatedRecord.environment).toBe('TEST');
    expect(rotatedRecord.companies.map((entry) => entry.companyId)).toEqual([billingCompanyId]);
    expect(rotatedRecord.consumerKeyBinding?.associationId).toBe(approved.body.associationId);
    expect(new Set(rotatedRecord.scopes)).toEqual(
      new Set([...AFFILIATIONS_ENROLLMENT_V2_SCOPES, ...AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES]),
    );
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', newKey)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', rotatedKey)
      .expect(200);
    const overlapRejected = invoke('SecurePass123!', ['--persistent-sandbox', '--rotate']);
    expect(overlapRejected.status).toBe(1);
    expect(overlapRejected.issued).toBeNull();
    const cutover = spawnSync(
      process.execPath,
      [...command, '--persistent-sandbox', '--revoke-key', renewed.issued!.keyId],
      {
        cwd: process.cwd(),
        env: persistentEnvironment,
        input: 'SecurePass123!\n',
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(cutover.status).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', newKey)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', rotatedKey)
      .expect(200);
    const abandoned = invoke('SecurePass123!', ['--persistent-sandbox', '--rotate']);
    expect(abandoned.status).toBe(0);
    const abort = spawnSync(
      process.execPath,
      [...command, '--persistent-sandbox', '--abort-rotation', abandoned.issued!.keyId],
      {
        cwd: process.cwd(),
        env: persistentEnvironment,
        input: 'SecurePass123!\n',
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(abort.status).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', rotatedKey)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v2/companies/${billingCompanyId}/fiscal-onboarding/SANDBOX`)
      .set('X-API-Key', abandoned.issued!.key)
      .expect(401);
  });

  it('compensates initial enrollment storage and audit failures, then recovers and retries', async () => {
    const enrolled = await createFiscalTenantFixture(context);
    const externalCompanyId = randomUUID();
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: enrolled.userId },
      select: { email: true },
    });
    const recipient = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const recipientPublicFile = join(tmpdir(), `billing-spec09-recipient-${randomUUID()}.pem`);
    writeFileSync(recipientPublicFile, recipient.publicKey.export({ format: 'pem', type: 'spki' }));
    recipientPublicFiles.add(recipientPublicFile);
    const keyOutputFile = join(tmpdir(), `billing-spec09-key-${randomUUID()}.json`);
    const issued = spawnSync(
      process.execPath,
      [
        'node_modules/ts-node/dist/bin.js',
        '-r',
        'tsconfig-paths/register',
        join('scripts', 'spec09-issue-enrollment-key-lab.ts'),
        enrolled.tenantId,
        enrolled.companyId,
        externalCompanyId,
        admin.email,
        '--output-file',
        keyOutputFile,
        '--recipient-public-key',
        recipientPublicFile,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        input: 'SecurePass123!\n',
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(issued.status).toBe(0);
    const encryptedFile = readFileSync(keyOutputFile, 'utf8');
    const envelope = JSON.parse(encryptedFile) as { ciphertext: string; companyId: string };
    expect(envelope.companyId).toBe(externalCompanyId);
    const key = privateDecrypt(
      { key: recipient.privateKey, oaepHash: 'sha256' },
      Buffer.from(envelope.ciphertext, 'base64'),
    ).toString('utf8');
    expect(encryptedFile).not.toContain(key);
    unlinkSync(keyOutputFile);
    expect(issued.stdout).not.toContain(key);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: enrolled.companyId } });
    const signing = createTestSigningMaterialWithFiscalId(
      `CPJ-${company.identificationNumber}`,
      'failure-synthetic-pin',
    );
    const endpoint = `/api/v2/companies/${enrolled.companyId}/fiscal-onboarding/SANDBOX/requests`;
    const submit = () =>
      request(app.getHttpServer())
        .post(endpoint)
        .set('X-API-Key', key)
        .set('Idempotency-Key', 'enroll-failure-retry-001')
        .field('externalCompanyKey', `affiliations:${externalCompanyId}`)
        .field('pin', signing.passphrase)
        .field('username', 'failure-user')
        .field('password', 'failure-password')
        .attach('certificate', signing.pkcs12Bytes, {
          filename: 'synthetic.p12',
          contentType: 'application/x-pkcs12',
        });
    const secrets = app.get<SecretProvider>(SECRET_PROVIDER);
    Object.defineProperty(secrets, 'isDurable', { value: true });
    const originalStore = secrets.storeSecret.bind(secrets);
    const storeSpy = jest.spyOn(secrets, 'storeSecret').mockImplementation(async (ref, value) => {
      await originalStore(ref, value);
      throw new Error('synthetic enrollment storage failure');
    });
    try {
      await submit().expect(503);
    } finally {
      storeSpy.mockRestore();
    }
    const where = {
      companyId: enrolled.companyId,
      operation: 'INITIAL_ENROLLMENT',
      idempotencyKey: 'enroll-failure-retry-001',
    };
    const failedStore = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({ where });
    expect(failedStore.state).toBe('COMPENSATED');
    for (const ref of failedStore.newSecretReferences as string[])
      await expect(secrets.getSecret(ref)).rejects.toBeDefined();
    expect(
      await prisma.fiscalSigningCertificate.count({
        where: { companyId: enrolled.companyId, status: 'ACTIVE' },
      }),
    ).toBe(0);
    const service = app.get(EnrollmentV2Service);
    const originalAudit = Reflect.get(service, 'audit') as (...args: unknown[]) => Promise<void>;
    let auditCalls = 0;
    Reflect.set(service, 'audit', async (...args: unknown[]) => {
      if (++auditCalls === 2) throw new Error('synthetic enrollment audit failure');
      return originalAudit.apply(service, args);
    });
    try {
      await submit().expect(503);
    } finally {
      Reflect.set(service, 'audit', originalAudit);
    }
    const failedAudit = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({ where });
    expect(failedAudit.state).toBe('COMPENSATED');
    for (const ref of failedAudit.newSecretReferences as string[])
      await expect(secrets.getSecret(ref)).rejects.toBeDefined();
    const orphan = `spec09-enrollment-interrupted/${randomUUID()}`;
    await secrets.storeSecret(orphan, 'synthetic-orphan');
    await prisma.fiscalOnboardingMutationV2.update({
      where: { id: failedAudit.id },
      data: { state: 'RECOVERY_REQUIRED', newSecretReferences: [orphan] },
    });
    const recoveries = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`${endpoint}/${failedAudit.id}/recover`)
          .set('X-API-Key', key),
      ),
    );
    expect(
      recoveries.every((result) => result.status === 200 && result.body.state === 'COMPENSATED'),
    ).toBe(true);
    await expect(secrets.getSecret(orphan)).rejects.toBeDefined();
    const approved = await submit().expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(
      JSON.stringify(
        await prisma.auditLog.findMany({
          where: { tenantId: enrolled.tenantId },
        }),
      ),
    ).not.toContain('failure-password');
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
      .set('Idempotency-Key', 'wrong-pin-001')
      .field('pin', 'wrong-pin')
      .attach('certificate', signing.pkcs12Bytes, {
        filename: 'synthetic.p12',
        contentType: 'application/x-pkcs12',
      })
      .expect(422);
    const uploaded = await request(app.getHttpServer())
      .post(`${base()}/certificate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'certificate-001')
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
      .set('Idempotency-Key', 'credentials-001')
      .send({ username: 'synthetic-user', password: 'synthetic-password' })
      .expect(200);
    expect(JSON.stringify(credentials.body)).not.toContain('synthetic-password');
    const first = await prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId, companyId, environment: 'SANDBOX' },
    });
    await request(app.getHttpServer())
      .post(`${base()}/credentials/rotate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'credentials-rotate-001')
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

  it('validates stored credentials at the isolated IDP fixture with audit and no secret exposure', async () => {
    const verifier = app.get<MockHaciendaAuthAdapter>(SPEC09_CREDENTIAL_VERIFIER);
    const endpoint = `${base()}/credentials/validate`;
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { scopes: ['fiscal-v2:onboarding:read'] },
    });
    await request(app.getHttpServer()).post(endpoint).set('X-API-Key', secret).expect(403);
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { scopes: [...CONSUMER_V2_LAB_SCOPES] },
    });
    await request(app.getHttpServer())
      .post(`/api/v2/companies/${randomUUID()}/fiscal-onboarding/SANDBOX/credentials/validate`)
      .set('X-API-Key', secret)
      .expect(404);
    verifier.behavior = 'INVALID_CREDENTIALS';
    const invalid = await request(app.getHttpServer())
      .post(endpoint)
      .set('X-API-Key', secret)
      .expect(200);
    expect(invalid.body).toMatchObject({
      status: 'INVALID_CREDENTIALS',
      externalCall: true,
      issuedDocument: false,
      productionAuthorized: false,
    });
    verifier.behavior = 'UNAVAILABLE';
    const unavailable = await request(app.getHttpServer())
      .post(endpoint)
      .set('X-API-Key', secret)
      .expect(200);
    expect(unavailable.body.status).toBe('UNAVAILABLE');
    verifier.behavior = 'SUCCESS';
    const valid = await request(app.getHttpServer())
      .post(endpoint)
      .set('X-API-Key', secret)
      .expect(200);
    expect(valid.body.status).toBe('CONNECTED');
    expect(JSON.stringify([invalid.body, unavailable.body, valid.body])).not.toContain(
      'synthetic-password-2',
    );
    const persisted = await prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId, companyId, environment: 'SANDBOX' },
    });
    expect(persisted.status).toBe('CONNECTED');
    expect(persisted.secretReference).toBeTruthy();
    const entries = await request(app.getHttpServer())
      .get(`${base()}/audit`)
      .set('X-API-Key', secret)
      .expect(200);
    expect(
      entries.body.some(
        (entry: { action: string }) => entry.action === 'onboarding-v2.credentials.validated',
      ),
    ).toBe(true);
    expect(JSON.stringify(entries.body)).not.toContain('synthetic-password-2');
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

  it('replays safe responses and rejects a changed idempotency payload', async () => {
    const first = await request(app.getHttpServer())
      .post(`${base()}/credentials/rotate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'rotation-replay-001')
      .send({ username: 'replay-user', password: 'replay-password' })
      .expect(200);
    const connection = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    const replay = await request(app.getHttpServer())
      .post(`${base()}/credentials/rotate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'rotation-replay-001')
      .send({ username: 'replay-user', password: 'replay-password' })
      .expect(200);
    expect(replay.body).toEqual(first.body);
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .secretReference,
    ).toBe(connection.secretReference);
    await request(app.getHttpServer())
      .post(`${base()}/credentials/rotate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'rotation-replay-001')
      .send({ username: 'replay-user', password: 'changed-password' })
      .expect(409);
    expect(
      JSON.stringify(await prisma.fiscalOnboardingMutationV2.findMany({ where: { tenantId } })),
    ).not.toContain('replay-password');
  });

  it('compensates provider and audit failures without activating partial credentials', async () => {
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const current = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    const originalStore = isolatedSecrets.storeSecret.bind(isolatedSecrets);
    const storeSpy = jest
      .spyOn(isolatedSecrets, 'storeSecret')
      .mockImplementation(async (reference, value) => {
        await originalStore(reference, value);
        throw new Error('synthetic provider failure');
      });
    try {
      await request(app.getHttpServer())
        .post(`${base()}/credentials/rotate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'provider-failure-001')
        .send({ username: 'provider-failure', password: 'secret-provider-failure' })
        .expect(503);
    } finally {
      storeSpy.mockRestore();
    }
    const providerMutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'provider-failure-001' },
    });
    expect(providerMutation.state).toBe('COMPENSATED');
    await expect(
      isolatedSecrets.getSecret((providerMutation.newSecretReferences as string[])[0]),
    ).rejects.toBeDefined();
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: current.id } }))
        .secretReference,
    ).toBe(current.secretReference);

    const mutator = app.get(OnboardingV2MutationService);
    const originalAudit = Reflect.get(mutator, 'audit') as (...args: unknown[]) => Promise<void>;
    let auditCalls = 0;
    Reflect.set(mutator, 'audit', async (...args: unknown[]) => {
      auditCalls += 1;
      if (auditCalls === 2) throw new Error('synthetic audit failure');
      return originalAudit.apply(mutator, args);
    });
    try {
      await request(app.getHttpServer())
        .post(`${base()}/credentials/rotate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'audit-failure-001')
        .send({ username: 'audit-failure', password: 'secret-audit-failure' })
        .expect(503);
    } finally {
      Reflect.set(mutator, 'audit', originalAudit);
    }
    const auditMutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'audit-failure-001' },
    });
    expect(auditMutation.state).toBe('COMPENSATED');
    await expect(
      isolatedSecrets.getSecret((auditMutation.newSecretReferences as string[])[0]),
    ).rejects.toBeDefined();
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: current.id } }))
        .secretReference,
    ).toBe(current.secretReference);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId } }))).not.toContain(
      'secret-audit-failure',
    );
  });

  it('compensates both certificate and PIN references when the second secret write fails', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const signing = createTestSigningMaterialWithFiscalId(
      `CPJ-${company.identificationNumber}`,
      'certificate-failure-pin',
    );
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const originalStore = isolatedSecrets.storeSecret.bind(isolatedSecrets);
    let writes = 0;
    const storeSpy = jest
      .spyOn(isolatedSecrets, 'storeSecret')
      .mockImplementation(async (reference, value) => {
        writes += 1;
        await originalStore(reference, value);
        if (writes === 2) throw new Error('synthetic PIN store failure');
      });
    const before = await prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX', status: 'ACTIVE' },
    });
    try {
      await request(app.getHttpServer())
        .post(`${base()}/certificate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'certificate-store-failure-001')
        .field('pin', signing.passphrase)
        .attach('certificate', signing.pkcs12Bytes, {
          filename: 'synthetic.p12',
          contentType: 'application/x-pkcs12',
        })
        .expect(503);
    } finally {
      storeSpy.mockRestore();
    }
    const mutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'certificate-store-failure-001' },
    });
    expect(mutation.state).toBe('COMPENSATED');
    for (const reference of mutation.newSecretReferences as string[]) {
      await expect(isolatedSecrets.getSecret(reference)).rejects.toBeDefined();
    }
    const active = await prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX', status: 'ACTIVE' },
    });
    expect(active.id).toBe(before.id);
  });

  it('replaces a synthetic certificate while retaining encrypted historical material', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const signing = createTestSigningMaterialWithFiscalId(
      `CPJ-${company.identificationNumber}`,
      'replacement-pin',
    );
    const previous = await prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX', status: 'ACTIVE' },
    });
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    await request(app.getHttpServer())
      .post(`${base()}/certificate`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', 'certificate-replace-001')
      .field('pin', signing.passphrase)
      .attach('certificate', signing.pkcs12Bytes, {
        filename: 'synthetic.p12',
        contentType: 'application/x-pkcs12',
      })
      .expect(201);
    const old = await prisma.fiscalSigningCertificate.findUniqueOrThrow({
      where: { id: previous.id },
    });
    expect(old.status).toBe('REPLACED');
    expect(old.replacedById).toBeTruthy();
    expect(await isolatedSecrets.getSecret(old.certificateSecretReference)).toContain(
      'pkcs12Base64',
    );
    expect(await isolatedSecrets.getSecret(old.passwordSecretReference)).toBeTruthy();
    expect(
      await prisma.fiscalSigningCertificate.count({
        where: { companyId, environment: 'SANDBOX', status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('blocks a revoked key between staging and activation, and recovers an interrupted operation', async () => {
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const current = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    const originalStore = isolatedSecrets.storeSecret.bind(isolatedSecrets);
    const storeSpy = jest
      .spyOn(isolatedSecrets, 'storeSecret')
      .mockImplementation(async (reference, value) => {
        await originalStore(reference, value);
        await prisma.apiKey.update({
          where: { id: keyId },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
      });
    try {
      await request(app.getHttpServer())
        .post(`${base()}/credentials/rotate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'revoked-during-write-001')
        .send({ username: 'revoked-user', password: 'revoked-password' })
        .expect(403);
    } finally {
      storeSpy.mockRestore();
      await prisma.apiKey.update({
        where: { id: keyId },
        data: { status: 'ACTIVE', revokedAt: null },
      });
    }
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: current.id } }))
        .secretReference,
    ).toBe(current.secretReference);
    const revokedMutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'revoked-during-write-001' },
    });
    expect(revokedMutation.state).toBe('COMPENSATED');
    await expect(
      isolatedSecrets.getSecret((revokedMutation.newSecretReferences as string[])[0]),
    ).rejects.toBeDefined();

    const orphanRef = `hacienda-conn/${companyId}/SANDBOX/${randomUUID()}`;
    await isolatedSecrets.storeSecret(orphanRef, 'synthetic-interrupted-secret');
    const operationId = randomUUID();
    await prisma.fiscalOnboardingMutationV2.create({
      data: {
        id: operationId,
        tenantId,
        companyId,
        associationId,
        environment: 'SANDBOX',
        operation: 'CREDENTIALS_ROTATE',
        idempotencyKey: 'interrupted-write-001',
        requestDigest: '0'.repeat(64),
        state: 'RECOVERY_REQUIRED',
        newSecretReferences: [orphanRef],
        retiredSecretReferences: [],
      },
    });
    await request(app.getHttpServer())
      .post(`${base()}/mutations/${operationId}/recover`)
      .set('X-API-Key', secret)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('COMPENSATED'));
    await expect(isolatedSecrets.getSecret(orphanRef)).rejects.toBeDefined();
    await request(app.getHttpServer())
      .post(`${base()}/mutations/${operationId}/recover`)
      .set('X-API-Key', secret)
      .expect(200);
  });

  it('serializes concurrent rotations and leaves one active credential reference', async () => {
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const responses = await Promise.all(
      ['concurrent-a-001', 'concurrent-b-001'].map((key) =>
        request(app.getHttpServer())
          .post(`${base()}/credentials/rotate`)
          .set('X-API-Key', secret)
          .set('Idempotency-Key', key)
          .send({ username: key, password: `synthetic-${key}` }),
      ),
    );
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(responses.every((response) => [200, 409, 503].includes(response.status))).toBe(true);
    const connection = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    expect(await isolatedSecrets.getSecret(connection.secretReference)).toContain(
      'synthetic-concurrent-',
    );
    const mutations = await prisma.fiscalOnboardingMutationV2.findMany({
      where: { associationId, idempotencyKey: { in: ['concurrent-a-001', 'concurrent-b-001'] } },
    });
    for (const mutation of mutations) {
      if (mutation.state === 'COMPENSATED') {
        await expect(
          isolatedSecrets.getSecret((mutation.newSecretReferences as string[])[0]),
        ).rejects.toBeDefined();
      }
    }
    expect(JSON.stringify(responses.map((response) => response.body))).not.toContain(
      'synthetic-concurrent-',
    );
  });

  it('records a committed cleanup obligation and retires the old secret on recovery', async () => {
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const before = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    const deleteSpy = jest
      .spyOn(isolatedSecrets, 'deleteSecret')
      .mockRejectedValueOnce(new Error('synthetic secret deletion failure'));
    try {
      await request(app.getHttpServer())
        .post(`${base()}/credentials/rotate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'cleanup-pending-001')
        .send({ username: 'cleanup-user', password: 'cleanup-password' })
        .expect(200);
    } finally {
      deleteSpy.mockRestore();
    }
    const mutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'cleanup-pending-001' },
    });
    expect(mutation.state).toBe('COMMITTED_CLEANUP_PENDING');
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: before.id } }))
        .secretReference,
    ).not.toBe(before.secretReference);
    expect(await isolatedSecrets.getSecret(before.secretReference)).toBeTruthy();
    await request(app.getHttpServer())
      .post(`${base()}/mutations/${mutation.id}/recover`)
      .set('X-API-Key', secret)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('COMMITTED'));
    await expect(isolatedSecrets.getSecret(before.secretReference)).rejects.toBeDefined();
  });

  it('does not activate credentials after recovery claims an interrupted staged operation', async () => {
    const isolatedSecrets = app.get<SecretProvider>(SECRET_PROVIDER);
    const before = await prisma.haciendaConnection.findFirstOrThrow({
      where: { companyId, environment: 'SANDBOX' },
    });
    const originalStore = isolatedSecrets.storeSecret.bind(isolatedSecrets);
    const storeSpy = jest
      .spyOn(isolatedSecrets, 'storeSecret')
      .mockImplementation(async (reference, value) => {
        await originalStore(reference, value);
        const staged = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
          where: { associationId, idempotencyKey: 'recovery-race-001' },
        });
        await prisma.fiscalOnboardingMutationV2.update({
          where: { id: staged.id },
          data: { updatedAt: new Date(Date.now() - 11 * 60_000) },
        });
        await request(app.getHttpServer())
          .post(`${base()}/mutations/${staged.id}/recover`)
          .set('X-API-Key', secret)
          .expect(200)
          .expect(({ body }) => expect(body.state).toBe('COMPENSATED'));
      });
    try {
      await request(app.getHttpServer())
        .post(`${base()}/credentials/rotate`)
        .set('X-API-Key', secret)
        .set('Idempotency-Key', 'recovery-race-001')
        .send({ username: 'recovery-race', password: 'recovery-race-secret' })
        .expect(409);
    } finally {
      storeSpy.mockRestore();
    }
    expect(
      (await prisma.haciendaConnection.findUniqueOrThrow({ where: { id: before.id } }))
        .secretReference,
    ).toBe(before.secretReference);
    const mutation = await prisma.fiscalOnboardingMutationV2.findFirstOrThrow({
      where: { associationId, idempotencyKey: 'recovery-race-001' },
    });
    expect(mutation.state).toBe('COMPENSATED');
    await expect(
      isolatedSecrets.getSecret((mutation.newSecretReferences as string[])[0]),
    ).rejects.toBeDefined();
  });
});
