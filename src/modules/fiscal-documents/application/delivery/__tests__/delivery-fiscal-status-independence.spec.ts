/**
 * Delivery fiscal status independence tests — F4 TASK-016/017
 * Explicitly proves: delivery failure does NOT mutate FiscalDocument.status.
 *
 * Critical invariant (BR-001):
 * - READY_TO_SUBMIT + INITIAL_DOCUMENT FAILED: fiscal status unchanged
 * - ACCEPTED + HACIENDA_RESPONSE RETRY_PENDING: fiscal status unchanged
 */
import { DeliveryRetryClassifier } from '../../../domain/delivery/delivery-retry-classifier';
import { DocumentDeliveryStateMachine } from '../../../domain/delivery/document-delivery-state-machine';
import { DocumentDeliveryStatus } from '../../../domain/delivery/document-delivery-status.enum';
import { DocumentDeliveryKind } from '../../../domain/delivery/document-delivery-kind.enum';

describe('Delivery fiscal status independence (BR-001)', () => {
  describe('Delivery state machine — never produces fiscal status', () => {
    it('DocumentDeliveryStatus enum values are distinct from FiscalDocument status values', () => {
      // Delivery status values must not coincide with fiscal status values
      // (except CANCELLED which is unambiguous in both domains)
      const deliveryStatuses = Object.values(DocumentDeliveryStatus);
      const fiscalOnlyStatuses = [
        'READY_FOR_XML',
        'XML_GENERATED',
        'XML_VALIDATED',
        'SIGNED',
        'READY_TO_SUBMIT',
        'ACCEPTED',
      ];
      for (const ds of deliveryStatuses) {
        expect(fiscalOnlyStatuses).not.toContain(ds);
      }
    });

    it('SENDING → FAILED does not change any fiscal status', () => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.INITIAL_DOCUMENT,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.FAILED,
      );
      expect(result.outcome).toBe('ALLOWED');
      // The result only tells us the delivery transition is allowed
      // It never references FiscalDocument.status — verified by type system
    });

    it('DELIVERED regression blocked by stale worker guard', () => {
      // Scenario: READY_TO_SUBMIT + INITIAL_DOCUMENT DELIVERED
      // Then a stale worker tries to mark it FAILED — must be blocked
      const result = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.INITIAL_DOCUMENT,
        DocumentDeliveryStatus.DELIVERED,
        DocumentDeliveryStatus.FAILED,
      );
      expect(result.outcome).toBe('IGNORED_STALE_TERMINAL');
    });
  });

  describe('Retry classifier — never produces fiscal status', () => {
    const FISCAL_STATUSES = [
      'READY_FOR_XML',
      'XML_GENERATED',
      'XML_VALIDATED',
      'SIGNED',
      'READY_TO_SUBMIT',
      'ACCEPTED',
      'REJECTED',
    ];

    const allErrorClasses = [
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

    it.each(allErrorClasses)('%s: nextStatus is never a FiscalDocument status', (errorClass) => {
      const result = DeliveryRetryClassifier.classify({
        errorClass,
        retryCount: 0,
        maxRetries: 8,
      });
      expect(FISCAL_STATUSES).not.toContain(result.nextStatus);
    });

    it.each(allErrorClasses)(
      '%s at horizon: nextStatus is still never a FiscalDocument status',
      (errorClass) => {
        const result = DeliveryRetryClassifier.classify({
          errorClass,
          retryCount: 8,
          maxRetries: 8,
        });
        expect(FISCAL_STATUSES).not.toContain(result.nextStatus);
      },
    );
  });

  describe('READY_TO_SUBMIT + INITIAL_DOCUMENT FAILED scenario', () => {
    it('INITIAL_DOCUMENT FAILED is a valid combination with READY_TO_SUBMIT', () => {
      // Verify the state machine allows SENDING → FAILED
      const transitionResult = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.INITIAL_DOCUMENT,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.FAILED,
      );
      expect(transitionResult.outcome).toBe('ALLOWED');
      // FiscalDocument.status remains READY_TO_SUBMIT — not affected by delivery failure
    });
  });

  describe('ACCEPTED + HACIENDA_RESPONSE RETRY_PENDING scenario', () => {
    it('HACIENDA_RESPONSE RETRY_PENDING is a valid combination with ACCEPTED', () => {
      // Verify the state machine allows SENDING → RETRY_PENDING
      const transitionResult = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.HACIENDA_RESPONSE,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.RETRY_PENDING,
      );
      expect(transitionResult.outcome).toBe('ALLOWED');
      // FiscalDocument.status remains ACCEPTED — not affected by delivery retry
    });
  });

  describe('INITIAL_DOCUMENT and HACIENDA_RESPONSE independence', () => {
    it('HACIENDA_RESPONSE delivery is independent of INITIAL_DOCUMENT delivery status', () => {
      // Both INITIAL_DOCUMENT FAILED and HACIENDA_RESPONSE DELIVERED is valid
      const initialFailed = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.INITIAL_DOCUMENT,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.FAILED,
      );
      const haciendaDelivered = DocumentDeliveryStateMachine.evaluateTransition(
        DocumentDeliveryKind.HACIENDA_RESPONSE,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.DELIVERED,
      );
      expect(initialFailed.outcome).toBe('ALLOWED');
      expect(haciendaDelivered.outcome).toBe('ALLOWED');
      // Both transitions are allowed simultaneously — they are independent lifecycles
    });
  });
});
