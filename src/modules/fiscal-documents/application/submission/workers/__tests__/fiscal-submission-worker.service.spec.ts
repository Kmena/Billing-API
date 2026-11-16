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
    const { worker, prisma, hacienda, state, queue } = makeWorker();

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(prisma.fiscalSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'submission-id', status: { in: ['QUEUED', 'TECHNICAL_RETRY_PENDING'] } },
        data: expect.objectContaining({
          status: 'SUBMITTING',
          attemptCount: { increment: 1 },
        }),
      }),
    );
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
      expect.objectContaining({
        startAfterSeconds: 60,
        singletonKey: 'fiscal-submission:fiscal-documents.reconcile-hacienda-status:submission-id',
      }),
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

  it('makes only one POST in the single STAG test, including token-expired responses', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      invoicing: process.env.BILLING_SPEC09_STAG_INVOICING,
      singlePost: process.env.SPEC10_SINGLE_STAG_POST,
    };
    process.env.NODE_ENV = 'test';
    process.env.BILLING_SPEC09_STAG_INVOICING = 'true';
    process.env.SPEC10_SINGLE_STAG_POST = 'true';
    try {
      const { worker, hacienda, state, queue } = makeWorker({
        kind: 'RETRYABLE_FAILURE',
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED',
        httpStatus: 401,
      } as never);
      await worker.handleSubmitJob({ submissionId: 'submission-id' });
      expect(hacienda.submitSignedDocument).toHaveBeenCalledTimes(1);
      expect(state.applyProviderResult).toHaveBeenCalledWith(
        'submission-id',
        expect.objectContaining({ nextStatus: 'MANUAL_REVIEW_REQUIRED', httpStatus: 401 }),
      );
      expect(queue.publish).not.toHaveBeenCalled();
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.invoicing === undefined) delete process.env.BILLING_SPEC09_STAG_INVOICING;
      else process.env.BILLING_SPEC09_STAG_INVOICING = previous.invoicing;
      if (previous.singlePost === undefined) delete process.env.SPEC10_SINGLE_STAG_POST;
      else process.env.SPEC10_SINGLE_STAG_POST = previous.singlePost;
    }
  });

  it('makes only one POST in the isolated demo with the dedicated STAG endpoint', async () => {
    const keys = ['NODE_ENV', 'DEMO_STAG_SINGLE_POST', 'DATABASE_URL',
      'HACIENDA_RECEPCION_SANDBOX_BASE_URL', 'HACIENDA_RECEPCION_PRODUCTION_BASE_URL',
      'EMAIL_USE_REAL'] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      NODE_ENV: 'development', DEMO_STAG_SINGLE_POST: 'true',
      DATABASE_URL: 'postgresql://synthetic:synthetic@billing-db:5432/billing_demo',
      HACIENDA_RECEPCION_SANDBOX_BASE_URL:
        'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      HACIENDA_RECEPCION_PRODUCTION_BASE_URL: 'https://127.0.0.1:9/',
      EMAIL_USE_REAL: 'false',
    });
    try {
      const { worker, hacienda, state, queue } = makeWorker({
        kind: 'RETRYABLE_FAILURE', nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED', httpStatus: 401,
      } as never);
      await worker.handleSubmitJob({ submissionId: 'submission-id' });
      expect(hacienda.submitSignedDocument).toHaveBeenCalledTimes(1);
      expect(state.applyProviderResult).toHaveBeenCalledWith('submission-id',
        expect.objectContaining({ nextStatus: 'MANUAL_REVIEW_REQUIRED', httpStatus: 401 }));
      expect(queue.publish).not.toHaveBeenCalled();
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it('does not replay a stale submission after a crash in the single STAG test', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      invoicing: process.env.BILLING_SPEC09_STAG_INVOICING,
      singlePost: process.env.SPEC10_SINGLE_STAG_POST,
    };
    process.env.NODE_ENV = 'test';
    process.env.BILLING_SPEC09_STAG_INVOICING = 'true';
    process.env.SPEC10_SINGLE_STAG_POST = 'true';
    try {
      const { worker, prisma, hacienda, state, queue } = makeWorker();
      prisma.fiscalSubmission.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...submission, status: 'SUBMITTING' }]);
      await worker.enqueueDueWork();
      expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
      expect(state.applyProviderResult).toHaveBeenCalledWith(
        'submission-id',
        expect.objectContaining({
          nextStatus: 'MANUAL_REVIEW_REQUIRED',
          normalizedErrorCode: 'SPEC10_SINGLE_POST_OUTCOME_UNKNOWN',
        }),
      );
      expect(queue.publish).not.toHaveBeenCalled();
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.invoicing === undefined) delete process.env.BILLING_SPEC09_STAG_INVOICING;
      else process.env.BILLING_SPEC09_STAG_INVOICING = previous.invoicing;
      if (previous.singlePost === undefined) delete process.env.SPEC10_SINGLE_STAG_POST;
      else process.env.SPEC10_SINGLE_STAG_POST = previous.singlePost;
    }
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
      expect.objectContaining({
        startAfterSeconds: 60,
        singletonKey: 'fiscal-submission:fiscal-documents.submit-to-hacienda:submission-id',
      }),
    );
  });

  it('fails closed without provider contact when credentials are revoked before a retry', async () => {
    const { worker, prisma, secrets, hacienda, state, queue } = makeWorker();
    prisma.haciendaConnection.findFirst.mockResolvedValueOnce(null);

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(state.applyProviderResult).toHaveBeenCalledWith(
      'submission-id',
      expect.objectContaining({
        nextStatus: 'MANUAL_REVIEW_REQUIRED',
        normalizedErrorCode: 'HACIENDA_CONNECTION_NOT_CONNECTED',
      }),
    );
    expect(secrets.getSecret).not.toHaveBeenCalled();
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('keeps a retry internal when the replacement credential cannot be resolved', async () => {
    const { worker, secrets, hacienda, state, queue } = makeWorker();
    secrets.getSecret.mockRejectedValueOnce(new Error('credential unavailable'));

    await worker.handleSubmitJob({ submissionId: 'submission-id' });

    expect(state.applyProviderResult).toHaveBeenCalledWith(
      'submission-id',
      expect.objectContaining({
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        normalizedErrorCode: 'FISCAL_SUBMISSION_WORKER_FAILURE',
      }),
    );
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.objectContaining({
        singletonKey: 'fiscal-submission:fiscal-documents.submit-to-hacienda:submission-id',
      }),
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
      expect.objectContaining({
        singletonKey: 'fiscal-submission:fiscal-documents.submit-to-hacienda:submission-id',
      }),
    );
  });

  it('uses the submission claim as concurrency protection so duplicate jobs do not duplicate provider POSTs', async () => {
    const { worker, prisma, hacienda } = makeWorker();
    prisma.fiscalSubmission.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await Promise.all([
      worker.handleSubmitJob({ submissionId: 'submission-id' }),
      worker.handleSubmitJob({ submissionId: 'submission-id' }),
    ]);

    expect(prisma.fiscalSubmission.updateMany).toHaveBeenCalledTimes(2);
    expect(hacienda.submitSignedDocument).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile or resubmit a terminal SUPERSEDED submission', async () => {
    const { worker, prisma, hacienda, state } = makeWorker();
    prisma.fiscalSubmission.findUnique.mockResolvedValue({ ...submission, status: 'SUPERSEDED' });

    await worker.handleReconcileJob({ submissionId: 'submission-id' });

    expect(hacienda.queryStatusByClave).not.toHaveBeenCalled();
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
    expect(state.applyProviderResult).not.toHaveBeenCalled();
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
