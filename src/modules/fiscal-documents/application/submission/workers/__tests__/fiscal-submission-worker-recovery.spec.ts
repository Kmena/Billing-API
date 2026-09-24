/**
 * TASK-009: Restart Recovery Proof
 *
 * Proves that the existing `enqueueDueWork()` mechanism correctly rediscovers
 * non-terminal FiscalSubmissions after a worker restart without:
 * - Creating new FiscalDocuments
 * - Allocating new consecutive numbers
 * - Issuing duplicate POSTs to Hacienda
 * - Changing the clave
 *
 * The mechanism:
 *   FiscalSubmission(POST_OUTCOME_UNKNOWN/PENDING) persisted
 *   → job/process disappears
 *   → module restarts → onModuleInit() → enqueueDueWork()
 *   → existing submission rediscovered
 *   → RECONCILE job scheduled (not SUBMIT)
 *   → GET /recepcion/{SAME clave} issued by handleReconcileJob
 */
import { FiscalSubmissionWorkerService } from '../fiscal-submission-worker.service';
import {
  RECONCILE_FISCAL_SUBMISSION_JOB,
  SUBMIT_FISCAL_DOCUMENT_JOB,
} from '../fiscal-submission-job.constants';

const CLAVE = '50601012500310112345600100001010000000001100000001';

const baseSubmission = {
  id: 'recovery-submission-id',
  tenantId: 'recovery-tenant-id',
  companyId: 'recovery-company-id',
  fiscalDocumentId: 'recovery-document-id',
  environment: 'SANDBOX' as const,
  clave: CLAVE,
  signedXmlStorageKey: 'signed.xml',
  signedXmlSha256: 'a'.repeat(64),
  fiscalDocument: {
    id: 'recovery-document-id',
    consecutive: '00100001010000000001',
    issueDate: new Date('2026-09-13T00:00:00.000Z'),
    type: 'INVOICE' as const,
    issuerSnapshot: { identificationType: 'JURIDICA', identificationNumber: '3101123456' },
    receiverSnapshot: null,
  },
};

function makeWorker() {
  let submittedDocumentCount = 0; // tracks Hacienda POSTs
  let documentCreatedCount = 0; // tracks new FiscalDocument creation

  const prisma = {
    fiscalSubmission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        ...baseSubmission,
        status: 'POST_OUTCOME_UNKNOWN',
      }),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
    fiscalDocument: {
      create: jest.fn().mockImplementation(() => {
        documentCreatedCount++;
        return Promise.resolve({});
      }),
      findUnique: jest.fn().mockResolvedValue(baseSubmission.fiscalDocument),
    },
    haciendaConnection: {
      findFirst: jest.fn().mockResolvedValue({
        companyId: 'recovery-company-id',
        environment: 'SANDBOX',
        secretReference: 'secret',
      }),
    },
  };

  const queue = {
    publish: jest.fn().mockResolvedValue(undefined),
    registerHandler: jest.fn(),
  };

  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('<FacturaElectronica/>', 'utf8')),
  };
  const secrets = {
    getSecret: jest.fn().mockResolvedValue(JSON.stringify({ username: 'u', password: 'p' })),
  };
  const auth = {
    authenticate: jest.fn().mockResolvedValue({
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 300000),
    }),
  };
  const cache = {
    getToken: jest.fn().mockReturnValue(null),
    setToken: jest.fn(),
    invalidate: jest.fn(),
  };
  const hacienda = {
    submitSignedDocument: jest.fn().mockImplementation(() => {
      submittedDocumentCount++;
      return Promise.resolve({ kind: 'ACKNOWLEDGED', nextStatus: 'ACKNOWLEDGED', httpStatus: 201 });
    }),
    queryStatusByClave: jest.fn().mockResolvedValue({
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
      providerStatus: 'aceptado',
    }),
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

  return {
    worker,
    prisma,
    queue,
    hacienda,
    state,
    getSubmittedDocumentCount: () => submittedDocumentCount,
    getDocumentCreatedCount: () => documentCreatedCount,
  };
}

