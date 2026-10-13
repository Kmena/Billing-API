import * as request from 'supertest';
import {
  authorizeApiKeyForCompany,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  resetFiscalE2eData,
  type FiscalE2eContext,
  type FiscalTenantFixture,
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany, createTestUser } from '../../helpers/test-factories';
import {
  INVENTORI_BOOTSTRAP_PROFILE,
  INVENTORI_BOOTSTRAP_V1_SCOPES,
  INVENTORI_FISCAL_PROFILE,
  INVENTORI_FISCAL_V1_SCOPES,
} from '../../../src/modules/fiscal-onboarding/domain/inventori-fiscal-profile';

describe('Wave 3 fiscal onboarding v1 — disposable PostgreSQL', () => {
  let context: FiscalE2eContext;

  const root = (companyId: string, environment = 'SANDBOX') =>
    `/api/v1/companies/${companyId}/fiscal-onboarding/v1/${environment}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  beforeEach(async () => resetFiscalE2eData(context));

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context.app.close();
  });

  function provision(fixture: FiscalTenantFixture, externalCompanyKey = 'inventori:company:001') {
    return request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/associations')
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({
        externalCompanyKey,
        companyId: fixture.companyId,
        legalName: 'Synthetic Fiscal Issuer',
        identificationType: 'JURIDICA',
        identificationNumber: fixture.companyIdentification,
      });
  }

  async function profiledKey(
    fixture: FiscalTenantFixture,
    scopes = [...INVENTORI_FISCAL_V1_SCOPES],
  ) {
    const key = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      scopes,
      'ACTIVE',
      'TEST',
      INVENTORI_FISCAL_PROFILE,
    );
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
    return key;
  }

  it('provisions one stable issuer association idempotently and rejects reassociation', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const first = await provision(fixture).expect(200);
    const replay = await provision(fixture).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      externalCompanyKey: 'inventori:company:001',
      profileVersion: INVENTORI_FISCAL_PROFILE,
      company: { id: fixture.companyId },
    });
    expect(await context.prisma.fiscalIntegrationAssociation.count()).toBe(1);

    await provision(fixture, 'inventori:company:other')
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('ASSOCIATION_CONCURRENT_CONFLICT'));
    expect(await context.prisma.fiscalIntegrationAssociation.count()).toBe(1);
  });

  it('keeps privileged bootstrap separate from M2M and ordinary tenant members', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await profiledKey(fixture);
    await request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/associations')
      .set('X-API-Key', key.secret)
      .send({})
      .expect(401);

    const member = await createTestUser(context.prisma, fixture.tenantId, {
      role: 'MEMBER',
      email: `member-${fixture.companyId}@example.com`,
    });
    const login = await request(context.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantId, email: member.email, password: member.password })
      .expect(200);
    await request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/associations')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('TENANT_ADMIN_REQUIRED'));
    expect(await context.prisma.fiscalIntegrationAssociation.count()).toBe(0);
  });

  it('bootstraps through a tenant-bound service key and rotates only the returned-once handoff on replay', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const other = await createFiscalTenantFixture(context);
    const bootstrap = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      [...INVENTORI_BOOTSTRAP_V1_SCOPES],
      'ACTIVE',
      'TEST',
      INVENTORI_BOOTSTRAP_PROFILE,
    );
    const body = {
      externalCompanyKey: 'inventori:bootstrap:001',
      existingCompanyId: fixture.companyId,
      legalName: 'Synthetic Fiscal Issuer',
      identificationType: 'JURIDICA',
      identificationNumber: fixture.companyIdentification,
      environment: 'SANDBOX',
    };
    const first = await request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/bootstrap')
      .set('X-API-Key', bootstrap.secret)
      .send(body)
      .expect(200);
    expect(first.body.association.company.id).toBe(fixture.companyId);
    expect(first.body.credential).toMatchObject({
      profileVersion: INVENTORI_FISCAL_PROFILE,
      environment: 'TEST',
      returnedOnce: true,
    });
    expect(first.body.credential.secret).toMatch(/^bk_test_/);

    await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/issuer`)
      .set('X-API-Key', first.body.credential.secret)
      .expect(200);

    const replay = await request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/bootstrap')
      .set('X-API-Key', bootstrap.secret)
      .send(body)
      .expect(200);
    expect(replay.body.association.associationId).toBe(first.body.association.associationId);
    expect(replay.body.credential.secret).not.toBe(first.body.credential.secret);
    await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/issuer`)
      .set('X-API-Key', first.body.credential.secret)
      .expect(401);
    await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/issuer`)
      .set('X-API-Key', replay.body.credential.secret)
      .expect(200);

    await request(context.app.getHttpServer())
      .post('/api/v1/fiscal-onboarding/v1/bootstrap')
      .set('X-API-Key', bootstrap.secret)
      .send({ ...body, existingCompanyId: other.companyId })
      .expect(409)
      .expect(({ body: conflictBody }) => {
        expect(conflictBody.error.code).toBe('FISCAL_ASSOCIATION_PAYLOAD_CONFLICT');
      });
    expect(await context.prisma.fiscalIntegrationAssociation.count()).toBe(1);
    expect(
      await context.prisma.apiKey.count({
        where: {
          tenantId: fixture.tenantId,
          integrationProfile: INVENTORI_FISCAL_PROFILE,
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
  });

  it('enforces profile, scope, company, tenant, environment, revocation and expiry before mutation', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const other = await createFiscalTenantFixture(context);
    const sibling = await createTestCompany(context.prisma, fixture.tenantId);
    const path = `${root(fixture.companyId)}/branches`;
    const body = { code: '001', name: 'Principal' };

    const noProfile = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'fiscal-issuance-points:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, noProfile.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', noProfile.secret)
      .send(body)
      .expect(403)
      .expect(({ body: response }) =>
        expect(response.error.code).toBe('INTEGRATION_PROFILE_NOT_AUTHORIZED'),
      );

    const noScope = await profiledKey(fixture, ['fiscal-issuance-points:read']);
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', noScope.secret)
      .send(body)
      .expect(403)
      .expect(({ body: response }) => expect(response.error.code).toBe('INSUFFICIENT_SCOPE'));

    const key = await profiledKey(fixture);
    await request(context.app.getHttpServer())
      .post(`${root(sibling.id)}/branches`)
      .set('X-API-Key', key.secret)
      .send(body)
      .expect(403)
      .expect(({ body: response }) =>
        expect(response.error.code).toBe('API_KEY_COMPANY_NOT_AUTHORIZED'),
      );
    await request(context.app.getHttpServer())
      .post(`${root(other.companyId)}/branches`)
      .set('X-API-Key', key.secret)
      .send(body)
      .expect(404)
      .expect(({ body: response }) => expect(response.error.code).toBe('COMPANY_NOT_FOUND'));
    await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId, 'PRODUCTION')}/branches`)
      .set('X-API-Key', key.secret)
      .send(body)
      .expect(403)
      .expect(({ body: response }) =>
        expect(response.error.code).toBe('API_KEY_ENVIRONMENT_NOT_AUTHORIZED'),
      );

    const revoked = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      [...INVENTORI_FISCAL_V1_SCOPES],
      'REVOKED',
      'TEST',
      INVENTORI_FISCAL_PROFILE,
    );
    await authorizeApiKeyForCompany(context.prisma, revoked.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', revoked.secret)
      .send(body)
      .expect(401)
      .expect(({ body: response }) => expect(response.error.code).toBe('API_KEY_REVOKED'));

    const expired = await profiledKey(fixture);
    await context.prisma.apiKey.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await request(context.app.getHttpServer())
      .post(path)
      .set('X-API-Key', expired.secret)
      .send(body)
      .expect(401)
      .expect(({ body: response }) => expect(response.error.code).toBe('API_KEY_EXPIRED'));

    const deniedScope = { tenantId: fixture.tenantId, companyId: fixture.companyId };
    expect(await context.prisma.fiscalBranch.count({ where: deniedScope })).toBe(0);
    expect(await context.prisma.fiscalTerminal.count({ where: deniedScope })).toBe(0);
    expect(await context.prisma.fiscalSequence.count({ where: deniedScope })).toBe(0);
  });

  it('updates and reads issuer/profile through the bound profile without exposing secrets', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await provision(fixture).expect(200);
    const key = await profiledKey(fixture);

    await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/issuer`)
      .set('X-API-Key', key.secret)
      .expect(200)
      .expect(({ body }) => expect(body.company.id).toBe(fixture.companyId));
    await request(context.app.getHttpServer())
      .put(`${root(fixture.companyId)}/profile`)
      .set('X-API-Key', key.secret)
      .send({
        economicActivityCode: '620210',
        province: '1',
        canton: '01',
        district: '01',
        otrasSenas: 'Dirección fiscal sintética para pruebas',
        email: 'fiscal@example.test',
      })
      .expect(200);
    const profile = await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/profile`)
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(profile.body).toMatchObject({ companyId: fixture.companyId, province: '1' });
    expect(JSON.stringify(profile.body)).not.toMatch(/password|pin|secretReference/i);
  });

  it('disables Hacienda idempotently through the bound M2M contract and readiness stays fail-closed', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const sibling = await createTestCompany(context.prisma, fixture.tenantId);
    const other = await createFiscalTenantFixture(context);
    const key = await profiledKey(fixture);
    const endpoint = `${root(fixture.companyId)}/hacienda-connection`;

    await request(context.app.getHttpServer())
      .put(endpoint)
      .set('X-API-Key', key.secret)
      .send({ username: 'synthetic-user', password: 'synthetic-password' })
      .expect(200);
    const before = await context.prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, environment: 'SANDBOX' },
    });

    const first = await request(context.app.getHttpServer())
      .post(`${endpoint}/disable`)
      .set('X-API-Key', key.secret)
      .send({})
      .expect(200);
    const replay = await request(context.app.getHttpServer())
      .post(`${endpoint}/disable`)
      .set('X-API-Key', key.secret)
      .send({})
      .expect(200);
    expect(first.body.status).toBe('DISABLED');
    expect(replay.body).toEqual(first.body);
    expect(JSON.stringify(replay.body)).not.toMatch(/password|pin|secretReference|accessToken/i);

    const after = await context.prisma.haciendaConnection.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, environment: 'SANDBOX' },
    });
    expect(after.secretReference).toBe(before.secretReference);
    expect(after.status).toBe('DISABLED');
    expect(
      await context.prisma.haciendaConnection.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId, environment: 'SANDBOX' },
      }),
    ).toBe(1);

    await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/readiness`)
      .set('X-API-Key', key.secret)
      .expect(200)
      .expect(({ body }) => {
        expect(body.readyToIssue).toBe(false);
        expect(body.dimensions.hacienda.metadata.status).toBe('DISABLED');
        expect(body.dimensions.hacienda.state).toBe('NOT_READY');
      });

    const readOnly = await profiledKey(fixture, ['fiscal-credentials:read']);
    await request(context.app.getHttpServer())
      .post(`${endpoint}/disable`)
      .set('X-API-Key', readOnly.secret)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));
    await request(context.app.getHttpServer())
      .post(`${root(sibling.id)}/hacienda-connection/disable`)
      .set('X-API-Key', key.secret)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_COMPANY_NOT_AUTHORIZED'));
    await request(context.app.getHttpServer())
      .post(`${root(other.companyId)}/hacienda-connection/disable`)
      .set('X-API-Key', key.secret)
      .send({})
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));
    await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId, 'PRODUCTION')}/hacienda-connection/disable`)
      .set('X-API-Key', key.secret)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_ENVIRONMENT_NOT_AUTHORIZED'));
  });

  it('creates branches/terminals and leaves exactly one default under concurrent selection', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await profiledKey(fixture);
    const branch = await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId)}/branches`)
      .set('X-API-Key', key.secret)
      .send({ code: '001', name: 'Principal' })
      .expect(201);
    const terminalA = await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId)}/branches/${branch.body.id}/terminals`)
      .set('X-API-Key', key.secret)
      .send({ code: '00001', name: 'Caja 1' })
      .expect(201);
    const terminalB = await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId)}/branches/${branch.body.id}/terminals`)
      .set('X-API-Key', key.secret)
      .send({ code: '00002', name: 'Caja 2' })
      .expect(201);

    const selections = await Promise.all([
      request(context.app.getHttpServer())
        .put(`${root(fixture.companyId)}/issuance-points/default`)
        .set('X-API-Key', key.secret)
        .send({ terminalId: terminalA.body.id }),
      request(context.app.getHttpServer())
        .put(`${root(fixture.companyId)}/issuance-points/default`)
        .set('X-API-Key', key.secret)
        .send({ terminalId: terminalB.body.id }),
    ]);
    expect(selections.every(({ status }) => status === 200 || status === 409)).toBe(true);
    expect(selections.some(({ status }) => status === 200)).toBe(true);
    expect(
      await context.prisma.fiscalIssuancePoint.count({
        where: {
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          isDefault: true,
          active: true,
        },
      }),
    ).toBe(1);
  });

  it('initializes sequences concurrently, replays equal values, and refuses reset or decrement', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await profiledKey(fixture);
    const branch = await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId)}/branches`)
      .set('X-API-Key', key.secret)
      .send({ code: '001', name: 'Principal' })
      .expect(201);
    const terminal = await request(context.app.getHttpServer())
      .post(`${root(fixture.companyId)}/branches/${branch.body.id}/terminals`)
      .set('X-API-Key', key.secret)
      .send({ code: '00001', name: 'Caja 1' })
      .expect(201);
    const path = `${root(fixture.companyId)}/terminals/${terminal.body.id}/sequences/INVOICE/initial`;
    const raced = await Promise.all([
      request(context.app.getHttpServer())
        .put(path)
        .set('X-API-Key', key.secret)
        .send({ nextValue: 17 }),
      request(context.app.getHttpServer())
        .put(path)
        .set('X-API-Key', key.secret)
        .send({ nextValue: 17 }),
    ]);
    expect(raced.map(({ status }) => status)).toEqual([200, 200]);
    expect(raced[0].body.nextValue).toBe('17');
    const sequenceScope = {
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      environment: 'SANDBOX' as const,
    };
    expect(await context.prisma.fiscalSequence.count({ where: sequenceScope })).toBe(1);

    await request(context.app.getHttpServer())
      .put(path)
      .set('X-API-Key', key.secret)
      .send({ nextValue: 16 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_SEQUENCE_INITIAL_VALUE_CONFLICT'));
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: sequenceScope,
    });
    await context.prisma.fiscalSequence.update({
      where: { id: sequence.id },
      data: { lastAssigned: 17n, nextValue: 18n },
    });
    await request(context.app.getHttpServer())
      .put(path)
      .set('X-API-Key', key.secret)
      .send({ nextValue: 18 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_SEQUENCE_ALREADY_STARTED'));
    expect(
      await context.prisma.fiscalSequence.findUnique({ where: { id: sequence.id } }),
    ).toMatchObject({ nextValue: 18n, lastAssigned: 17n });
  });

  it('evaluates multidimensional readiness without allocating identities, documents, artifacts, or sequences', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await profiledKey(fixture, ['fiscal-readiness:read']);
    const before = {
      documents: await context.prisma.fiscalDocument.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
      reservations: await context.prisma.fiscalIdempotencyKey.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
      artifacts: await context.prisma.fiscalArtifact.count({
        where: { fiscalDocument: { tenantId: fixture.tenantId, companyId: fixture.companyId } },
      }),
      sequences: await context.prisma.fiscalSequence.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
    };
    const response = await request(context.app.getHttpServer())
      .get(`${root(fixture.companyId)}/readiness`)
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(response.body).toMatchObject({
      contractVersion: '1.0',
      profileVersion: INVENTORI_FISCAL_PROFILE,
      companyId: fixture.companyId,
      environment: 'SANDBOX',
      status: 'NOT_READY',
    });
    expect(Object.keys(response.body.dimensions)).toEqual(
      expect.arrayContaining([
        'issuer',
        'profile',
        'activity',
        'hacienda',
        'certificate',
        'issuancePoint',
        'sequence',
        'operational',
      ]),
    );
    expect({
      documents: await context.prisma.fiscalDocument.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
      reservations: await context.prisma.fiscalIdempotencyKey.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
      artifacts: await context.prisma.fiscalArtifact.count({
        where: { fiscalDocument: { tenantId: fixture.tenantId, companyId: fixture.companyId } },
      }),
      sequences: await context.prisma.fiscalSequence.count({
        where: { tenantId: fixture.tenantId, companyId: fixture.companyId },
      }),
    }).toEqual(before);
  });
});
