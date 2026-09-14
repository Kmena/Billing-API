import { SubmitFiscalDocumentService } from '../submit-fiscal-document.service';
import { FiscalSubmissionStateService } from '../fiscal-submission-state.service';

const sensitiveValues = [
  'hacienda-password-secret',
  'oauth-access-token-secret',
  'oauth-refresh-token-secret',
  'Authorization',
  'bearer oauth-access-token-secret',
];

function expectNoSensitiveValues(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const value of sensitiveValues) {
    expect(serialized).not.toContain(value);
  }
}

describe('F3 audit and observability', () => {
  it('audits submission requested/enqueued context without credentials or tokens', async () => {
    const document = {
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
    const submission = {
      id: 'submission-id',
      fiscalDocumentId: 'document-id',
      clave: document.clave,
      environment: 'SANDBOX' as const,
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
    };
    const prisma = {
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({}) },
      haciendaConnection: { findFirst: jest.fn().mockResolvedValue({ status: 'CONNECTED' }) },
      fiscalDocument: { findFirst: jest.fn().mockResolvedValue(document) },
      fiscalSubmission: {
        create: jest.fn().mockResolvedValue({ ...submission, status: 'REQUESTED' }),
        update: jest.fn().mockResolvedValue(submission),
        findUnique: jest.fn(),
      },
    };
    const audit = { record: jest.fn() };
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new SubmitFiscalDocumentService(
      prisma as never,
      audit as never,
      queue as never,
    );

    await service.execute({
      tenantId: 'tenant-id',
      companyId: 'company-id',
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      documentId: 'document-id',
      apiKeyId: 'api-key-id',
      scopes: ['invoices:write'],
      actor: 'apiKey:test',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-id',
        companyId: 'company-id',
        apiKeyId: 'api-key-id',
        action: 'fiscal-submission.requested',
        resource: 'FiscalSubmission:submission-id',
        correlationId: 'document-id',
        metadata: expect.objectContaining({
          documentId: 'document-id',
          environment: 'SANDBOX',
          status: 'QUEUED',
        }),
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.submit-to-hacienda',
      { submissionId: 'submission-id' },
      expect.any(Object),
    );
    expectNoSensitiveValues(audit.record.mock.calls);
    expectNoSensitiveValues(queue.publish.mock.calls);
  });

  it.each([
    ['ACKNOWLEDGED', 'fiscal-submission.acknowledged', 'TECHNICAL'],
    ['POST_OUTCOME_UNKNOWN', 'fiscal-submission.post-outcome-unknown', 'TECHNICAL'],
    ['TECHNICAL_RETRY_PENDING', 'fiscal-submission.technical-retry-pending', 'TECHNICAL'],
    ['MANUAL_REVIEW_REQUIRED', 'fiscal-submission.manual-review-required', 'TECHNICAL'],
    ['ACCEPTED', 'fiscal-submission.accepted', 'FISCAL_AUDIT'],
    ['REJECTED', 'fiscal-submission.rejected', 'FISCAL_AUDIT'],
  ] as const)(
    'audits %s lifecycle result without sensitive values',
    async (status, action, eventClass) => {
      const submission = {
        id: 'submission-id',
        tenantId: 'tenant-id',
        companyId: 'company-id',
        fiscalDocumentId: 'document-id',
        environment: 'SANDBOX',
        clave: '50601012500310112345600100001010000000001100000001',
        status:
          status === 'ACKNOWLEDGED' || status === 'POST_OUTCOME_UNKNOWN'
            ? 'SUBMITTING'
            : status === 'MANUAL_REVIEW_REQUIRED'
              ? 'POST_OUTCOME_UNKNOWN'
              : 'PROCESSING',
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
      const prisma = {
        fiscalSubmission: {
          findUnique: jest.fn().mockResolvedValue(submission),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        fiscalDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        $transaction: jest.fn(),
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn(prisma),
      );
      const audit = { record: jest.fn() };
      const storage = { upload: jest.fn() };
      const service = new FiscalSubmissionStateService(
        prisma as never,
        audit as never,
        storage as never,
      );

      await service.applyProviderResult('submission-id', {
        kind:
          status === 'ACCEPTED' || status === 'REJECTED'
            ? status
            : status === 'POST_OUTCOME_UNKNOWN'
              ? 'AMBIGUOUS_FAILURE'
              : 'RETRYABLE_FAILURE',
        nextStatus: status,
        providerStatus:
          status === 'ACCEPTED' ? 'aceptado' : status === 'REJECTED' ? 'rechazado' : undefined,
        normalizedErrorCode:
          status === 'POST_OUTCOME_UNKNOWN' ? 'HACIENDA_POST_OUTCOME_UNKNOWN' : undefined,
        sanitizedErrorMessage: status.includes('RETRY') ? 'retryable sanitized message' : undefined,
      });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-id',
          companyId: 'company-id',
          action,
          eventClass,
          resource: 'FiscalSubmission:submission-id',
          correlationId: 'document-id',
          metadata: expect.objectContaining({
            documentId: 'document-id',
            clave: submission.clave,
            environment: 'SANDBOX',
            status,
          }),
        }),
      );
      expectNoSensitiveValues(audit.record.mock.calls);
    },
  );
});
