import * as request from 'supertest';
import { randomUUID } from 'crypto';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  fiscalTicketPayload,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany } from '../../helpers/test-factories';

function successfulBodies(
  results: PromiseSettledResult<request.Response>[],
): Array<Record<string, unknown>> {
  return results
    .filter(
      (result): result is PromiseFulfilledResult<request.Response> =>
        result.status === 'fulfilled' && result.value.status < 400,
    )
    .map((result) => result.value.body as Record<string, unknown>);
}

describe('Fiscal Concurrency (E2E, PostgreSQL)', () => {
  let context: FiscalE2eContext;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
  });

  afterAll(async () => {
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('CONC-001 allocates concurrent same-scope requests without duplicate sequence, consecutive or Clave', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        request(context.app.getHttpServer())
          .post('/api/v1/invoices')
          .set('X-API-Key', apiKey.secret)
          .set('Idempotency-Key', `conc-001-${index}`)
          .send(fiscalInvoicePayload(fixture.companyId)),
      ),
    );
    const bodies = successfulBodies(results);
    expect(bodies).toHaveLength(12);
    expect(new Set(bodies.map((body) => body.sequenceValue)).size).toBe(12);
    expect(new Set(bodies.map((body) => body.consecutive)).size).toBe(12);
    expect(new Set(bodies.map((body) => body.clave)).size).toBe(12);

    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });
    expect(sequence.lastAssigned?.toString()).toBe('12');
    expect(sequence.nextValue.toString()).toBe('13');
  });

  it('CONC-002 creates exactly one document and consumes one sequence for identical concurrent idempotent requests', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);
    const payload = fiscalInvoicePayload(fixture.companyId);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        request(context.app.getHttpServer())
          .post('/api/v1/invoices')
          .set('X-API-Key', apiKey.secret)
          .set('Idempotency-Key', 'conc-002-same')
          .send(payload),
      ),
    );
    const bodies = successfulBodies(results);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);

    const documentCount = await context.prisma.fiscalDocument.count({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        idempotencyKey: 'conc-002-same',
      },
    });
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });
    expect(documentCount).toBe(1);
    expect(sequence.lastAssigned?.toString()).toBe('1');
    expect(sequence.nextValue.toString()).toBe('2');
  });

  it('CONC-003 conflicts same canonical key with different payload without duplicate issuance', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);
    const changedPayload = fiscalInvoicePayload(fixture.companyId);
    changedPayload.lines[0].unitPrice = '2000.00000';

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', 'conc-003-conflict')
        .send(fiscalInvoicePayload(fixture.companyId)),
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', 'conc-003-conflict')
        .send(changedPayload),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
    const documentCount = await context.prisma.fiscalDocument.count({
      where: {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        idempotencyKey: 'conc-003-conflict',
      },
    });
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });
    expect(documentCount).toBe(1);
    expect(sequence.nextValue.toString()).toBe('2');
  });

  it('CONC-004 allows Company A and Company B to share the same consecutive with different Claves', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const companyB = await createTestCompany(context.prisma, fixture.tenantId);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, companyB.id);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${companyB.id}/fiscal/SANDBOX/issuance-points/default`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ name: 'Company B default point' })
      .expect(200);
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${companyB.id}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ nextValue: '1' })
      .expect(200);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, companyB.id);

    const [companyAResponse, companyBResponse] = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', 'conc-004-a')
        .send(fiscalInvoicePayload(fixture.companyId)),
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', 'conc-004-b')
        .send(fiscalInvoicePayload(companyB.id)),
    ]);

    expect(companyAResponse.status).toBe(201);
    expect(companyBResponse.status).toBe(201);
    expect(companyAResponse.body.consecutive).toBe('00100001010000000001');
    expect(companyBResponse.body.consecutive).toBe('00100001010000000001');
    expect(companyAResponse.body.clave).not.toBe(companyBResponse.body.clave);
  });

  it('CONC-005 isolates SANDBOX and PRODUCTION sequences', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(
      context.prisma,
      fixture.tenantId,
      fixture.companyId,
      'SANDBOX',
    );
    await createEnabledHaciendaConnection(
      context.prisma,
      fixture.tenantId,
      fixture.companyId,
      'PRODUCTION',
    );
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE', 'SANDBOX');
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE', 'PRODUCTION');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const sandbox = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'conc-005-sandbox')
      .send(fiscalInvoicePayload(fixture.companyId, 'SANDBOX'))
      .expect(201);
    const production = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'conc-005-production')
      .send(fiscalInvoicePayload(fixture.companyId, 'PRODUCTION'))
      .expect(201);

    expect(sandbox.body.sequenceValue).toBe('1');
    expect(production.body.sequenceValue).toBe('1');
    expect(sandbox.body.environment).toBe('SANDBOX');
    expect(production.body.environment).toBe('PRODUCTION');
  });

  it('CONC-006 isolates INVOICE and TICKET sequences', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const invoice = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'conc-006-invoice')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);
    const ticket = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'conc-006-ticket')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);

    expect(invoice.body.sequenceValue).toBe('1');
    expect(ticket.body.sequenceValue).toBe('1');
    expect(invoice.body.consecutive).toContain('010000000001');
    expect(ticket.body.consecutive).toContain('040000000001');
  });

  it('CONC-007 prevents sequence initialization races from resetting or corrupting allocation', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/issuance-points/default`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ name: 'Race default point' })
      .expect(200);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const results = await Promise.allSettled([
      request(context.app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', `conc-007-${randomUUID()}`)
        .send(fiscalInvoicePayload(fixture.companyId)),
      request(context.app.getHttpServer())
        .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
        .set('Authorization', `Bearer ${fixture.jwtToken}`)
        .send({ nextValue: '1' }),
    ]);

    expect(successfulBodies(results).some((body) => body.status === 'READY_FOR_XML')).toBe(true);
    const documentCount = await context.prisma.fiscalDocument.count({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: 'INVOICE' },
    });
    const sequence = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, documentType: 'INVOICE' },
    });
    expect(documentCount).toBe(1);
    expect(sequence.lastAssigned?.toString()).toBe('1');
    expect(sequence.nextValue.toString()).toBe('2');

    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal/SANDBOX/sequences/INVOICE`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send({ nextValue: '1' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_SEQUENCE_ALREADY_STARTED'));
  });
});
