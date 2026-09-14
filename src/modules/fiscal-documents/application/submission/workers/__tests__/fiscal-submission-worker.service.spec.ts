import { FiscalSubmissionWorkerService } from '../fiscal-submission-worker.service';

const signedXml = Buffer.from('<FacturaElectronica/>', 'utf8');
const signedXmlSha256 = '2ca7d259fe228b7166f029aa2dde82a5d9184e6b25ae8f747549f8eefcede2e7';
const submission = {
  id: 'submission-id',
  tenantId: 'tenant-id',
  companyId: 'company-id',
  fiscalDocumentId: 'document-id',
  environment: 'SANDBOX' as const,
  status: 'QUEUED' as const,
  clave: '50601012500310112345600100001010000000001100000001',
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

function makeWorker(
  providerResult = { kind: 'ACKNOWLEDGED', nextStatus: 'ACKNOWLEDGED', httpStatus: 201 } as const,
) {
  const prisma = {
    fiscalSubmission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(submission),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    haciendaConnection: {
      findFirst: jest.fn().mockResolvedValue({
        companyId: 'company-id',
        environment: 'SANDBOX',
        secretReference: 'secret',
      }),
    },
  };
  const queue = { publish: jest.fn().mockResolvedValue(undefined), registerHandler: jest.fn() };
  const storage = { download: jest.fn().mockResolvedValue(signedXml) };
  const secrets = {
    getSecret: jest.fn().mockResolvedValue(JSON.stringify({ username: 'u', password: 'p' })),
  };
  const auth = {
    authenticate: jest
      .fn()
      .mockResolvedValue({ accessToken: 'token', expiresAt: new Date(Date.now() + 300000) }),
  };
  const cache = {
    getToken: jest.fn().mockReturnValue(null),
    setToken: jest.fn(),
    invalidate: jest.fn(),
  };
  const hacienda = {
    submitSignedDocument: jest.fn().mockResolvedValue(providerResult),
    queryStatusByClave: jest.fn().mockResolvedValue(providerResult),
  };
  const state = { applyProviderResult: jest.fn().mockResolvedValue(undefined) };
  const worker = new FiscalSubmissionWorkerService(
    prisma as never,
    queue as never,
    storage as never,
    secrets as never,
    auth as never,
    cache as never,
    hacienda as never,
    state as never,
  );
  return { worker, prisma, queue, storage, secrets, auth, cache, hacienda, state };
}

describe('FiscalSubmissionWorkerService', () => {
  it('submits exact persisted signed XML and schedules reconciliation after HTTP 201 acknowledgement', async () => {
    const { worker, hacienda, state, queue } = makeWorker();

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(hacienda.submitSignedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'token',
        signedXml,
        clave: submission.clave,
      }),
    );
    expect(state.applyProviderResult).toHaveBeenCalledWith(
      'submission-id',
      expect.objectContaining({ nextStatus: 'ACKNOWLEDGED' }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.reconcile-hacienda-status',
      { submissionId: 'submission-id' },
      expect.objectContaining({ startAfterSeconds: 60 }),
    );
  });

  it('invalidates token and retries once on token expiration classification', async () => {
    const { worker, cache, hacienda } = makeWorker({
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED',
    } as never);
    hacienda.submitSignedDocument
      .mockResolvedValueOnce({
        kind: 'RETRYABLE_FAILURE',
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED',
      })
      .mockResolvedValueOnce({ kind: 'ACKNOWLEDGED', nextStatus: 'ACKNOWLEDGED', httpStatus: 201 });

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(cache.invalidate).toHaveBeenCalledWith('company-id', 'SANDBOX');
    expect(hacienda.submitSignedDocument).toHaveBeenCalledTimes(2);
  });

  it('classifies local worker exceptions after claim instead of leaving submission stuck as SUBMITTING', async () => {
    const { worker, storage, state, queue } = makeWorker();
    storage.download.mockRejectedValueOnce(new Error('storage temporarily unavailable'));

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(state.applyProviderResult).toHaveBeenCalledWith(
      'submission-id',
      expect.objectContaining({
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'FISCAL_SUBMISSION_WORKER_FAILURE',
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.objectContaining({ startAfterSeconds: 60 }),
    );
  });

  it('recovers stale SUBMITTING rows from persisted state on startup', async () => {
    const { worker, prisma, state, queue } = makeWorker();
    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...submission, status: 'SUBMITTING' }]);

    await worker.enqueueDueWork();

    expect(state.applyProviderResult).toHaveBeenCalledWith(
      'submission-id',
      expect.objectContaining({
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'FISCAL_SUBMISSION_STALE_SUBMITTING_RECOVERED',
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.any(Object),
    );
  });

  it('reconciles ambiguous POST outcome by GET status query instead of resubmitting', async () => {
    const { worker, hacienda } = makeWorker({
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
      providerStatus: 'aceptado',
    } as never);

    await worker.handleReconcileJob({ submissionId: 'submission-id' });

    expect(hacienda.queryStatusByClave).toHaveBeenCalledWith(
      expect.objectContaining({ clave: submission.clave, accessToken: 'token' }),
    );
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
  });
});
