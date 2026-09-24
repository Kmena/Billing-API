import { DeliveryRetryClassifier } from '../delivery-retry-classifier';
import { DocumentDeliveryStatus } from '../document-delivery-status.enum';

describe('DeliveryRetryClassifier', () => {
  describe('ARTIFACT_HASH_MISMATCH', () => {
    it('returns MANUAL_REVIEW_REQUIRED and emits security audit', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'ARTIFACT_HASH_MISMATCH',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
      expect(result.emitSecurityAudit).toBe(true);
      expect(result.immediateRetry).toBe(false);
    });
  });

  describe('ARTIFACT_MISSING', () => {
    it('returns MANUAL_REVIEW_REQUIRED without security audit', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'ARTIFACT_MISSING',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
      expect(result.emitSecurityAudit).toBe(false);
    });
  });

  describe('INVALID_RECIPIENT / PERMANENT_PROVIDER_REJECTION', () => {
    it('returns FAILED immediately (no retry)', () => {
      for (const cls of ['INVALID_RECIPIENT', 'PERMANENT_PROVIDER_REJECTION'] as const) {
        const result = DeliveryRetryClassifier.classify({
          errorClass: cls,
          retryCount: 0,
          maxRetries: 5,
        });
        expect(result.nextStatus).toBe(DocumentDeliveryStatus.FAILED);
        expect(result.immediateRetry).toBe(false);
      }
    });
  });

  describe('TRANSIENT_PROVIDER_FAILURE', () => {
    it('returns RETRY_PENDING when below max retries', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'TRANSIENT_PROVIDER_FAILURE',
        retryCount: 1,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
    });

    it('returns FAILED when retry horizon exhausted', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'TRANSIENT_PROVIDER_FAILURE',
        retryCount: 5,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.FAILED);
    });
  });

  describe('PROVIDER_RATE_LIMIT', () => {
    it('returns RETRY_PENDING when below max retries', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'PROVIDER_RATE_LIMIT',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
      expect(result.retryDelaySeconds).toBeDefined();
    });
  });

  describe('NETWORK_TIMEOUT', () => {
    it('returns RETRY_PENDING when below max retries', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'NETWORK_TIMEOUT',
        retryCount: 2,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
    });
  });

  describe('CONFIG_CREDENTIAL_ERROR', () => {
    it('returns MANUAL_REVIEW_REQUIRED', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'CONFIG_CREDENTIAL_ERROR',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
    });
  });

  describe('PDF_NOT_YET_GENERATED', () => {
    it('returns RETRY_PENDING with short delay when below max', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'PDF_NOT_YET_GENERATED',
        retryCount: 1,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
      expect(result.retryDelaySeconds).toBe(30);
    });

    it('returns MANUAL_REVIEW_REQUIRED when horizon exhausted', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'PDF_NOT_YET_GENERATED',
        retryCount: 5,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
    });
  });

  describe('WORKER_CRASH_STALE_SENDING', () => {
    it('returns RETRY_PENDING for recovery', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'WORKER_CRASH_STALE_SENDING',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
    });
  });

  describe('DUPLICATE_TRIGGER', () => {
    it('returns QUEUED as idempotent no-op', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'DUPLICATE_TRIGGER',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.QUEUED);
    });
  });

  describe('UNKNOWN_PROVIDER_RESPONSE', () => {
    it('returns RETRY_PENDING when below max', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'UNKNOWN_PROVIDER_RESPONSE',
        retryCount: 0,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.RETRY_PENDING);
    });

    it('escalates to MANUAL_REVIEW_REQUIRED at horizon', () => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: 'UNKNOWN_PROVIDER_RESPONSE',
        retryCount: 5,
        maxRetries: 5,
      });
      expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
    });
  });

  describe('fiscal status independence', () => {
    const allClasses = [
      'TRANSIENT_PROVIDER_FAILURE',
      'PROVIDER_RATE_LIMIT',
      'NETWORK_TIMEOUT',
      'INVALID_RECIPIENT',
      'PERMANENT_PROVIDER_REJECTION',
      'ARTIFACT_MISSING',
      'ARTIFACT_HASH_MISMATCH',
      'PDF_NOT_YET_GENERATED',
      'CONFIG_CREDENTIAL_ERROR',
      'UNKNOWN_PROVIDER_RESPONSE',
      'WORKER_CRASH_STALE_SENDING',
      'DUPLICATE_TRIGGER',
      'MANUAL_RESEND_AFTER_DELIVERED',
      'REJECTED_HACIENDA_RESPONSE',
    ] as const;

    it.each(allClasses)('%s nextStatus is never a FiscalDocument status', (cls) => {
      const result = DeliveryRetryClassifier.classify({
        errorClass: cls,
        retryCount: 0,
        maxRetries: 5,
      });
      const fiscalStatuses = [
        'ACCEPTED',
        'READY_TO_SUBMIT',
        'SUBMITTING',
        'XML_GENERATED',
        'READY_FOR_XML',
      ];
      expect(fiscalStatuses).not.toContain(result.nextStatus);
    });
  });
});
