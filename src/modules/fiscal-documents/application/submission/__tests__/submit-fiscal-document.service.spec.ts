import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SubmitFiscalDocumentService } from '../submit-fiscal-document.service';

const readyDocument = {
  id: 'document-id',
  tenantId: 'tenant-id',
  companyId: 'company-id',
  environment: 'SANDBOX' as const,
  type: 'INVOICE' as const,
  status: 'READY_TO_SUBMIT',
  clave: '50601012500310112345600100001010000000001100000001',
  xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'a'.repeat(64) }],
  submission: null,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const submission = {
    id: 'submission-id',
    fiscalDocumentId: readyDocument.id,
    clave: readyDocument.clave,
    environment: readyDocument.environment,
    status: 'QUEUED',
    attemptCount: 0,
    reconciliationAttemptCount: 0,
    nextAttemptAt: new Date('2025-01-01T00:00:00.000Z'),
    acceptedAt: null,
    rejectedAt: null,
    lastNormalizedErrorCode: null,
    lastSanitizedErrorMessage: null,
    lastProviderStatus: null,
    responseSha256: null,
    responseContentType: null,
    responseReceivedAt: null,
  };
  const prisma = {
    apiKeyCompany: {
      findUnique: jest.fn().mockResolvedValue({ apiKeyId: 'api-key-id', companyId: 'company-id' }),
    },
    haciendaConnection: {
      findFirst: jest.fn().mockResolvedValue({ id: 'connection-id', status: 'CONNECTED' }),
    },
    fiscalDocument: { findFirst: jest.fn().mockResolvedValue(readyDocument) },
    fiscalSubmission: {
      create: jest.fn().mockResolvedValue({ ...submission, status: 'REQUESTED' }),
      update: jest.fn().mockResolvedValue(submission),
      findUnique: jest.fn().mockResolvedValue(submission),
      findUniqueOrThrow: jest.fn().mockResolvedValue(submission),
    },
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const queue = { publish: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new SubmitFiscalDocumentService(prisma as never, audit as never, queue as never),
    prisma,
    audit,
    queue,
  };
}

function input(overrides = {}) {
  return {
    tenantId: 'tenant-id',
    companyId: 'company-id',
    environment: 'SANDBOX' as const,
    documentType: 'INVOICE' as const,
    documentId: 'document-id',
    apiKeyId: 'api-key-id',
    scopes: ['invoices:write'],
    actor: 'apiKey:test',
    ...overrides,
  };
}

describe('SubmitFiscalDocumentService', () => {
  it('creates/reuses a durable submission and enqueues identifiers only', async () => {
    const { service, prisma, queue } = makeService();

    await expect(service.execute(input())).resolves.toMatchObject({
      documentId: 'document-id',
      submissionId: 'submission-id',
      status: 'QUEUED',
    });

    expect(prisma.fiscalSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fiscalDocumentId: 'document-id',
          clave: readyDocument.clave,
          signedXmlStorageKey: 'signed.xml',
          signedXmlSha256: 'a'.repeat(64),
        }),
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.any(Object),
    );
  });

  it('denies invoice submission without invoice scope', async () => {
    const { service } = makeService();
    await expect(service.execute(input({ scopes: ['tickets:write'] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies company isolation failures before state changes', async () => {
    const { service, prisma, queue } = makeService({
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.execute(input())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fiscalSubmission.create).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('requires enabled HaciendaConnection in the same environment', async () => {
    const { service, prisma, queue } = makeService({
      haciendaConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.execute(input())).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.haciendaConnection.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ environment: 'SANDBOX', status: 'CONNECTED' }),
    });
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('rejects invalid FiscalDocument state without enqueue', async () => {
    const { service, queue } = makeService({
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({ ...readyDocument, status: 'READY_FOR_XML' }),
      },
    });

    await expect(service.execute(input())).rejects.toBeInstanceOf(ConflictException);
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('rejects missing signed XML artifact without enqueue', async () => {
    const { service, queue } = makeService({
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({ ...readyDocument, xmlArtifacts: [] }),
      },
    });

    await expect(service.execute(input())).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it.each([
    ['ACKNOWLEDGED', 'fiscal-documents.reconcile-hacienda-status'],
    ['PROCESSING', 'fiscal-documents.reconcile-hacienda-status'],
    ['POST_OUTCOME_UNKNOWN', 'fiscal-documents.reconcile-hacienda-status'],
  ])('does not reset %s to queued or re-POST on duplicate submit', async (status, expectedJob) => {
    const existing = {
      id: 'submission-id',
      fiscalDocumentId: readyDocument.id,
      clave: readyDocument.clave,
      environment: readyDocument.environment,
      status,
      attemptCount: 1,
      reconciliationAttemptCount: 0,
      nextAttemptAt: new Date(),
      acceptedAt: null,
      rejectedAt: null,
      lastNormalizedErrorCode: null,
      lastSanitizedErrorMessage: null,
      lastProviderStatus: status === 'PROCESSING' ? 'procesando' : null,
      responseSha256: null,
      responseContentType: null,
      responseReceivedAt: null,
    };
    const { service, prisma, queue } = makeService({
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({ ...readyDocument, submission: existing }),
      },
      fiscalSubmission: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(existing),
        findUniqueOrThrow: jest.fn().mockResolvedValue(existing),
      },
    });

    await expect(service.execute(input())).resolves.toMatchObject({ status });
    expect(prisma.fiscalSubmission.update).not.toHaveBeenCalled();
    expect(queue.publish).toHaveBeenCalledWith(
      expectedJob,
      { submissionId: 'submission-id' },
      expect.any(Object),
    );
  });

  it('returns terminal existing submission without re-enqueueing', async () => {
    const terminal = {
      id: 'submission-id',
      fiscalDocumentId: readyDocument.id,
      clave: readyDocument.clave,
      environment: readyDocument.environment,
      status: 'ACCEPTED',
      attemptCount: 1,
      reconciliationAttemptCount: 1,
      nextAttemptAt: null,
      acceptedAt: new Date(),
      rejectedAt: null,
      lastNormalizedErrorCode: null,
      lastSanitizedErrorMessage: null,
      lastProviderStatus: 'aceptado',
      responseSha256: 'b'.repeat(64),
      responseContentType: 'application/xml',
      responseReceivedAt: new Date(),
    };
    const { service, queue } = makeService({
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({ ...readyDocument, submission: terminal }),
      },
    });

    await expect(service.execute(input())).resolves.toMatchObject({
      status: 'ACCEPTED',
      responseSha256: 'b'.repeat(64),
    });
    expect(queue.publish).not.toHaveBeenCalled();
  });
});