describe('TASK-009: FiscalSubmissionWorkerService Restart Recovery', () => {
  // ── Scenario: POST_OUTCOME_UNKNOWN at restart ─────────────────────────────────

  it('R1: enqueueDueWork schedules RECONCILE (not SUBMIT) for POST_OUTCOME_UNKNOWN submission', async () => {
    const { worker, prisma, queue } = makeWorker();

    // Simulate: submission persisted with POST_OUTCOME_UNKNOWN (Hacienda POST happened but result unknown)
    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([{ ...baseSubmission, status: 'POST_OUTCOME_UNKNOWN' }])
      .mockResolvedValueOnce([]); // no stale SUBMITTING

    await worker.enqueueDueWork();

    // RECONCILE job must be scheduled (not SUBMIT)
    expect(queue.publish).toHaveBeenCalledWith(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      { submissionId: 'recovery-submission-id' },
      expect.any(Object),
    );
    expect(queue.publish).not.toHaveBeenCalledWith(
      SUBMIT_FISCAL_DOCUMENT_JOB,
      expect.anything(),
      expect.anything(),
    );
  });

  it('R2: enqueueDueWork for POST_OUTCOME_UNKNOWN does NOT call Hacienda submitSignedDocument', async () => {
    const { worker, prisma, hacienda, getSubmittedDocumentCount } = makeWorker();

    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([{ ...baseSubmission, status: 'POST_OUTCOME_UNKNOWN' }])
      .mockResolvedValueOnce([]);

    await worker.enqueueDueWork();

    // Zero Hacienda POSTs during restart recovery
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
    expect(getSubmittedDocumentCount()).toBe(0);
  });

  it('R3: enqueueDueWork for POST_OUTCOME_UNKNOWN does NOT create new FiscalDocuments', async () => {
    const { worker, prisma, getDocumentCreatedCount } = makeWorker();

    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([{ ...baseSubmission, status: 'POST_OUTCOME_UNKNOWN' }])
      .mockResolvedValueOnce([]);

    await worker.enqueueDueWork();

    expect(getDocumentCreatedCount()).toBe(0);
  });

  it('R4: reconcile job uses the SAME clave as the persisted FiscalSubmission', async () => {
    const { worker, hacienda } = makeWorker();

    // Simulate the reconcile job being processed
    await worker.handleReconcileJob({ submissionId: 'recovery-submission-id' });

    // Hacienda GET must use the SAME clave
    expect(hacienda.queryStatusByClave).toHaveBeenCalledWith(
      expect.objectContaining({ clave: CLAVE }),
    );
    // Hacienda POST must NOT be called during reconciliation
    expect(hacienda.submitSignedDocument).not.toHaveBeenCalled();
  });

  it('R5: reconcile job does NOT allocate new consecutive numbers', async () => {
    const { worker, getDocumentCreatedCount } = makeWorker();

    await worker.handleReconcileJob({ submissionId: 'recovery-submission-id' });

    expect(getDocumentCreatedCount()).toBe(0);
  });

  // ── Scenario: QUEUED at restart ──────────────────────────────────────────────

  it('R6: enqueueDueWork schedules SUBMIT (not RECONCILE) for QUEUED submission', async () => {
    const { worker, prisma, queue } = makeWorker();

    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([{ ...baseSubmission, status: 'QUEUED' }])
      .mockResolvedValueOnce([]);

    await worker.enqueueDueWork();

    expect(queue.publish).toHaveBeenCalledWith(
      SUBMIT_FISCAL_DOCUMENT_JOB,
      { submissionId: 'recovery-submission-id' },
      expect.any(Object),
    );
    expect(queue.publish).not.toHaveBeenCalledWith(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      expect.anything(),
      expect.anything(),
    );
  });

  // ── Scenario: Multiple non-terminal submissions ───────────────────────────────

  it('R7: enqueueDueWork handles multiple non-terminal submissions — no duplicates', async () => {
    const { worker, prisma, queue } = makeWorker();

    const sub1 = { ...baseSubmission, id: 'sub-1', status: 'POST_OUTCOME_UNKNOWN' };
    const sub2 = { ...baseSubmission, id: 'sub-2', status: 'ACKNOWLEDGED' };
    const sub3 = { ...baseSubmission, id: 'sub-3', status: 'QUEUED' };

    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([sub1, sub2, sub3])
      .mockResolvedValueOnce([]);

    await worker.enqueueDueWork();

    expect(queue.publish).toHaveBeenCalledTimes(3);

    // Verify RECONCILE for POST_OUTCOME_UNKNOWN and ACKNOWLEDGED
    expect(queue.publish).toHaveBeenCalledWith(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      { submissionId: 'sub-1' },
      expect.any(Object),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      { submissionId: 'sub-2' },
      expect.any(Object),
    );
    // Verify SUBMIT for QUEUED
    expect(queue.publish).toHaveBeenCalledWith(
      SUBMIT_FISCAL_DOCUMENT_JOB,
      { submissionId: 'sub-3' },
      expect.any(Object),
    );
  });

  // ── Scenario: onModuleInit calls enqueueDueWork ───────────────────────────────

  it('R8: onModuleInit simulates restart — registers handlers and calls enqueueDueWork', async () => {
    const { worker, prisma, queue } = makeWorker();

    prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce([{ ...baseSubmission, status: 'POST_OUTCOME_UNKNOWN' }])
      .mockResolvedValueOnce([]);

    await worker.onModuleInit();

    // Handlers registered
    expect(queue.registerHandler).toHaveBeenCalledTimes(2);

    // Reconcile scheduled for POST_OUTCOME_UNKNOWN — proves recovery on restart
    expect(queue.publish).toHaveBeenCalledWith(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      { submissionId: 'recovery-submission-id' },
      expect.any(Object),
    );
  });
});
