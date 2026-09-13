import * as request from 'supertest';
import {
  authorizeApiKeyForCompany,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';

describe('Fiscal Management (E2E)', () => {
  let context: FiscalE2eContext;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  afterAll(async () => {
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('allows TENANT_ADMIN to configure default issuance point and sequence', async () => {
    const fixture = await createFiscalTenantFixture(context);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/issuance-points/default`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ name: 'Admin configured point' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.companyId).toBe(fixture.companyId);
        expect(body.environment).toBe('SANDBOX');
        expect(body.branchCode).toBe('001');
        expect(body.terminalCode).toBe('00001');
      });

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ nextValue: '7' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.companyId).toBe(fixture.companyId);
        expect(body.environment).toBe('SANDBOX');
        expect(body.documentType).toBe('INVOICE');
        expect(body.nextValue).toBe('7');
      });
  });

  it('rejects API keys and cross-tenant JWTs for management endpoints', async () => {
    const tenantA = await createFiscalTenantFixture(context);
    const tenantB = await createFiscalTenantFixture(context);
    const apiKey = await createFiscalApiKey(context.prisma, tenantA.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, tenantA.companyId);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${tenantA.companyId}/fiscal/SANDBOX/issuance-points/default`)
      .set('X-API-Key', apiKey.secret)
      .send({ name: 'API key denied point' })
      .expect(401);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${tenantB.companyId}/fiscal/SANDBOX/issuance-points/default`)
      .set('Authorization', `Bearer ${tenantA.jwtToken}`)
      .send({ name: 'Cross tenant denied point' })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${tenantB.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${tenantA.jwtToken}`)
      .send({ nextValue: '1' })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));
  });

  it('rejects sequence reset after the first allocation starts', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/issuance-points/default`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ name: 'Reset denial point' })
      .expect(200);
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ nextValue: '1' })
      .expect(200);

    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'sequence-reset-denial')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ nextValue: '1' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_SEQUENCE_ALREADY_STARTED'));
  });
});
