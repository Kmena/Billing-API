import { randomUUID } from 'crypto';
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
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany } from '../../helpers/test-factories';
import { FiscalIssuanceEligibilityService } from '../../../src/modules/fiscal-documents/application/fiscal-xml/fiscal-issuance-eligibility.service';
import {
  SECRET_PROVIDER,
  type SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';

describe('Wave 2 fiscal readiness and issuance consistency — disposable PostgreSQL', () => {
  let context: FiscalE2eContext;

  const readiness = (companyId: string, environment = 'SANDBOX') =>
    `/api/v1/companies/${companyId}/fiscal-onboarding/${environment}/readiness`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context.app.close();
  });

  it.each(['PENDING_VALIDATION', 'INVALID_CREDENTIALS', 'UNAVAILABLE', 'DISABLED'] as const)(
    'treats Hacienda status %s as not eligible without mutating fiscal allocation',
    async (status) => {
      const fixture = await createFiscalTenantFixture(context);
      const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
        'fiscal-onboarding:read',
      ]);
      await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
      await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
      await context.prisma.haciendaConnection.updateMany({
        where: {
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          environment: 'SANDBOX',
        },
        data: { status },
      });
      const before = {
        documents: await context.prisma.fiscalDocument.count({
          where: { tenantId: fixture.tenantId },
        }),
        sequences: await context.prisma.fiscalSequence.count({
          where: { tenantId: fixture.tenantId },
        }),
      };

      const response = await request(context.app.getHttpServer())
        .get(readiness(fixture.companyId))
        .set('X-API-Key', key.secret)
        .expect(200);

      expect(response.body.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');
      expect(
        await context.prisma.fiscalDocument.count({
          where: { tenantId: fixture.tenantId },
        }),
      ).toBe(before.documents);
      expect(
        await context.prisma.fiscalSequence.count({
          where: { tenantId: fixture.tenantId },
        }),
      ).toBe(before.sequences);
    },
  );

  it('distinguishes missing, unresolved-secret and connected Hacienda states', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);

    const missing = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(missing.body.reasonCodes).toEqual(
      expect.arrayContaining(['HACIENDA_CONNECTION_MISSING', 'HACIENDA_CREDENTIALS_MISSING']),
    );

    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    const connection = await context.prisma.haciendaConnection.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      },
    });
    await context.prisma.haciendaConnection.update({
      where: { id: connection.id },
      data: { secretReference: `missing-${randomUUID()}` },
    });
    const unresolved = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(unresolved.body.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');

    await context.prisma.haciendaConnection.update({
      where: { id: connection.id },
      data: { secretReference: connection.secretReference },
    });
    const connected = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(connected.body.reasonCodes).not.toContain('HACIENDA_CONNECTION_MISSING');
    expect(connected.body.reasonCodes).not.toContain('HACIENDA_CREDENTIALS_MISSING');
  });

  it('uses only active company/environment defaults and rejects duplicate active defaults', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    const firstId = '00000000-0000-4000-8000-000000000010';
    const secondId = '00000000-0000-4000-8000-000000000020';
    await context.prisma.fiscalIssuancePoint.create({
      data: {
        id: firstId,
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
        branchCode: '001',
        terminalCode: '00001',
        active: false,
        isDefault: true,
      },
    });
    let response = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(response.body.reasonCodes).toContain('ISSUANCE_POINT_MISSING');

    await context.prisma.fiscalIssuancePoint.update({
      where: { id: firstId },
      data: { active: true, isDefault: false },
    });
    await context.prisma.fiscalIssuancePoint.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'PRODUCTION',
        branchCode: '001',
        terminalCode: '00001',
        active: true,
        isDefault: true,
      },
    });
    response = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(response.body.reasonCodes).toContain('ISSUANCE_POINT_MISSING');

    await context.prisma.fiscalIssuancePoint.update({
      where: { id: firstId },
      data: { isDefault: true },
    });
    await expect(
      context.prisma.fiscalIssuancePoint.create({
        data: {
          id: secondId,
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          environment: 'SANDBOX',
          branchCode: '002',
          terminalCode: '00002',
          active: true,
          isDefault: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    response = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(response.body.reasonCodes).not.toContain('ISSUANCE_POINT_MISSING');
    const selected = await context.app
      .get(FiscalIssuanceEligibilityService)
      .activeDefaultIssuancePoint({
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      });
    expect(selected?.id).toBe(firstId);
  });

  it('blocks issuance when the credential secret disappears and consumes no sequence', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
    const readyBeforeChange = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(readyBeforeChange.body.reasonCodes).not.toContain('HACIENDA_CREDENTIALS_MISSING');
    const connection = await context.prisma.haciendaConnection.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      },
    });
    await context.prisma.haciendaConnection.update({
      where: { id: connection.id },
      data: { secretReference: `missing-${randomUUID()}` },
    });
    const before = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      },
    });

    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', `missing-secret-${randomUUID()}`)
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('HACIENDA_CONNECTION_REQUIRED'));

    const after = await context.prisma.fiscalSequence.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.nextValue).toBe(before.nextValue);
    expect(after.lastAssigned).toBe(before.lastAssigned);
    expect(
      await context.prisma.fiscalDocument.count({
        where: { tenantId: fixture.tenantId },
      }),
    ).toBe(0);
  });

  it('uses the current default issuance point when it changes after readiness', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);

    const initialPoint = await context.prisma.fiscalIssuancePoint.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
        active: true,
        isDefault: true,
      },
    });
    const initialSequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
        branchCode: initialPoint.branchCode,
        terminalCode: initialPoint.terminalCode,
        documentType: 'INVOICE',
      },
    });
    const readyBeforeChange = await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId))
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(readyBeforeChange.body.reasonCodes).not.toContain('ISSUANCE_POINT_MISSING');

    const replacementPoint = await context.prisma.fiscalIssuancePoint.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
        branchCode: '002',
        terminalCode: '00002',
        active: true,
        isDefault: false,
      },
    });
    const replacementSequence = await context.prisma.fiscalSequence.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
        branchCode: replacementPoint.branchCode,
        terminalCode: replacementPoint.terminalCode,
        documentType: 'INVOICE',
        nextValue: 50n,
      },
    });
    await context.prisma.$transaction([
      context.prisma.fiscalIssuancePoint.update({
        where: { id: initialPoint.id },
        data: { isDefault: false },
      }),
      context.prisma.fiscalIssuancePoint.update({
        where: { id: replacementPoint.id },
        data: { isDefault: true },
      }),
    ]);

    const response = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', `point-switch-${randomUUID()}`)
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);
    const created = await context.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(created.issuancePointId).toBe(replacementPoint.id);

    const [initialAfter, replacementAfter] = await Promise.all([
      context.prisma.fiscalSequence.findUniqueOrThrow({
        where: { id: initialSequence.id },
      }),
      context.prisma.fiscalSequence.findUniqueOrThrow({
        where: { id: replacementSequence.id },
      }),
    ]);
    expect(initialAfter.nextValue).toBe(initialSequence.nextValue);
    expect(initialAfter.lastAssigned).toBe(initialSequence.lastAssigned);
    expect(replacementAfter.nextValue).toBe(51n);
    expect(replacementAfter.lastAssigned).toBe(50n);
  });
  it('fails closed when the credential reference rotates during issuance and safely retries', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
    const connection = await context.prisma.haciendaConnection.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      },
    });
    const sequenceBefore = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        environment: 'SANDBOX',
      },
    });
    const secretProvider = context.app.get<SecretProvider>(SECRET_PROVIDER);
    const originalGetSecret = secretProvider.getSecret.bind(secretProvider);
    let signalEligibilityRead!: () => void;
    const eligibilityRead = new Promise<void>((resolve) => {
      signalEligibilityRead = resolve;
    });
    let releaseEligibility!: () => void;
    const eligibilityGate = new Promise<void>((resolve) => {
      releaseEligibility = resolve;
    });
    const secretSpy = jest
      .spyOn(secretProvider, 'getSecret')
      .mockImplementationOnce(async (reference) => {
        const value = await originalGetSecret(reference);
        signalEligibilityRead();
        await eligibilityGate;
        return value;
      });
    const replacementReference = `FISCAL_E2E_REPLACEMENT_${randomUUID().replaceAll('-', '')}`;
    const idempotencyKey = `credential-race-${randomUUID()}`;
    process.env[replacementReference] = 'replacement-disposable-test-sentinel';

    try {
      const inFlightRequest = request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', key.secret)
        .set('Idempotency-Key', idempotencyKey)
        .send(fiscalInvoicePayload(fixture.companyId))
        .then((response) => response);
      await eligibilityRead;
      await context.prisma.haciendaConnection.update({
        where: { id: connection.id },
        data: { secretReference: replacementReference },
      });
      releaseEligibility();

      const racedResponse = await inFlightRequest;
      expect(racedResponse.status).toBe(400);
      expect(racedResponse.body.error.code).toBe('HACIENDA_CONNECTION_REQUIRED');
      const afterDenied = await context.prisma.fiscalSequence.findUniqueOrThrow({
        where: { id: sequenceBefore.id },
      });
      expect(afterDenied.nextValue).toBe(sequenceBefore.nextValue);
      expect(afterDenied.lastAssigned).toBe(sequenceBefore.lastAssigned);
      expect(
        await context.prisma.fiscalDocument.count({
          where: { tenantId: fixture.tenantId },
        }),
      ).toBe(0);

      await request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', key.secret)
        .set('Idempotency-Key', idempotencyKey)
        .send(fiscalInvoicePayload(fixture.companyId))
        .expect(201);
      const afterRetry = await context.prisma.fiscalSequence.findUniqueOrThrow({
        where: { id: sequenceBefore.id },
      });
      expect(afterRetry.nextValue).toBe(sequenceBefore.nextValue + 1n);
      expect(afterRetry.lastAssigned).toBe(sequenceBefore.nextValue);
      expect(
        await context.prisma.fiscalDocument.count({
          where: { tenantId: fixture.tenantId },
        }),
      ).toBe(1);
    } finally {
      releaseEligibility();
      secretSpy.mockRestore();
      delete process.env[replacementReference];
    }
  });
  it('denies wrong company, cross-tenant company and wrong environment before evaluation', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const sameTenantCompany = await createTestCompany(context.prisma, fixture.tenantId);
    const foreign = await createFiscalTenantFixture(context);
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'fiscal-onboarding:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);

    await request(context.app.getHttpServer())
      .get(readiness(sameTenantCompany.id))
      .set('X-API-Key', key.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_COMPANY_NOT_AUTHORIZED'));
    await request(context.app.getHttpServer())
      .get(readiness(foreign.companyId))
      .set('X-API-Key', key.secret)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));
    await request(context.app.getHttpServer())
      .get(readiness(fixture.companyId, 'PRODUCTION'))
      .set('X-API-Key', key.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_ENVIRONMENT_NOT_AUTHORIZED'));
  });
});
