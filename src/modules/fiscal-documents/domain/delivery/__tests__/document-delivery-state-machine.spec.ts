import { DocumentDeliveryStateMachine } from '../document-delivery-state-machine';
import { DocumentDeliveryStatus } from '../document-delivery-status.enum';
import { DocumentDeliveryKind } from '../document-delivery-kind.enum';

describe('DocumentDeliveryStateMachine', () => {
  const kind = DocumentDeliveryKind.INITIAL_DOCUMENT;
  const kind2 = DocumentDeliveryKind.HACIENDA_RESPONSE;

  describe('ALLOWED transitions', () => {
    const allowedCases: [DocumentDeliveryStatus, DocumentDeliveryStatus][] = [
      [DocumentDeliveryStatus.PENDING, DocumentDeliveryStatus.QUEUED],
      [DocumentDeliveryStatus.QUEUED, DocumentDeliveryStatus.SENDING],
      [DocumentDeliveryStatus.SENDING, DocumentDeliveryStatus.DELIVERED],
      [DocumentDeliveryStatus.SENDING, DocumentDeliveryStatus.RETRY_PENDING],
      [DocumentDeliveryStatus.SENDING, DocumentDeliveryStatus.FAILED],
      [DocumentDeliveryStatus.SENDING, DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED],
      [DocumentDeliveryStatus.RETRY_PENDING, DocumentDeliveryStatus.QUEUED],
      [DocumentDeliveryStatus.RETRY_PENDING, DocumentDeliveryStatus.FAILED],
      [DocumentDeliveryStatus.FAILED, DocumentDeliveryStatus.QUEUED],
      [DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED, DocumentDeliveryStatus.QUEUED],
    ];

    it.each(allowedCases)('allows %s → %s', (from, to) => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(kind, from, to);
      expect(result.outcome).toBe('ALLOWED');
    });
  });

  describe('REJECTED transitions', () => {
    const rejectedCases: [DocumentDeliveryStatus, DocumentDeliveryStatus][] = [
      [DocumentDeliveryStatus.PENDING, DocumentDeliveryStatus.DELIVERED],
      [DocumentDeliveryStatus.PENDING, DocumentDeliveryStatus.SENDING],
      [DocumentDeliveryStatus.QUEUED, DocumentDeliveryStatus.DELIVERED],
      [DocumentDeliveryStatus.QUEUED, DocumentDeliveryStatus.RETRY_PENDING],
      [DocumentDeliveryStatus.FAILED, DocumentDeliveryStatus.DELIVERED],
      [DocumentDeliveryStatus.FAILED, DocumentDeliveryStatus.RETRY_PENDING],
    ];

    it.each(rejectedCases)('rejects %s → %s', (from, to) => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(kind, from, to);
      expect(result.outcome).toBe('REJECTED');
    });
  });

  describe('IGNORED_STALE_TERMINAL: DELIVERED must not regress', () => {
    const staleCases: DocumentDeliveryStatus[] = [
      DocumentDeliveryStatus.FAILED,
      DocumentDeliveryStatus.RETRY_PENDING,
      DocumentDeliveryStatus.PENDING,
      DocumentDeliveryStatus.QUEUED,
      DocumentDeliveryStatus.SENDING,
      DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
    ];

    it.each(staleCases)('ignores DELIVERED → %s (stale worker protection)', (to) => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(
        kind,
        DocumentDeliveryStatus.DELIVERED,
        to,
      );
      expect(result.outcome).toBe('IGNORED_STALE_TERMINAL');
    });

    it('ignores stale DELIVERED → QUEUED when attempted by stale worker', () => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(
        kind,
        DocumentDeliveryStatus.DELIVERED,
        DocumentDeliveryStatus.QUEUED,
      );
      expect(result.outcome).toBe('IGNORED_STALE_TERMINAL');
    });
  });

  describe('kind isolation', () => {
    it('INITIAL_DOCUMENT and HACIENDA_RESPONSE are independent lifecycle (both can transition PENDING → QUEUED)', () => {
      const r1 = DocumentDeliveryStateMachine.evaluateTransition(
        kind,
        DocumentDeliveryStatus.PENDING,
        DocumentDeliveryStatus.QUEUED,
      );
      const r2 = DocumentDeliveryStateMachine.evaluateTransition(
        kind2,
        DocumentDeliveryStatus.PENDING,
        DocumentDeliveryStatus.QUEUED,
      );
      expect(r1.outcome).toBe('ALLOWED');
      expect(r2.outcome).toBe('ALLOWED');
    });
  });

  describe('fiscal status independence', () => {
    it('evaluateTransition never returns a fiscal status value', () => {
      const result = DocumentDeliveryStateMachine.evaluateTransition(
        kind,
        DocumentDeliveryStatus.SENDING,
        DocumentDeliveryStatus.FAILED,
      );
      // Outcome must be one of the delivery-only outcomes
      expect(['ALLOWED', 'IGNORED_STALE_TERMINAL', 'REJECTED']).toContain(result.outcome);
      // No fiscal status values should appear in the result
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('ACCEPTED');
      expect(resultStr).not.toContain('READY_TO_SUBMIT');
      expect(resultStr).not.toContain('REJECTED');
    });
  });

  describe('canManualResend', () => {
    it('allows resend from FAILED', () => {
      expect(DocumentDeliveryStateMachine.canManualResend(DocumentDeliveryStatus.FAILED)).toBe(
        true,
      );
    });
    it('allows resend from DELIVERED', () => {
      expect(DocumentDeliveryStateMachine.canManualResend(DocumentDeliveryStatus.DELIVERED)).toBe(
        true,
      );
    });
    it('disallows resend from CANCELLED', () => {
      expect(DocumentDeliveryStateMachine.canManualResend(DocumentDeliveryStatus.CANCELLED)).toBe(
        false,
      );
    });
  });
});
