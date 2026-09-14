import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SubmitFiscalDocumentService } from '../submit-fiscal-document.service';
import { HandleHaciendaCallbackService } from '../handle-hacienda-callback.service';
import { FiscalSubmissionWorkerService } from '../workers/fiscal-submission-worker.service';

const clave = '50601012500310112345600100001010000000001100000001';
const signedXml = Buffer.from('<FacturaElectronica/>', 'utf8');
const signedXmlSha256 = '2ca7d259fe228b7166f029aa2dde82a5d9184e6b25ae8f747549f8eefcede2e7';

function makeSubmitService(overrides: Record<string, unknown> = {}) {
  const document = {
    id: 'document-id',
    tenantId: 'tenant-id',
    companyId: 'company-id',
    environment: 'SANDBOX' as const,
    type: 'INVOICE' as const,
    status: 'READY_TO_SUBMIT',
    clave,
    xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256 }],
    submission: null,
  };
  const prisma = {
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({}) },
    haciendaConnection: { findFirst: jest.fn().mockResolvedValue({ status: 'CONNECTED' }) },
    fiscalDocument: { findFirst: jest.fn().mockResolvedValue(document) },
    fiscalSubmission: {
      create: jest.fn().mockResolvedValue({
        id: 'submission-id',
        fiscalDocumentId: 'document-id',
        clave,
        environment: 'SANDBOX',
        status: 'QUEUED',
        attemptCount: 0,
        reconciliationAttemptCount: 0,
        nextAttemptAt: new Date(),
        acceptedAt: null,
        rejectedAt: null,
        lastNormalizedErrorCode: null,
        lastSanitizedErrorMessage: null,
        lastProviderStatus: null,
        responseSha256: null,
        responseContentType: null,
        responseReceivedAt: null,
      }),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...prisma.fiscalSubmission.create(), ...data }),
        ),
      findUnique: jest.fn(),
    },
    ...overrides,
  };
  const queue = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new SubmitFiscalDocumentService(
    prisma as never,
    { record: jest.fn() } as never,
    queue as never,
  );
  return { service, prisma, queue };
}

describe('F3 security hardening', () => {
  it('enforces tenant/company/environment filters and prevents Clave enumeration through submit lookup', async () => {
    const { service, prisma, queue } = makeSubmitService({
      fiscalDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.execute({
        tenantId: 'attacker-tenant',
        companyId: 'company-id',
        environment: 'PRODUCTION',
        documentType: 'INVOICE',
        documentId: 'document-id',
        apiKeyId: 'api-key-id',
        scopes: ['invoices:write'],
      }),
    ).rejects.toMatchObject({ response: { code: 'FISCAL_DOCUMENT_NOT_FOUND' } });

    expect(prisma.fiscalDocument.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'attacker-tenant',
        companyId: 'company-id',
        environment: 'PRODUCTION',
        id: 'document-id',
      }),
      include: { xmlArtifacts: true, submission: true },
    });
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('fails closed for missing scope and unauthorized company', async () => {
    const missingScope = makeSubmitService();
    await expect(
      missingScope.service.execute({
        tenantId: 'tenant-id',
        companyId: 'company-id',
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        documentId: 'document-id',
        apiKeyId: 'api-key-id',
        scopes: ['tickets:write'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const unauthorizedCompany = makeSubmitService({
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      unauthorizedCompany.service.execute({
        tenantId: 'tenant-id',
        companyId: 'other-company',
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        documentId: 'document-id',
        apiKeyId: 'api-key-id',
        scopes: ['invoices:write'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed for disabled HaciendaConnection and invalid document/artifact states', async () => {
    const noConnection = makeSubmitService({
      haciendaConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      noConnection.service.execute({
        tenantId: 'tenant-id',
        companyId: 'company-id',
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        documentId: 'document-id',
        apiKeyId: 'api-key-id',
        scopes: ['invoices:write'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed callback payload and never lets callback select tenant/company', async () => {
    const prisma = {
      fiscalSubmission: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const queue = { publish: jest.fn() };
    const service = new HandleHaciendaCallbackService(prisma as never, queue as never);

    await expect(
      service.execute({ clave: 'bad', tenantId: 'attacker', companyId: 'attacker' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.execute({ clave, tenantId: 'attacker', companyId: 'attacker' } as never),
    ).resolves.toEqual({ accepted: true, enqueued: false });
    expect(prisma.fiscalSubmission.findUnique).toHaveBeenCalledWith({ where: { clave } });
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('keeps worker queue payloads identifier-only and credentials outside provider calls', async () => {
    const submission = {
      id: 'submission-id',
      tenantId: 'tenant-id',
      companyId: 'company-id',
      fiscalDocumentId: 'document-id',
      environment: 'SANDBOX' as const,
      status: 'QUEUED' as const,
      clave,
      signedXmlStorageKey: 'signed.xml',
      signedXmlSha256,
      fiscalDocument: {
        id: 'document-id',
        consecutive: '00100001010000000001',
        issueDate: new Date('2025-01-01T00:00:00.000Z'),
        type: 'INVOICE' as const,
        issuerSnapshot: { identificationType: 'JURIDICA', identificationNumber: '3101123456' },
        receiverSnapshot: null,
      },
    };
    const prisma = {
      fiscalSubmission: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(submission),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      haciendaConnection: {
        findFirst: jest.fn().mockResolvedValue({
          companyId: 'company-id',
          environment: 'SANDBOX',
          secretReference: 'secret-ref',
        }),
      },
    };
    const queue = { publish: jest.fn(), registerHandler: jest.fn() };
    const auth = {
      authenticate: jest.fn().mockResolvedValue({
        accessToken: 'token-secret',
        refreshToken: 'refresh-secret',
        expiresAt: new Date(Date.now() + 300000),
      }),
    };
    const hacienda = {
      submitSignedDocument: jest
        .fn()
        .mockResolvedValue({ kind: 'ACKNOWLEDGED', nextStatus: 'ACKNOWLEDGED' }),
    };
    const worker = new FiscalSubmissionWorkerService(
      prisma as never,
      queue as never,
      { download: jest.fn().mockResolvedValue(signedXml) } as never,
      {
        getSecret: jest
          .fn()
          .mockResolvedValue(JSON.stringify({ username: 'user', password: 'password-secret' })),
      } as never,
      auth as never,
      {
        getToken: jest.fn().mockReturnValue(null),
        setToken: jest.fn(),
        invalidate: jest.fn(),
      } as never,
      hacienda as never,
      { applyProviderResult: jest.fn() } as never,
    );

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(hacienda.submitSignedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token-secret' }),
    );
    expect(JSON.stringify(queue.publish.mock.calls)).not.toContain('password-secret');
    expect(JSON.stringify(queue.publish.mock.calls)).not.toContain('token-secret');
    expect(JSON.stringify(queue.publish.mock.calls)).not.toContain('<FacturaElectronica');
  });
});
