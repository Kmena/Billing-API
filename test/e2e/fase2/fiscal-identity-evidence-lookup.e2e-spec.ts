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
import {
  canonicalFiscalPayloadHash,
  FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
} from '../../../src/modules/fiscal-documents/application/fiscal-payload-equivalence';

const OPERATION = 'fiscal-document.create.invoice';

describe('Fiscal identity evidence lookup (E2E)', () => {
  let context: FiscalE2eContext;
  let fixture: FiscalTenantFixture;
  let writer: Awaited<ReturnType<typeof createFiscalApiKey>>;
  let reader: Awaited<ReturnType<typeof createFiscalApiKey>>;
  let documentId: string;
  let body: ReturnType<typeof evidenceBody>;
  const idempotencyKey = 'inventori:1:invoice:1890';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
    fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');

    writer = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    reader = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:read', 'tickets:read']);
    await authorizeApiKeyForCompany(context.prisma, writer.id, fixture.companyId);
    await authorizeApiKeyForCompany(context.prisma, reader.id, fixture.companyId);

    const payload = fiscalInvoicePayload(fixture.companyId);
    const created = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', writer.secret)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);
    documentId = created.body.id as string;
    body = evidenceBody(payload);
  });

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('recovers the completed identity through an authorized rotated read key without fiscal mutation', async () => {
    const before = await fiscalCounts();
    const response = await lookup(reader.secret, body).expect(200);
    const after = await fiscalCounts();

    expect(response.body).toMatchObject({
      fiscalDocumentId: documentId,
      companyId: fixture.companyId,
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      idempotencyKey,
      operation: OPERATION,
      equivalenceContractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
      fiscalPayloadEquivalent: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('requestHash');
    expect(JSON.stringify(response.body)).not.toContain('receiverSnapshot');
    expect(after).toEqual(before);
  });

  it('accepts the future canonical headers without changing the internal idempotency hash', async () => {
    const payload = fiscalInvoicePayload(fixture.companyId);
    const { companyId: _companyId, environment: _environment, ...fiscalPayload } = payload;
    const canonicalHash = canonicalFiscalPayloadHash(fiscalPayload);
    const beforeMismatch = await fiscalCounts();

    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', writer.secret)
      .set('Idempotency-Key', 'future-canonical-header-match')
      .set('X-Fiscal-Payload-Contract-Version', FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION)
      .set('X-Fiscal-Payload-Hash', canonicalHash)
      .send(payload)
      .expect(201);

    const [original, canonical] = await Promise.all([
      context.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: documentId }, select: { requestHash: true } }),
      context.prisma.fiscalDocument.findFirstOrThrow({
        where: { tenantId: fixture.tenantId, idempotencyKey: 'future-canonical-header-match' },
        select: { requestHash: true },
      }),
    ]);
    expect(canonical.requestHash).toBe(original.requestHash);

    await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', writer.secret)
      .set('Idempotency-Key', 'future-canonical-header-mismatch')
      .set('X-Fiscal-Payload-Contract-Version', FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION)
      .set('X-Fiscal-Payload-Hash', 'a'.repeat(64))
      .send(payload)
      .expect(400)
      .expect(({ body: response }) => expect(response.error.code).toBe('FISCAL_PAYLOAD_HASH_INVALID'));
    expect(await fiscalCounts()).toEqual({
      ...beforeMismatch,
      documents: beforeMismatch.documents + 1,
      reservations: beforeMismatch.reservations + 1,
    });
  });
  it('returns safe not-found for mismatched historical fiscal evidence', async () => {
    const changed = {
      ...body,
      fiscalPayload: {
        ...body.fiscalPayload,
        lines: [{ ...body.fiscalPayload.lines[0], quantity: '2.00000' }],
      },
    };
    await lookup(reader.secret, changed)
      .expect(404)
      .expect(({ body: response }) => expect(response.error.code).toBe('FISCAL_IDENTITY_NOT_FOUND'));
  });

  it('fails closed for the wrong operation or environment', async () => {
    const ticket = { ...body, operation: 'fiscal-document.create.ticket' as const };
    await lookup(reader.secret, ticket).expect(404);

    const production = { ...body };
    await request(context.app.getHttpServer())
      .post(`/api/v1/companies/${fixture.companyId}/fiscal-documents/PRODUCTION/identity-by-fiscal-evidence`)
      .set('X-API-Key', reader.secret)
      .send(production)
      .expect(409);
  });

  it('rejects missing payload evidence before discovering a fiscal identity', async () => {
    await lookup(reader.secret, { ...body, fiscalPayload: undefined })
      .expect(400)
      .expect(({ body: response }) => expect(response.error.code).toBe('FISCAL_PAYLOAD_EVIDENCE_INVALID'));
  });

  it('does not disclose the identity across tenant boundaries', async () => {
    const other = await createFiscalTenantFixture(context);
    const otherReader = await createFiscalApiKey(context.prisma, other.tenantId, ['invoices:read']);
    await authorizeApiKeyForCompany(context.prisma, otherReader.id, fixture.companyId);

    await lookup(otherReader.secret, body)
      .expect(404)
      .expect(({ body: response }) => expect(response.error.code).toBe('FISCAL_IDENTITY_NOT_FOUND'));
  });

  it('handles concurrent read-only evidence lookups without fiscal mutation', async () => {
    const before = await fiscalCounts();
    const responses = await Promise.all(Array.from({ length: 6 }, () => lookup(reader.secret, body).expect(200)));
    const after = await fiscalCounts();
    expect(responses.every((response) => response.body.fiscalDocumentId === documentId)).toBe(true);
    expect(after).toEqual(before);
  });

  function evidenceBody(payload: ReturnType<typeof fiscalInvoicePayload>) {
    const { companyId: _companyId, environment: _environment, ...fiscalPayload } = payload;
    return {
      idempotencyKey,
      operation: OPERATION,
      equivalenceContractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
      fiscalPayload,
    };
  }

  function lookup(apiKey: string, requestBody: Record<string, unknown>) {
    return request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/identity-by-fiscal-evidence`,
      )
      .set('X-API-Key', apiKey)
      .send(requestBody);
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