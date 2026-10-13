import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FiscalTestInvoiceV1Service } from './fiscal-test-invoice-v1.service';

describe('FiscalTestInvoiceV1Service', () => {
  const document = {
    id: '30000000-0000-4000-8000-000000000001',
    clave: '5'.repeat(50),
    consecutive: '00100001010000000001',
    status: 'READY_TO_SUBMIT',
    createdAt: new Date('2026-10-12T00:00:00Z'),
    updatedAt: new Date('2026-10-12T00:00:01Z'),
    xmlArtifacts: [
      {
        unsignedXmlSha256: 'a'.repeat(64),
        signedXmlSha256: 'b'.repeat(64),
        xsdValidationStatus: 'VALID',
        signedAt: new Date('2026-10-12T00:00:01Z'),
        signatureVerifiedAt: new Date('2026-10-12T00:00:01Z'),
      },
    ],
    submission: {
      id: '40000000-0000-4000-8000-000000000001',
      status: 'QUEUED',
      attemptCount: 0,
      reconciliationAttemptCount: 0,
      nextAttemptAt: null,
      acceptedAt: null,
      rejectedAt: null,
      lastNormalizedErrorCode: null,
      lastSanitizedErrorMessage: null,
      lastProviderStatus: null,
      responseSha256: null,
      responseContentType: null,
      responseReceivedAt: null,
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: { $executeRaw: jest.Mock }) => unknown) =>
      callback({ $executeRaw: jest.fn() }),
    ),
    fiscalDocument: { findFirst: jest.fn().mockResolvedValue(document) },
  };
  const audit = { record: jest.fn() };
  const documents = {
    createDocument: jest.fn().mockResolvedValue({ id: document.id, status: 'READY_FOR_XML' }),
  };
  const prepareXml = { execute: jest.fn().mockResolvedValue({}) };
  const submitDocument = { execute: jest.fn().mockResolvedValue({ status: 'QUEUED' }) };
  const artifacts = { listArtifacts: jest.fn().mockResolvedValue([]) };
  const deliveries = { listDeliveries: jest.fn().mockResolvedValue([]) };
  const readiness = {
    evaluate: jest.fn().mockResolvedValue({ readyToIssue: true, reasonCodes: [] }),
  };
  const service = new FiscalTestInvoiceV1Service(
    prisma as never,
    audit as never,
    documents as never,
    prepareXml as never,
    submitDocument as never,
    artifacts as never,
    deliveries as never,
    readiness as never,
  );
  const access = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    companyId: '20000000-0000-4000-8000-000000000001',
    environment: 'SANDBOX' as const,
    apiKeyId: '50000000-0000-4000-8000-000000000001',
    apiKeyEnvironment: 'TEST' as const,
    scopes: ['invoices:write', 'invoices:read'],
    actor: 'apikey:synthetic',
  };
  const dto = {
    mode: 'HACIENDA_SANDBOX_SUBMISSION' as const,
    confirmation: 'CONSUME_SANDBOX_CONSECUTIVE' as const,
    receiver: { name: 'Synthetic Receiver' },
    currency: 'CRC',
    saleCondition: '01',
    paymentMethod: '01',
    lines: [
      {
        lineNumber: 1,
        cabysCode: '1234567890123',
        description: 'Test',
        unitMeasure: 'Sp',
        quantity: '1.00000',
        unitPrice: '1000.00000',
      },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  it('hard-denies production before any mutation', async () => {
    await expect(
      service.initiate(
        { ...access, environment: 'PRODUCTION', apiKeyEnvironment: 'LIVE' },
        randomUUID(),
        dto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documents.createDocument).not.toHaveBeenCalled();
  });

  it('serializes by advisory lock and reuses the existing fiscal pipeline', async () => {
    const token = randomUUID();
    const result = await service.initiate(access, token, dto);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(readiness.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'SANDBOX' }),
    );
    expect(documents.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'SANDBOX',
        idempotencyKey: `fiscal-test:v1:${token}`,
      }),
    );
    expect(prepareXml.execute).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: document.id }),
    );
    expect(submitDocument.execute).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: document.id, environment: 'SANDBOX' }),
    );
    expect(result.submission?.haciendaAccepted).toBe(false);
    expect(result.disclosure.consumesSandboxConsecutive).toBe(true);
  });

  it('does not expose non-test fiscal documents through the status facade', async () => {
    prisma.fiscalDocument.findFirst.mockResolvedValueOnce(null);
    await expect(service.status(access, document.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.fiscalDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ idempotencyKey: { startsWith: 'fiscal-test:v1:' } }),
      }),
    );
  });

  it('returns canonical status on replay without preparing or submitting again', async () => {
    documents.createDocument.mockResolvedValueOnce({
      id: document.id,
      status: 'READY_TO_SUBMIT',
    });

    const result = await service.initiate(access, randomUUID(), dto);

    expect(result.executionId).toBe(document.id);
    expect(prepareXml.execute).not.toHaveBeenCalled();
    expect(submitDocument.execute).not.toHaveBeenCalled();
  });

  it('fails closed on missing scope before any database work', async () => {
    await expect(
      service.initiate({ ...access, scopes: ['invoices:read'] }, randomUUID(), dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allocate when canonical readiness is blocked', async () => {
    readiness.evaluate.mockResolvedValueOnce({
      readyToIssue: false,
      reasonCodes: ['ACTIVE_CERTIFICATE_MISSING'],
    });
    await expect(service.initiate(access, randomUUID(), dto)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FISCAL_TEST_INVOICE_NOT_READY' }),
    });
    expect(documents.createDocument).not.toHaveBeenCalled();
  });
});
