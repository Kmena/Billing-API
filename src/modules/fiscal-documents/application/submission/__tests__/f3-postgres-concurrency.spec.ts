// eslint-disable-next-line no-restricted-imports
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SubmitFiscalDocumentService } from '../submit-fiscal-document.service';
import { FiscalSubmissionStateService } from '../fiscal-submission-state.service';

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const clave = '50601012500310112345600100001010000000001100000001';

async function seedReadyDocument(prisma: PrismaClient) {
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const pointId = randomUUID();
  const documentId = randomUUID();
  const apiKeyId = randomUUID();
  await prisma.tenant.create({
    data: { id: tenantId, name: `Tenant ${tenantId}`, slug: `t-${tenantId}` },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      tenantId,
      legalName: 'Concurrency Company',
      identificationType: 'JURIDICA',
      identificationNumber: tenantId.replace(/-/g, '').slice(0, 10),
      status: 'ACTIVE',
      haciendaVerificationStatus: 'VERIFIED',
    },
  });
  await prisma.apiKey.create({
    data: {
      id: apiKeyId,
      tenantId,
      name: 'Concurrency API key',
      keyPrefix: randomUUID().slice(0, 8),
      keyHash: 'hash',
      scopes: ['invoices:write'],
      status: 'ACTIVE',
    },
  });
  await prisma.apiKeyCompany.create({ data: { apiKeyId, companyId } });
  await prisma.haciendaConnection.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      environment: 'SANDBOX',
      status: 'CONNECTED',
      secretReference: 'secret-ref',
    },
  });
  await prisma.fiscalIssuancePoint.create({
    data: {
      id: pointId,
      tenantId,
      companyId,
      environment: 'SANDBOX',
      branchCode: '001',
      terminalCode: '00001',
      isDefault: true,
    },
  });
  await prisma.fiscalDocument.create({
    data: {
      id: documentId,
      tenantId,
      companyId,
      environment: 'SANDBOX',
      type: 'INVOICE',
      status: 'READY_TO_SUBMIT',
      issuancePointId: pointId,
      branchCode: '001',
      terminalCode: '00001',
      sequenceValue: 1,
      consecutive: '00100001010000000001',
      clave,
      securityCode: '12345678',
      issuerSnapshot: { identificationType: 'JURIDICA', identificationNumber: '3101123456' },
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [],
      totals: {},
    },
  });
  await prisma.fiscalXmlArtifact.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      fiscalDocumentId: documentId,
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      schemaVersion: '4.4',
      xmlProfileVersion: 'v4.4',
      signedXmlStorageKey: 'signed.xml',
      signedXmlSha256: 'a'.repeat(64),
      xsdValidationStatus: 'VALID',
    },
  });
  return { tenantId, companyId, documentId, apiKeyId };
}

describeIfDatabase('F3 PostgreSQL concurrency', () => {
  let prisma: PrismaClient;
  // Track tenant IDs created by this suite so teardown is SCOPED — never deletes
  // data belonging to other tenants/bootstrap state in the shared dev DB.
  const testTenantIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (testTenantIds.length === 0) {
      await prisma.$disconnect();
      return;
    }
    // SCOPED cleanup — only deletes rows belonging to tenants created by this test.
    // This prevents wiping bootstrap/shared data from the dev DB.
    const t = { tenantId: { in: testTenantIds } };
    // DeliveryAttempt has no tenantId — must be deleted via its documentDelivery FK
    await prisma.deliveryAttempt.deleteMany({
      where: { delivery: { tenantId: { in: testTenantIds } } },
    });
    await prisma.documentDelivery.deleteMany({ where: t });
    await prisma.fiscalArtifact.deleteMany({ where: t });
    await prisma.fiscalSubmission.deleteMany({ where: t });
    await prisma.fiscalXmlArtifact.deleteMany({ where: t });
    await prisma.fiscalSigningCertificate.deleteMany({ where: t });
    await prisma.companyEconomicActivity.deleteMany({ where: t }); // FK → company (P0)
    await prisma.companyFiscalProfile.deleteMany({ where: t });
    await prisma.companyPdfSettings.deleteMany({ where: t });
    await prisma.fiscalIdempotencyKey.deleteMany({ where: t });
    await prisma.fiscalDocument.deleteMany({ where: t });
    await prisma.fiscalIssuancePoint.deleteMany({ where: t });
    await prisma.fiscalSequence.deleteMany({ where: t });
    await prisma.haciendaConnection.deleteMany({ where: t });
    await prisma.apiKeyCompany.deleteMany({
      where: { apiKey: { tenantId: { in: testTenantIds } } },
    });
    await prisma.refreshToken.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.apiKey.deleteMany({ where: t });
    await prisma.user.deleteMany({ where: t });
    await prisma.company.deleteMany({ where: t });
    await prisma.tenant.deleteMany({ where: { id: { in: testTenantIds } } });
    await prisma.$disconnect();
  });

  it('creates exactly one FiscalSubmission for simultaneous submit commands', async () => {
    const fixture = await seedReadyDocument(prisma);
    testTenantIds.push(fixture.tenantId); // register for scoped teardown
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new SubmitFiscalDocumentService(
      prisma as never,
      { record: jest.fn() } as never,
      queue as never,
    );

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.execute({
          tenantId: fixture.tenantId,
          companyId: fixture.companyId,
          environment: 'SANDBOX',
          documentType: 'INVOICE',
          documentId: fixture.documentId,
          apiKeyId: fixture.apiKeyId,
          scopes: ['invoices:write'],
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(8);
    expect(
      await prisma.fiscalSubmission.count({ where: { fiscalDocumentId: fixture.documentId } }),
    ).toBe(1);
    expect(await prisma.fiscalDocument.count({ where: { clave } })).toBe(1);
  });

  it('prevents terminal regression and preserves response artifact association under stale races', async () => {
    const createdSubmission = await prisma.fiscalSubmission.findFirstOrThrow({ where: { clave } });
    const submission = await prisma.fiscalSubmission.update({
      where: { id: createdSubmission.id },
      data: { status: 'PROCESSING' },
    });
    const upload = jest.fn().mockResolvedValue('response.xml');
    const state = new FiscalSubmissionStateService(
      prisma as never,
      { record: jest.fn() } as never,
      { upload } as never,
      { ensureHaciendaResponseArtifact: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await Promise.all([
      state.applyProviderResult(submission.id, {
        kind: 'ACCEPTED',
        nextStatus: 'ACCEPTED',
        providerStatus: 'aceptado',
        responseArtifact: { content: Buffer.from('<ok/>'), contentType: 'application/xml' },
      }),
      state.applyProviderResult(submission.id, {
        kind: 'PROCESSING',
        nextStatus: 'PROCESSING',
        providerStatus: 'procesando',
      }),
    ]);

    const updated = await prisma.fiscalSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    const document = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: updated.fiscalDocumentId },
    });
    expect(updated.status).toBe('ACCEPTED');
    expect(document.status).toBe('ACCEPTED');
    expect(updated.responseSha256).toBeTruthy();
    expect(updated.responseStorageKey).toContain(clave);
  });
});
