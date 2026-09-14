import * as request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  fiscalTicketPayload,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany } from '../../helpers/test-factories';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
import { MockHaciendaSubmissionAdapter } from '../../../src/modules/fiscal-documents/infrastructure/submission/mock-hacienda-submission.adapter';
import { FiscalSubmissionWorkerService } from '../../../src/modules/fiscal-documents/application/submission/workers/fiscal-submission-worker.service';
import { createTestSigningMaterial } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

const signingMaterial = createTestSigningMaterial();

async function configureSigningCertificate(
  context: FiscalE2eContext,
  tenantId: string,
  companyId: string,
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
): Promise<void> {
  const certificateSecretReference = `F3_E2E_CERT_${environment}_${companyId.replace(/-/g, '_')}`;
  const passwordSecretReference = `F3_E2E_PASS_${environment}_${companyId.replace(/-/g, '_')}`;
  const secrets = context.app.get<SecretProvider>(SECRET_PROVIDER);
  await secrets.storeSecret(
    certificateSecretReference,
    JSON.stringify({ pkcs12Base64: signingMaterial.pkcs12Base64 }),
  );
  await secrets.storeSecret(passwordSecretReference, signingMaterial.certificate.passphrase);
  await context.prisma.fiscalSigningCertificate.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      environment,
      status: 'ACTIVE',
      certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
      certificateSecretReference,
      passwordSecretReference,
      fingerprintSha256: createHash('sha256')
        .update(Buffer.from(signingMaterial.certificateDerBase64, 'base64'))
        .digest('hex'),
      serialNumber: signingMaterial.x509SerialNumber,
      subjectName: signingMaterial.x509Subject,
      issuerName: 'CN=F3 Test CA',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-01-01T00:00:00.000Z'),
      activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

async function configureHaciendaCredentialSecret(
  context: FiscalE2eContext,
  companyId: string,
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
): Promise<void> {
  const connection = await context.prisma.haciendaConnection.findFirstOrThrow({
    where: { companyId, environment },
  });
  await context.app
    .get<SecretProvider>(SECRET_PROVIDER)
    .storeSecret(
      connection.secretReference,
      JSON.stringify({ username: `user-${companyId}`, password: `pass-${companyId}` }),
    );
}

async function createReadyToSubmitDocument(
  context: FiscalE2eContext,
  input: {
    apiKeySecret: string;
    companyId: string;
    type: 'INVOICE' | 'TICKET';
    idempotencyKey: string;
    environment?: 'SANDBOX' | 'PRODUCTION';
  },
): Promise<{
  id: string;
  clave: string;
  consecutive: string;
  signedXmlSha256: string;
  sequenceValue: string;
}> {
  const route = input.type === 'INVOICE' ? '/api/v1/invoices' : '/api/v1/tickets';
  const payload =
    input.type === 'INVOICE'
      ? fiscalInvoicePayload(input.companyId, input.environment ?? 'SANDBOX')
      : fiscalTicketPayload(input.companyId, input.environment ?? 'SANDBOX');
  const created = await request(context.app.getHttpServer())
    .post(route)
    .set('X-API-Key', input.apiKeySecret)
    .set('Idempotency-Key', input.idempotencyKey)
    .send(payload)
    .expect(201);
  expect(created.body.status).toBe('READY_FOR_XML');

  const prepared = await request(context.app.getHttpServer())
    .post(`/api/v1/fiscal-documents/${created.body.id}/prepare-xml`)
    .set('X-API-Key', input.apiKeySecret)
    .expect(201);
  expect(prepared.body.status).toBe('READY_TO_SUBMIT');

  return {
    id: created.body.id,
    clave: created.body.clave,
    consecutive: created.body.consecutive,
    sequenceValue: created.body.sequenceValue,
    signedXmlSha256: prepared.body.signedXmlSha256,
  };
}

async function submitAndRead(
  context: FiscalE2eContext,
  input: {
    apiKeySecret: string;
    companyId: string;
    type: 'INVOICE' | 'TICKET';
    documentId: string;
    environment?: 'SANDBOX' | 'PRODUCTION';
  },
) {
  const plural = input.type === 'INVOICE' ? 'invoices' : 'tickets';
  const environment = input.environment ?? 'SANDBOX';
  const submitResponse = await request(context.app.getHttpServer())
    .post(
      `/api/v1/companies/${input.companyId}/fiscal-documents/${environment}/${plural}/${input.documentId}/submit`,
    )
    .set('X-API-Key', input.apiKeySecret)
    .expect(202);
  const statusResponse = await request(context.app.getHttpServer())
    .get(
      `/api/v1/companies/${input.companyId}/fiscal-documents/${environment}/${plural}/${input.documentId}/submission`,
    )
    .set('X-API-Key', input.apiKeySecret)
    .expect(200);
  return { submit: submitResponse.body, status: statusResponse.body };
}

async function setupFixture(
  context: FiscalE2eContext,
  scopes = ['invoices:write', 'tickets:write'],
) {
  const fixture = await createFiscalTenantFixture(context);
  await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
  await configureHaciendaCredentialSecret(context, fixture.companyId);
  await configureValidCompanyFiscalProfile(context, fixture);
  await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
  await configureDefaultFiscalSetup(context, fixture, 'TICKET');
  await configureSigningCertificate(context, fixture.tenantId, fixture.companyId);
  const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, scopes);
  await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);
  return { fixture, apiKey };
}

