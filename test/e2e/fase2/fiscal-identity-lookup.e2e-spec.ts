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

const LOOKUP_OPERATION = 'fiscal-document.create.invoice';

describe('Fiscal identity lookup (E2E)', () => {
  let context: FiscalE2eContext;
  let fixture: FiscalTenantFixture;
  let reader: Awaited<ReturnType<typeof createFiscalApiKey>>;
  let documentId: string;
  let requestHash: string;
  const idempotencyKey = 'identity-lookup-invoice';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
    fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');

    const writer = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    reader = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:read']);
    await authorizeApiKeyForCompany(context.prisma, writer.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, reader.id, fixture.companyId);

    const created = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', writer.secret)
      .set('Idempotency-Key', idempotencyKey)
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);
    documentId = created.body.id as string;

    const document = await context.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { requestHash: true },
    });
    requestHash = document.requestHash as string;
  });

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('discovers the original identity through a rotated read key without fiscal mutation', async () => {
    const countBefore = await fiscalCounts();
    const response = await lookup(reader.secret).expect(200);
    const countAfter = await fiscalCounts();

    expect(response.body).toEqual({
      fiscalDocumentId: documentId,
      companyId: fixture.companyId,
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      status: 'READY_FOR_XML',
      clave: expect.any(String),
      consecutive: expect.any(String),
      idempotencyKey,
      operation: LOOKUP_OPERATION,
      reservationStatus: 'COMPLETED',
      requestHashVerified: true,
    });
    expect(response.body).not.toHaveProperty('receiverSnapshot');
    expect(response.body).not.toHaveProperty('requestHash');
    expect(countAfter).toEqual(countBefore);
  });

  it('does not confirm a reservation when the original request hash is wrong', async () => {
    await request(context.app.getHttpServer())
      .get(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/identity-by-idempotency`,
      )
      .set('X-API-Key', reader.secret)
      .query({
        idempotencyKey,
        operation: LOOKUP_OPERATION,
        requestHash: 'b'.repeat(64),
      })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_IDENTITY_NOT_FOUND'));
  });
  it('denies a key without the invoice read scope', async () => {
    const noScope = await createFiscalApiKey(context.prisma, fixture.tenantId, ['tickets:read']);
    await authorizeApiKeyForCompany(context.prisma, noScope.id, fixture.companyId);

    await lookup(noScope.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));
  });

  it('does not disclose a match across tenant boundaries', async () => {
    const other = await createFiscalTenantFixture(context);
    const otherReader = await createFiscalApiKey(context.prisma, other.tenantId, ['invoices:read']);
    await authorizeApiKeyForCompany(context.prisma, otherReader.id, fixture.companyId);

    await lookup(otherReader.secret)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_IDENTITY_NOT_FOUND'));
  });

  function lookup(apiKey: string) {
    return request(context.app.getHttpServer())
      .get(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/identity-by-idempotency`,
      )
      .set('X-API-Key', apiKey)
      .query({
        idempotencyKey,
        operation: LOOKUP_OPERATION,
        requestHash: requestHash.toUpperCase(),
      });
  }

  async function fiscalCounts() {
    const [documents, reservations, submissions, deliveries] = await Promise.all([
      context.prisma.fiscalDocument.count({ where: { tenantId: fixture.tenantId } }),
      context.prisma.fiscalIdempotencyKey.count({ where: { tenantId: fixture.tenantId } }),
      context.prisma.fiscalSubmission.count({ where: { tenantId: fixture.tenantId } }),
      context.prisma.documentDelivery.count({ where: { tenantId: fixture.tenantId } }),
    ]);
    return { documents, reservations, submissions, deliveries };
  }
});
