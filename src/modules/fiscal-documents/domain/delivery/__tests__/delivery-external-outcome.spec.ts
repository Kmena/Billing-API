import { DeliveryRetryClassifier } from '../delivery-retry-classifier';
import { DocumentDeliveryStatus } from '../document-delivery-status.enum';

describe('delivery external outcome policy', () => {
  it('never automatically retries an SMTP outcome that cannot be proven', () => {
    expect(
      DeliveryRetryClassifier.classify({
        errorClass: 'UNKNOWN_EXTERNAL_OUTCOME',
        retryCount: 0,
        maxRetries: 8,
      }),
    ).toMatchObject({
      nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
      immediateRetry: false,
    });
  });
});
