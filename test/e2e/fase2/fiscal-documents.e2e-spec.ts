import * as request from 'supertest';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  expectSanitizedFiscalResponse,
  fiscalInvoicePayload,
  fiscalTicketPayload,
  validCompanyFiscalProfilePayload,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
describe('Fiscal Documents (E2E)', () => {
  let context: FiscalE2eContext;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  afterAll(async () => {
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('creates invoices and tickets at READY_FOR_XML with sanitized responses', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
      'invoices:read',
      'tickets:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const invoiceResponse = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'invoice-happy-path')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);

    expect(invoiceResponse.body.status).toBe('READY_FOR_XML');
    expect(invoiceResponse.body.type).toBe('INVOICE');
    expect(invoiceResponse.body.issuerSnapshot).toMatchObject({
      legalName: expect.any(String),
      identificationType: 'JURIDICA',
      codigoActividad: '620210',
      provincia: '1',
      canton: '01',
      distrito: '01',
      barrio: 'Carmen',
      otrasSenas: 'Avenida central, edificio fiscal, segundo piso',
      email: 'facturacion@example.co.cr',
    });
    expect(invoiceResponse.body.receiverSnapshot).toMatchObject({
      name: 'Receiver SA',
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
    });
    expectSanitizedFiscalResponse(invoiceResponse.body);

    const ticketResponse = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'ticket-happy-path')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);

    expect(ticketResponse.body.status).toBe('READY_FOR_XML');
    expect(ticketResponse.body.type).toBe('TICKET');
    expect(ticketResponse.body.issuerSnapshot).toMatchObject({
      codigoActividad: '620210',
      provincia: '1',
      canton: '01',
      distrito: '01',
      otrasSenas: 'Avenida central, edificio fiscal, segundo piso',
      email: 'facturacion@example.co.cr',
    });
    expect(ticketResponse.body.receiverSnapshot).toBeNull();
    expectSanitizedFiscalResponse(ticketResponse.body);
  });

  it('enforces fiscal create negative paths for scopes, company authorization, API key status and prerequisites', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');

    const missingScopeKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, missingScopeKey.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', missingScopeKey.secret)
      .set('Idempotency-Key', 'missing-scope')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));

    const unauthorizedCompanyKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
    ]);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', unauthorizedCompanyKey.secret)
      .set('Idempotency-Key', 'unauthorized-company')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_COMPANY_NOT_AUTHORIZED'));

    const revokedKey = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      ['invoices:write'],
      'REVOKED',
    );
    await authorizeApiKeyForCompany(context.prisma, revokedKey.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', revokedKey.secret)
      .set('Idempotency-Key', 'revoked-key')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_REVOKED'));

    const noHaciendaFixture = await createFiscalTenantFixture(context);
    await configureValidCompanyFiscalProfile(context, noHaciendaFixture);
    await configureDefaultFiscalSetup(context, noHaciendaFixture, 'INVOICE');
    const noHaciendaKey = await createFiscalApiKey(context.prisma, noHaciendaFixture.tenantId, [
      'invoices:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, noHaciendaKey.id, noHaciendaFixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', noHaciendaKey.secret)
      .set('Idempotency-Key', 'missing-hacienda')
      .send(fiscalInvoicePayload(noHaciendaFixture.companyId))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('HACIENDA_CONNECTION_REQUIRED'));

    const disabledFixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(
      context.prisma,
      disabledFixture.tenantId,
      disabledFixture.companyId,
      'SANDBOX',
      'DISABLED',
    );
    await configureValidCompanyFiscalProfile(context, disabledFixture);
    await configureDefaultFiscalSetup(context, disabledFixture, 'INVOICE');
    const disabledKey = await createFiscalApiKey(context.prisma, disabledFixture.tenantId, [
      'invoices:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, disabledKey.id, disabledFixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', disabledKey.secret)
      .set('Idempotency-Key', 'disabled-hacienda')
      .send(fiscalInvoicePayload(disabledFixture.companyId))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('HACIENDA_CONNECTION_REQUIRED'));

    const noPointFixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(
      context.prisma,
      noPointFixture.tenantId,
      noPointFixture.companyId,
    );
    await configureValidCompanyFiscalProfile(context, noPointFixture);
    const noPointKey = await createFiscalApiKey(context.prisma, noPointFixture.tenantId, [
      'invoices:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, noPointKey.id, noPointFixture.companyId);
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', noPointKey.secret)
      .set('Idempotency-Key', 'missing-issuance-point')
      .send(fiscalInvoicePayload(noPointFixture.companyId))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_ISSUANCE_POINT_REQUIRED'));
  });

  it('validates FE/TE receiver rules without fabricating receiver data', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const invoiceWithoutReceiverType = fiscalInvoicePayload(fixture.companyId);
    delete (invoiceWithoutReceiverType.receiver as Record<string, unknown>).identificationType;
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'invoice-missing-receiver-type')
      .send(invoiceWithoutReceiverType)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('RECEIVER_IDENTIFICATION_REQUIRED'));

    const ticketWithoutReceiver = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'ticket-without-receiver')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);
    expect(ticketWithoutReceiver.body.receiverSnapshot).toBeNull();

    const ticketWithIncompleteReceiver = fiscalTicketPayload(fixture.companyId) as ReturnType<
      typeof fiscalTicketPayload
    > & { receiver?: Record<string, unknown> };
    ticketWithIncompleteReceiver.receiver = {
      name: 'Receiver SA',
      identificationNumber: '3101000000',
    };
    await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'ticket-incomplete-receiver')
      .send(ticketWithIncompleteReceiver)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('RECEIVER_IDENTIFICATION_REQUIRED'));
  });

  it('rejects unsupported fiscal conditionals before READY_FOR_XML', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const taxablePayload = fiscalInvoicePayload(fixture.companyId) as ReturnType<
      typeof fiscalInvoicePayload
    > & { lines: Array<{ taxAmount?: string }> };
    taxablePayload.lines[0].taxAmount = '130.00000';
    delete (taxablePayload.lines[0] as { taxCode?: string }).taxCode;
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'unsupported-tax-metadata')
      .send(taxablePayload)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_TAX_METADATA_REQUIRED'));

    const discountPayload = fiscalInvoicePayload(fixture.companyId) as ReturnType<
      typeof fiscalInvoicePayload
    > & { lines: Array<{ discountAmount?: string }> };
    discountPayload.lines[0].discountAmount = '100.00000';
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'unsupported-discount-metadata')
      .send(discountPayload)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('UNSUPPORTED_FISCAL_DISCOUNT_METADATA'));

    const unsupportedUnitPayload = fiscalInvoicePayload(fixture.companyId);
    unsupportedUnitPayload.lines[0].unitMeasure = 'Kg';
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'unsupported-unit-measure')
      .send(unsupportedUnitPayload)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('UNSUPPORTED_FISCAL_UNIT_MEASURE'));

    const unsupportedSaleConditionPayload = fiscalInvoicePayload(fixture.companyId);
    unsupportedSaleConditionPayload.saleCondition = '02';
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'unsupported-sale-condition')
      .send(unsupportedSaleConditionPayload)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('UNSUPPORTED_FISCAL_SALE_CONDITION'));

    await expectDocumentAndSequenceCounts(fixture.tenantId, fixture.companyId, 'INVOICE', 0, '1');
  });

  it('rejects fiscal document creation before issuer fiscal profile readiness', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'missing-fiscal-profile')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_FISCAL_PROFILE_REQUIRED'));

    await expectDocumentAndSequenceCounts(fixture.tenantId, fixture.companyId, 'INVOICE', 0, '1');
  });

  it('enforces type-specific read scopes and rejects generic documents:read bypass', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const writerKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, writerKey.id, fixture.companyId);

    const invoice = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', writerKey.secret)
      .set('Idempotency-Key', 'read-scope-invoice')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);
    const ticket = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', writerKey.secret)
      .set('Idempotency-Key', 'read-scope-ticket')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);

    const invoiceReader = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:read',
    ]);
    const ticketReader = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'tickets:read',
    ]);
    const genericReader = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'documents:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, invoiceReader.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, ticketReader.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, genericReader.id, fixture.companyId);

    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${invoice.body.id}`)
      .set('X-API-Key', invoiceReader.secret)
      .expect(200)
      .expect(({ body }) => expectSanitizedFiscalResponse(body));
    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${ticket.body.id}`)
      .set('X-API-Key', ticketReader.secret)
      .expect(200)
      .expect(({ body }) => expectSanitizedFiscalResponse(body));

    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${invoice.body.id}`)
      .set('X-API-Key', ticketReader.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));
    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${ticket.body.id}`)
      .set('X-API-Key', invoiceReader.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));
    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${invoice.body.id}`)
      .set('X-API-Key', genericReader.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('INSUFFICIENT_SCOPE'));
  });

  it('preserves idempotent replay, conflict, operation scope and API-key scope behavior', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const apiKeyA = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    const apiKeyB = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKeyA.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, apiKeyB.id, fixture.companyId);

    const payload = fiscalInvoicePayload(fixture.companyId);
    const firstResponse = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKeyA.secret)
      .set('Idempotency-Key', 'idem-replay')
      .send(payload)
      .expect(201);
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({
        ...validCompanyFiscalProfilePayload(),
        economicActivityCode: '722001',
        email: 'replay-profile-b@example.co.cr',
      })
      .expect(200);

    const replayResponse = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKeyA.secret)
      .set('Idempotency-Key', 'idem-replay')
      .send(payload)
      .expect(201);

    expect(replayResponse.body.id).toBe(firstResponse.body.id);
    expect(replayResponse.body.consecutive).toBe(firstResponse.body.consecutive);
    expect(replayResponse.body.clave).toBe(firstResponse.body.clave);
    expect(replayResponse.body.issuerSnapshot.codigoActividad).toBe('620210');
    expect(replayResponse.body.issuerSnapshot.email).toBe('facturacion@example.co.cr');
    expectSanitizedFiscalResponse(replayResponse.body);
    await expectDocumentAndSequenceCounts(fixture.tenantId, fixture.companyId, 'INVOICE', 1, '2');

    const changedPayload = fiscalInvoicePayload(fixture.companyId);
    changedPayload.lines[0].unitPrice = '2000.00000';
    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKeyA.secret)
      .set('Idempotency-Key', 'idem-replay')
      .send(changedPayload)
      .expect(409)
      .expect(({ body }) =>
        expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'),
      );
    await expectDocumentAndSequenceCounts(fixture.tenantId, fixture.companyId, 'INVOICE', 1, '2');

    const ticketResponse = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKeyA.secret)
      .set('Idempotency-Key', 'idem-replay')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);
    expect(ticketResponse.body.type).toBe('TICKET');

    const apiKeyBResponse = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKeyB.secret)
      .set('Idempotency-Key', 'idem-replay')
      .send(payload)
      .expect(201);
    expect(apiKeyBResponse.body.id).not.toBe(firstResponse.body.id);
    expect(apiKeyBResponse.body.consecutive).not.toBe(firstResponse.body.consecutive);

    const sameTextualKeyDocumentCount = await context.prisma.fiscalDocument.count({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        idempotencyKey: 'idem-replay',
      },
    });
    expect(sameTextualKeyDocumentCount).toBe(3);
  });

  async function expectDocumentAndSequenceCounts(
    tenantId: string,
    companyId: string,
    documentType: 'INVOICE' | 'TICKET',
    documentCount: number,
    nextValue: string,
  ): Promise<void> {
    await expect(
      context.prisma.fiscalDocument.count({ where: { tenantId, companyId, type: documentType } }),
    ).resolves.toBe(documentCount);
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId, companyId, documentType },
    });
    expect(sequence.nextValue.toString()).toBe(nextValue);
  }

  it('prevents cross-tenant fiscal writes and reads without data leakage', async () => {
    const tenantA = await createFiscalTenantFixture(context);
    const tenantB = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, tenantB.tenantId, tenantB.companyId);
    await configureValidCompanyFiscalProfile(context, tenantB);
    await configureDefaultFiscalSetup(context, tenantB, 'INVOICE');
    const keyA = await createFiscalApiKey(context.prisma, tenantA.tenantId, [
      'invoices:write',
      'invoices:read',
    ]);
    const keyB = await createFiscalApiKey(context.prisma, tenantB.tenantId, [
      'invoices:write',
      'invoices:read',
    ]);
    await authorizeApiKeyForCompany(context.prisma, keyB.id, tenantB.companyId);

    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', keyA.secret)
      .set('Idempotency-Key', 'cross-tenant-write')
      .send(fiscalInvoicePayload(tenantB.companyId))
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));

    const tenantBDocument = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', keyB.secret)
      .set('Idempotency-Key', 'tenant-b-document')
      .send(fiscalInvoicePayload(tenantB.companyId))
      .expect(201);

    await request(context.app.getHttpServer())
      .get(`/api/v1/fiscal-documents/${tenantBDocument.body.id}`)
      .set('X-API-Key', keyA.secret)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_DOCUMENT_NOT_FOUND'));
  });
});
