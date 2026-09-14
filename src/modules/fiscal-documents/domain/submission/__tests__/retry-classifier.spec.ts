import {
  RetryClassifier,
  type RetryClassifierInput,
  type RetryClassifierDecision,
} from '../retry-classifier';

describe('RetryClassifier', () => {
  const classifier = new RetryClassifier();

  const cases: Array<{
    readonly name: string;
    readonly input: RetryClassifierInput;
    readonly expected: Partial<RetryClassifierDecision>;
  }> = [
    {
      name: 'invalid credentials require manual review and token invalidation',
      input: { failureKind: 'AUTH_INVALID_CREDENTIALS' },
      expected: {
        action: 'MANUAL_REVIEW',
        nextStatus: 'MANUAL_REVIEW_REQUIRED',
        shouldRetry: false,
        requiresManualIntervention: true,
        tokenCacheAction: 'INVALIDATE',
      },
    },
    {
      name: 'expired token retries immediately after re-authentication',
      input: { failureKind: 'TOKEN_EXPIRED_OR_INVALID' },
      expected: {
        action: 'RETRY',
        nextStatus: 'TECHNICAL_RETRY_PENDING',
        shouldRetry: true,
        tokenCacheAction: 'REAUTHENTICATE',
        backoffStrategy: 'IMMEDIATE_ONCE',
      },
    },
    {
      name: 'timeout before confirmed send retries',
      input: { failureKind: 'NETWORK_TIMEOUT', providerSendState: 'NOT_SENT' },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
        shouldReconcileBeforeRetry: false,
      },
    },
    {
      name: 'timeout after possible send reconciles by Clave',
      input: { failureKind: 'NETWORK_TIMEOUT', providerSendState: 'POSSIBLY_SENT' },
      expected: {
        action: 'RECONCILE',
        nextStatus: 'POST_OUTCOME_UNKNOWN',
        shouldRetry: false,
        shouldReconcileBeforeRetry: true,
      },
    },
    {
      name: 'connectivity failure retries with bounded backoff',
      input: { failureKind: 'CONNECTIVITY_FAILURE' },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
        backoffStrategy: 'EXPONENTIAL_JITTER',
      },
    },
    {
      name: 'provider 5xx retries when send state is not ambiguous',
      input: { failureKind: 'PROVIDER_5XX', providerSendState: 'NOT_SENT' },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
      },
    },
    {
      name: 'provider 5xx reconciles when send state is ambiguous',
      input: { failureKind: 'PROVIDER_5XX', providerSendState: 'POSSIBLY_SENT' },
      expected: {
        action: 'RECONCILE',
        shouldReconcileBeforeRetry: true,
      },
    },
    {
      name: 'provider 429 uses rate-limit-aware retry',
      input: { failureKind: 'PROVIDER_429', retryAfterSeconds: 30 },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
        backoffStrategy: 'RATE_LIMIT',
      },
    },
    {
      name: 'malformed local request requires manual review',
      input: { failureKind: 'MALFORMED_REQUEST' },
      expected: {
        action: 'MANUAL_REVIEW',
        shouldRetry: false,
      },
    },
    {
      name: 'invalid signed XML is terminal only when authoritative rejection is present',
      input: { failureKind: 'INVALID_SIGNED_XML', hasAuthoritativeRejection: true },
      expected: {
        action: 'TERMINAL_REJECTED',
        nextStatus: 'REJECTED',
        isTerminal: true,
      },
    },
    {
      name: 'invalid signed XML without authoritative rejection requires manual review',
      input: { failureKind: 'INVALID_SIGNED_XML' },
      expected: {
        action: 'MANUAL_REVIEW',
        nextStatus: 'MANUAL_REVIEW_REQUIRED',
        isTerminal: false,
      },
    },
    {
      name: 'invalid Clave requires manual review',
      input: { failureKind: 'INVALID_CLAVE' },
      expected: {
        action: 'MANUAL_REVIEW',
        shouldRetry: false,
      },
    },
    {
      name: 'unauthorized taxpayer/company requires manual review and token invalidation',
      input: { failureKind: 'UNAUTHORIZED_COMPANY' },
      expected: {
        action: 'MANUAL_REVIEW',
        tokenCacheAction: 'INVALIDATE',
      },
    },
    {
      name: 'authoritative fiscal rejection is terminal rejected',
      input: { failureKind: 'AUTHORITATIVE_REJECTION' },
      expected: {
        action: 'TERMINAL_REJECTED',
        nextStatus: 'REJECTED',
        isTerminal: true,
      },
    },
    {
      name: 'already received or duplicate reconciles by same Clave',
      input: { failureKind: 'ALREADY_RECEIVED_OR_DUPLICATE' },
      expected: {
        action: 'RECONCILE',
        nextStatus: 'POST_OUTCOME_UNKNOWN',
        shouldReconcileBeforeRetry: true,
      },
    },
    {
      name: 'processing status continues polling',
      input: { failureKind: 'STATUS_PROCESSING' },
      expected: {
        action: 'POLL',
        nextStatus: 'PROCESSING',
        shouldRetry: true,
        backoffStrategy: 'POLLING',
      },
    },
    {
      name: 'not found retries only when definitely not submitted',
      input: { failureKind: 'STATUS_NOT_FOUND', isDefinitelyNotSubmitted: true },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
      },
    },
    {
      name: 'ambiguous not found reconciles',
      input: { failureKind: 'STATUS_NOT_FOUND' },
      expected: {
        action: 'RECONCILE',
        shouldReconcileBeforeRetry: true,
      },
    },
    {
      name: 'provider error or unknown status requires manual review',
      input: { failureKind: 'PROVIDER_ERROR_OR_UNKNOWN_STATUS' },
      expected: {
        action: 'MANUAL_REVIEW',
        nextStatus: 'MANUAL_REVIEW_REQUIRED',
      },
    },
    {
      name: 'worker crash after possible POST reconciles',
      input: { failureKind: 'WORKER_CRASH', providerSendState: 'POSSIBLY_SENT' },
      expected: {
        action: 'RECONCILE',
        shouldReconcileBeforeRetry: true,
      },
    },
    {
      name: 'worker crash before POST retries through queue',
      input: { failureKind: 'WORKER_CRASH', providerSendState: 'NOT_SENT' },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
      },
    },
    {
      name: 'local error before POST retries',
      input: { failureKind: 'LOCAL_ERROR_BEFORE_POST' },
      expected: {
        action: 'RETRY',
        shouldRetry: true,
      },
    },
    {
      name: 'local DB error after POST reconciles',
      input: { failureKind: 'LOCAL_ERROR_AFTER_POST' },
      expected: {
        action: 'RECONCILE',
        shouldReconcileBeforeRetry: true,
      },
    },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    expect(classifier.classify(input)).toMatchObject(expected);
  });

  it('does not classify technical failures as fiscal rejection', () => {
    const retryable = classifier.classify({ failureKind: 'PROVIDER_5XX' });
    const manualReview = classifier.classify({ failureKind: 'MALFORMED_REQUEST' });

    expect(retryable.nextStatus).toBe('TECHNICAL_RETRY_PENDING');
    expect(retryable.isTerminal).toBe(false);
    expect(manualReview.nextStatus).toBe('MANUAL_REVIEW_REQUIRED');
    expect(manualReview.isTerminal).toBe(false);
  });

  it('requires reconciliation before retrying ambiguous provider outcomes', () => {
    const decision = classifier.classify({
      failureKind: 'NETWORK_TIMEOUT',
      providerSendState: 'POSSIBLY_SENT',
    });

    expect(decision.nextStatus).toBe('POST_OUTCOME_UNKNOWN');
    expect(decision.shouldReconcileBeforeRetry).toBe(true);
    expect(decision.shouldRetry).toBe(false);
  });
});
