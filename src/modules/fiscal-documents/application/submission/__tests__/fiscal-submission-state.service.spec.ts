import { createHash } from 'crypto';
import { FiscalSubmissionStateService } from '../fiscal-submission-state.service';

const submission = {
  id: 'submission-id',
  tenantId: 'tenant-id',
  companyId: 'company-id',
  fiscalDocumentId: 'document-id',
  environment: 'SANDBOX',
  clave: '50601012500310112345600100001010000000001100000001',
  status: 'PROCESSING',
  providerLocation: null,
  providerReference: null,
  lastProviderStatus: null,
  acceptedAt: null,
  rejectedAt: null,
  responseStorageKey: null,
  responseSha256: null,
  responseContentType: null,
  responseReceivedAt: null,
};

function makeService(current = submission) {
  const prisma: {
    fiscalSubmission: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    fiscalDocument: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  } = {
    fiscalSubmission: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    fiscalDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(prisma));
  const audit = { record: jest.fn() };
  const storage = { upload: jest.fn().mockResolvedValue('response.xml') };
  return {
    service: new FiscalSubmissionStateService(prisma as never, audit as never, storage as never),
    prisma,
    audit,
    storage,
  };
}

describe('FiscalSubmissionStateService', () => {
  it('stores exact Hacienda response bytes with SHA-256 and terminal document update', async () => {
    const response = Buffer.from('<MensajeHacienda>aceptado</MensajeHacienda>', 'utf8');
    const { service, prisma, storage } = makeService();

    await service.applyProviderResult('submission-id', {
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
      providerStatus: 'aceptado',
      responseArtifact: { content: response, contentType: 'application/xml' },
    });

    const expectedSha = createHash('sha256').update(response).digest('hex');
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringContaining(submission.clave),
      response,
      expect.objectContaining({ sha256: expectedSha }),
    );
    expect(prisma.fiscalSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED', responseSha256: expectedSha }),
      }),
    );
    expect(prisma.fiscalDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'document-id' }),
        data: { status: 'ACCEPTED' },
      }),
    );
  });

  it('ignores stale non-terminal updates after terminal state', async () => {
    const { service, prisma, storage } = makeService({ ...submission, status: 'ACCEPTED' });

    await service.applyProviderResult('submission-id', {
      kind: 'PROCESSING',
      nextStatus: 'PROCESSING',
      providerStatus: 'procesando',
    });

    expect(prisma.fiscalSubmission.updateMany).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
