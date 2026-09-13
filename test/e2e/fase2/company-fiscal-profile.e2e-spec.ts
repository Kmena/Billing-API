import * as request from 'supertest';
import {
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';

const validFiscalProfilePayload = {
  economicActivityCode: '620210',
  proveedorSistemas: '3101234567',
  province: '1',
  canton: '01',
  district: '01',
  barrio: 'Carmen',
  otrasSenas: 'Avenida central, edificio fiscal, segundo piso',
  email: 'facturacion@example.co.cr',
  phoneCountryCode: '506',
  phoneNumber: '22223333',
};

describe('Company Fiscal Profile (E2E)', () => {
  let context: FiscalE2eContext;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  beforeEach(async () => {
    await resetFiscalE2eData(context.prisma);
  });

  afterAll(async () => {
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('allows TENANT_ADMIN to create, update and read a fiscal profile', async () => {
    const fixture = await createFiscalTenantFixture(context);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send(validFiscalProfilePayload)
      .expect(200)
      .expect(({ body }) => {
        expect(body.companyId).toBe(fixture.companyId);
        expect(body.tenantId).toBe(fixture.tenantId);
        expect(body.economicActivityCode).toBe('620210');
        expect(body.email).toBe('facturacion@example.co.cr');
      });

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({
        ...validFiscalProfilePayload,
        economicActivityCode: '722001',
        email: 'updated@example.co.cr',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.economicActivityCode).toBe('722001');
        expect(body.email).toBe('updated@example.co.cr');
      });

    await request(context.app.getHttpServer())
      .get(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.companyId).toBe(fixture.companyId);
        expect(body.economicActivityCode).toBe('722001');
        expect(body.email).toBe('updated@example.co.cr');
      });
  });

  it('preserves tenant/company ownership and denies cross-tenant profile access', async () => {
    const tenantA = await createFiscalTenantFixture(context);
    const tenantB = await createFiscalTenantFixture(context);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${tenantA.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${tenantA.jwtToken}`)
      .send(validFiscalProfilePayload)
      .expect(200);

    await request(context.app.getHttpServer())
      .get(`/api/v1/companies/${tenantA.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${tenantB.jwtToken}`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_FISCAL_PROFILE_NOT_FOUND'));

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${tenantA.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${tenantB.jwtToken}`)
      .send({ ...validFiscalProfilePayload, economicActivityCode: '722001' })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));

    const profile = await context.prisma.companyFiscalProfile.findUnique({
      where: { companyId: tenantA.companyId },
    });
    expect(profile?.tenantId).toBe(tenantA.tenantId);
    expect(profile?.economicActivityCode).toBe('620210');
  });

  it('denies API-key profile management because fiscal profile is JWT/admin only', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('X-API-Key', apiKey.secret)
      .send(validFiscalProfilePayload)
      .expect(401);

    await request(context.app.getHttpServer())
      .get(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('X-API-Key', apiKey.secret)
      .expect(401);
  });

  it('rejects invalid fiscal profile values before persistence', async () => {
    const fixture = await createFiscalTenantFixture(context);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ ...validFiscalProfilePayload, economicActivityCode: '62021' })
      .expect(400);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ ...validFiscalProfilePayload, email: 'not-an-email' })
      .expect(400);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ ...validFiscalProfilePayload, phoneNumber: undefined })
      .expect(400);

    const profileCount = await context.prisma.companyFiscalProfile.count({
      where: { companyId: fixture.companyId },
    });
    expect(profileCount).toBe(0);
  });

  it('rejects missing or invalid official structured fiscal address fields', async () => {
    const fixture = await createFiscalTenantFixture(context);

    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      province: undefined,
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      canton: undefined,
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      district: undefined,
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      province: '0',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      province: '10',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      canton: '00',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      canton: '1',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      district: '00',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      district: '1',
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      otrasSenas: undefined,
    });
    await expectFiscalProfileAddressRejected(context, fixture.jwtToken, fixture.companyId, {
      otrasSenas: 'abc',
    });

    const profileCount = await context.prisma.companyFiscalProfile.count({
      where: { companyId: fixture.companyId },
    });
    expect(profileCount).toBe(0);
  });

  it('emits fiscal audit events for create and update', async () => {
    const fixture = await createFiscalTenantFixture(context);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send(validFiscalProfilePayload)
      .expect(200);

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ ...validFiscalProfilePayload, economicActivityCode: '722001' })
      .expect(200);

    await expectFiscalProfileAuditCount(context, fixture.tenantId, fixture.companyId, 2);
  });
});

async function expectFiscalProfileAddressRejected(
  context: FiscalE2eContext,
  jwtToken: string,
  companyId: string,
  override: Partial<typeof validFiscalProfilePayload>,
): Promise<void> {
  await request(context.app.getHttpServer())
    .put(`/api/v1/companies/${companyId}/fiscal-profile`)
    .set('Authorization', `Bearer ${jwtToken}`)
    .send({ ...validFiscalProfilePayload, ...override })
    .expect(400);
}

async function expectFiscalProfileAuditCount(
  context: FiscalE2eContext,
  tenantId: string,
  companyId: string,
  expectedCount: number,
): Promise<void> {
  let auditCount = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    auditCount = await context.prisma.auditLog.count({
      where: {
        tenantId,
        companyId,
        action: 'company-fiscal-profile.upserted',
        eventClass: 'FISCAL_AUDIT',
      },
    });
    if (auditCount === expectedCount) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(auditCount).toBe(expectedCount);
}