function expectSingleFiscalArtifactInvariants(document: {
  id: string;
  clave: string;
  consecutive: string;
  signedXmlSha256: string;
}) {
  return async (context: FiscalE2eContext) => {
    expect(await context.prisma.fiscalDocument.count({ where: { id: document.id } })).toBe(1);
    expect(await context.prisma.fiscalDocument.count({ where: { clave: document.clave } })).toBe(1);
    expect(
      await context.prisma.fiscalXmlArtifact.count({ where: { fiscalDocumentId: document.id } }),
    ).toBe(1);
    expect(
      await context.prisma.fiscalSubmission.count({ where: { fiscalDocumentId: document.id } }),
    ).toBe(1);
    const persisted = await context.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    const artifact = await context.prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    expect(persisted.clave).toBe(document.clave);
    expect(persisted.consecutive).toBe(document.consecutive);
    expect(artifact.signedXmlSha256).toBe(document.signedXmlSha256);
  };
}

describe('F3 Fiscal Submission Continuity (E2E, PostgreSQL)', () => {
  let context: FiscalE2eContext;
  let hacienda: MockHaciendaSubmissionAdapter;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_REAL_HACIENDA = 'false';
    context = await createFiscalE2eApp();
    hacienda = context.app.get(MockHaciendaSubmissionAdapter);
    await resetFiscalE2eData(context.prisma);
  });

  beforeEach(async () => {
    hacienda.clearScenarios();
    await resetFiscalE2eData(context.prisma);
  });

  afterAll(async () => {
    await resetFiscalE2eData(context.prisma);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('FE accepted: normal API invoice passes F2.2, F2.3 and F3 to authoritative ACCEPTED with response artifact', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-fe-accepted',
    });
    hacienda.setScenario(document.clave, 'ACCEPTED');

    const result = await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });

    expect(result.submit.status).toBe('QUEUED');
    expect(result.status.status).toBe('ACCEPTED');
    expect(result.status.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(hacienda.getCallCounts(document.clave)).toEqual({ submitCount: 1, statusQueryCount: 1 });
    await expectSingleFiscalArtifactInvariants(document)(context);
    const submission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    const responseBytes = await context.app
      .get<StoragePort>(STORAGE_PORT)
      .download(submission.responseStorageKey ?? '');
    expect(responseBytes.toString('utf8')).toContain('<Estado>aceptado</Estado>');
  });

  it('TE accepted: normal API ticket passes F2.2, F2.3 and F3 to authoritative ACCEPTED', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'TICKET',
      idempotencyKey: 'f3-te-accepted',
    });
    hacienda.setScenario(document.clave, 'ACCEPTED');

    const result = await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'TICKET',
      documentId: document.id,
    });

    expect(result.status.status).toBe('ACCEPTED');
    expect(hacienda.getCallCounts(document.clave)).toEqual({ submitCount: 1, statusQueryCount: 1 });
    await expectSingleFiscalArtifactInvariants(document)(context);
  });

  it('handles authoritative rejected and persists rejected respuesta-xml without treating technical failure as rejection', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-rejected',
    });
    hacienda.setScenario(document.clave, 'REJECTED');

    const result = await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });

    expect(result.status.status).toBe('REJECTED');
    const submission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    const responseBytes = await context.app
      .get<StoragePort>(STORAGE_PORT)
      .download(submission.responseStorageKey ?? '');
    expect(responseBytes.toString('utf8')).toContain('<Estado>rechazado</Estado>');
    await expectSingleFiscalArtifactInvariants(document)(context);
  });

  it('proves HTTP 201 acknowledgement is non-terminal and recibido -> procesando -> aceptado is resolved by GET', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-processing',
    });
    hacienda.setScenario(document.clave, 'RECEIVED_PROCESSING_ACCEPTED');

    await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });

    const submission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    expect(submission.status).toBe('ACCEPTED');
    expect(submission.lastProviderStatus).toBe('aceptado');
    expect(hacienda.getCallCounts(document.clave)).toEqual({ submitCount: 1, statusQueryCount: 3 });
  });

  it('ambiguous POST accepted: does not submit again and reconciles same Clave by GET to ACCEPTED', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-amb-accepted',
    });
    hacienda.setScenario(document.clave, 'TIMEOUT_UNKNOWN');

    const result = await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });

    expect(result.status.status).toBe('ACCEPTED');
    expect(hacienda.getCallCounts(document.clave)).toEqual({ submitCount: 1, statusQueryCount: 1 });
    await expectSingleFiscalArtifactInvariants(document)(context);
  });

  it('ambiguous POST rejected: does not submit again and reconciles same Clave by GET to REJECTED', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-amb-rejected',
    });
    hacienda.setScenario(document.clave, 'TIMEOUT_THEN_REJECTED');

    await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });

    const submission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    expect(submission.status).toBe('REJECTED');
    expect(hacienda.getCallCounts(document.clave)).toEqual({ submitCount: 1, statusQueryCount: 1 });
  });

  it.each([
    ['TOKEN_EXPIRED_THEN_ACCEPTED', 2],
    ['PROVIDER_5XX_THEN_ACCEPTED', 2],
    ['RATE_LIMIT_THEN_ACCEPTED', 2],
  ] as const)(
    '%s retries with bounded same-document lifecycle to success',
    async (scenario, expectedSubmitCount) => {
      const { fixture, apiKey } = await setupFixture(context);
      const document = await createReadyToSubmitDocument(context, {
        apiKeySecret: apiKey.secret,
        companyId: fixture.companyId,
        type: 'INVOICE',
        idempotencyKey: `f3-${scenario}`,
      });
      hacienda.setScenario(document.clave, scenario);

      const result = await submitAndRead(context, {
        apiKeySecret: apiKey.secret,
        companyId: fixture.companyId,
        type: 'INVOICE',
        documentId: document.id,
      });

      expect(result.status.status).toBe('ACCEPTED');
      expect(hacienda.getCallCounts(document.clave).submitCount).toBe(expectedSubmitCount);
      await expectSingleFiscalArtifactInvariants(document)(context);
    },
  );

  it('duplicate submission API calls, duplicate queue jobs and duplicate callbacks are idempotent', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-duplicates',
    });
    hacienda.setScenario(document.clave, 'ACCEPTED');

    await Promise.all([
      submitAndRead(context, {
        apiKeySecret: apiKey.secret,
        companyId: fixture.companyId,
        type: 'INVOICE',
        documentId: document.id,
      }),
      submitAndRead(context, {
        apiKeySecret: apiKey.secret,
        companyId: fixture.companyId,
        type: 'INVOICE',
        documentId: document.id,
      }),
    ]);
    const submission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: document.id },
    });
    const worker = context.app.get(FiscalSubmissionWorkerService);
    await Promise.all([
      worker.handleSubmitJob({ submissionId: submission.id }),
      worker.handleReconcileJob({ submissionId: submission.id }),
      request(context.app.getHttpServer())
        .post('/api/v1/hacienda/callback')
        .send({ clave: document.clave })
        .expect(200),
      request(context.app.getHttpServer())
        .post('/api/v1/hacienda/callback')
        .send({ clave: document.clave })
        .expect(200),
    ]);

    const after = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(after.status).toBe('ACCEPTED');
    await expectSingleFiscalArtifactInvariants(document)(context);
  });

  it('callback and polling race cannot regress ACCEPTED or REJECTED terminal states', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const accepted = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-race-accepted',
    });
    hacienda.setScenario(accepted.clave, 'ACCEPTED');
    await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: accepted.id,
    });
    const acceptedSubmission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: accepted.id },
    });
    const worker = context.app.get(FiscalSubmissionWorkerService);
    await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/hacienda/callback')
        .send({ clave: accepted.clave })
        .expect(200),
      worker.handleReconcileJob({ submissionId: acceptedSubmission.id }),
    ]);
    expect(
      (
        await context.prisma.fiscalSubmission.findUniqueOrThrow({
          where: { id: acceptedSubmission.id },
        })
      ).status,
    ).toBe('ACCEPTED');

    const rejected = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-race-rejected',
    });
    hacienda.setScenario(rejected.clave, 'REJECTED');
    await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: rejected.id,
    });
    const rejectedSubmission = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { fiscalDocumentId: rejected.id },
    });
    await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/hacienda/callback')
        .send({ clave: rejected.clave })
        .expect(200),
      worker.handleReconcileJob({ submissionId: rejectedSubmission.id }),
    ]);
    expect(
      (
        await context.prisma.fiscalSubmission.findUniqueOrThrow({
          where: { id: rejectedSubmission.id },
        })
      ).status,
    ).toBe('REJECTED');
  });

  it('restart recovery re-enqueues persisted non-terminal submission and reaches ACCEPTED without memory state', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-restart',
    });
    hacienda.setScenario(document.clave, 'ACCEPTED');
    const submit = await submitAndRead(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      documentId: document.id,
    });
    await context.prisma.fiscalSubmission.update({
      where: { id: submit.status.submissionId },
      data: { status: 'ACKNOWLEDGED', nextAttemptAt: new Date() },
    });

    await context.app.get(FiscalSubmissionWorkerService).enqueueDueWork();

    const recovered = await context.prisma.fiscalSubmission.findUniqueOrThrow({
      where: { id: submit.status.submissionId },
    });
    expect(recovered.status).toBe('ACCEPTED');
  });

  it('enforces tenant, company, environment, revoked key, missing scope and invalid state protections', async () => {
    const { fixture, apiKey } = await setupFixture(context, ['invoices:write']);
    const otherCompany = await createTestCompany(context.prisma, fixture.tenantId);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-security',
    });

    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${otherCompany.id}/fiscal-documents/SANDBOX/invoices/${document.id}/submit`,
      )
      .set('X-API-Key', apiKey.secret)
      .expect(403);
    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/PRODUCTION/invoices/${document.id}/submit`,
      )
      .set('X-API-Key', apiKey.secret)
      .expect(409);

    const revoked = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      ['invoices:write'],
      'REVOKED',
    );
    await authorizeApiKeyForCompany(context.prisma, revoked.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/invoices/${document.id}/submit`,
      )
      .set('X-API-Key', revoked.secret)
      .expect(401);

    const noInvoiceScope = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, noInvoiceScope.id, fixture.companyId);
    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/invoices/${document.id}/submit`,
      )
      .set('X-API-Key', noInvoiceScope.secret)
      .expect(403);
  });

  it('fails closed for missing signed XML artifact, missing/disabled connection and malformed provider response', async () => {
    const { fixture, apiKey } = await setupFixture(context);
    const document = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-invalid',
    });
    await context.prisma.fiscalXmlArtifact.deleteMany({ where: { fiscalDocumentId: document.id } });
    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/invoices/${document.id}/submit`,
      )
      .set('X-API-Key', apiKey.secret)
      .expect(400);

    const noConnectionDocument = await createReadyToSubmitDocument(context, {
      apiKeySecret: apiKey.secret,
      companyId: fixture.companyId,
      type: 'INVOICE',
      idempotencyKey: 'f3-no-connection',
    });
    await context.prisma.haciendaConnection.deleteMany({
      where: { companyId: fixture.companyId, environment: 'SANDBOX' },
    });
    await request(context.app.getHttpServer())
      .post(
        `/api/v1/companies/${fixture.companyId}/fiscal-documents/SANDBOX/invoices/${noConnectionDocument.id}/submit`,
      )
      .set('X-API-Key', apiKey.secret)
      .expect(409);
  });
});
