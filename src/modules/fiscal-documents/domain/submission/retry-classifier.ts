import type { FiscalSubmissionStatus } from './fiscal-submission-state-machine';

export type ProviderSendState = 'NOT_SENT' | 'POSSIBLY_SENT' | 'SENT';

export type SubmissionFailureKind =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED_OR_INVALID'
  | 'NETWORK_TIMEOUT'
  | 'CONNECTIVITY_FAILURE'
  | 'PROVIDER_5XX'
  | 'PROVIDER_429'
  | 'MALFORMED_REQUEST'
  | 'INVALID_SIGNED_XML'
  | 'INVALID_CLAVE'
  | 'UNAUTHORIZED_COMPANY'
  | 'AUTHORITATIVE_REJECTION'
  | 'ALREADY_RECEIVED_OR_DUPLICATE'
  | 'STATUS_PROCESSING'
  | 'STATUS_NOT_FOUND'
  | 'PROVIDER_ERROR_OR_UNKNOWN_STATUS'
  | 'WORKER_CRASH'
  | 'LOCAL_ERROR_BEFORE_POST'
  | 'LOCAL_ERROR_AFTER_POST';

export type RetryDecisionAction =
  'RETRY' | 'RECONCILE' | 'POLL' | 'MANUAL_REVIEW' | 'TERMINAL_REJECTED';

export type TokenCacheAction = 'NONE' | 'INVALIDATE' | 'REAUTHENTICATE';

export interface RetryClassifierInput {
  readonly failureKind: SubmissionFailureKind;
  readonly providerSendState?: ProviderSendState;
  readonly retryAfterSeconds?: number;
  readonly rateLimitResetAt?: Date;
  readonly hasAuthoritativeRejection?: boolean;
  readonly isDefinitelyNotSubmitted?: boolean;
}

export interface RetryClassifierDecision {
  readonly action: RetryDecisionAction;
  readonly nextStatus: FiscalSubmissionStatus;
  readonly shouldRetry: boolean;
  readonly shouldReconcileBeforeRetry: boolean;
  readonly isTerminal: boolean;
  readonly requiresManualIntervention: boolean;
  readonly tokenCacheAction: TokenCacheAction;
  readonly backoffStrategy:
    'NONE' | 'IMMEDIATE_ONCE' | 'EXPONENTIAL_JITTER' | 'RATE_LIMIT' | 'POLLING';
  readonly reason: string;
}

export class RetryClassifier {
  classify(input: RetryClassifierInput): RetryClassifierDecision {
    switch (input.failureKind) {
      case 'AUTH_INVALID_CREDENTIALS':
        return this.manualReview(
          'Invalid Hacienda credentials require operator correction.',
          'INVALIDATE',
        );
      case 'TOKEN_EXPIRED_OR_INVALID':
        return {
          action: 'RETRY',
          nextStatus: 'TECHNICAL_RETRY_PENDING',
          shouldRetry: true,
          shouldReconcileBeforeRetry: input.providerSendState === 'POSSIBLY_SENT',
          isTerminal: false,
          requiresManualIntervention: false,
          tokenCacheAction: 'REAUTHENTICATE',
          backoffStrategy: 'IMMEDIATE_ONCE',
          reason: 'Expired or invalid bearer token can be retried once after re-authentication.',
        };
      case 'NETWORK_TIMEOUT':
        if (input.providerSendState === 'POSSIBLY_SENT' || input.providerSendState === 'SENT') {
          return this.reconcile('Network timeout after possible send must reconcile by Clave.');
        }
        return this.retry('Network timeout before confirmed send is retryable.');
      case 'CONNECTIVITY_FAILURE':
        return this.retry('DNS/connectivity/TLS failure before send is retryable.');
      case 'PROVIDER_5XX':
        if (input.providerSendState === 'POSSIBLY_SENT') {
          return this.reconcile(
            'Provider 5xx with ambiguous send state must reconcile before retry.',
          );
        }
        return this.retry('Provider 5xx is retryable with bounded backoff.');
      case 'PROVIDER_429':
        return {
          ...this.retry('Provider rate limit is retryable with rate-limit-aware backoff.'),
          backoffStrategy: 'RATE_LIMIT',
        };
      case 'MALFORMED_REQUEST':
        return this.manualReview(
          'Malformed local request/configuration must not be retried blindly.',
        );
      case 'INVALID_SIGNED_XML':
        if (input.hasAuthoritativeRejection) {
          return this.terminalRejected(
            'Invalid signed XML was authoritatively rejected by Hacienda.',
          );
        }
        return this.manualReview('Invalid signed XML requires correction outside blind retry.');
      case 'INVALID_CLAVE':
        return this.manualReview(
          'Invalid Clave requires operator review unless official rejection is authoritative.',
        );
      case 'UNAUTHORIZED_COMPANY':
        return this.manualReview(
          'Unauthorized taxpayer/company credentials require operator correction.',
          'INVALIDATE',
        );
      case 'AUTHORITATIVE_REJECTION':
        return this.terminalRejected('Hacienda authoritative rejected status is terminal.');
      case 'ALREADY_RECEIVED_OR_DUPLICATE':
        return this.reconcile(
          'Duplicate/already received semantics must be resolved by querying the same Clave.',
        );
      case 'STATUS_PROCESSING':
        return {
          action: 'POLL',
          nextStatus: 'PROCESSING',
          shouldRetry: true,
          shouldReconcileBeforeRetry: false,
          isTerminal: false,
          requiresManualIntervention: false,
          tokenCacheAction: 'NONE',
          backoffStrategy: 'POLLING',
          reason:
            'Official recibido/procesando status remains non-terminal and should continue polling.',
        };
      case 'STATUS_NOT_FOUND':
        if (input.isDefinitelyNotSubmitted) {
          return this.retry(
            'Status not found is retryable only when the document definitely was not submitted.',
          );
        }
        return this.reconcile(
          'Ambiguous not-found status requires repeated reconciliation or manual review horizon.',
        );
      case 'PROVIDER_ERROR_OR_UNKNOWN_STATUS':
        return this.manualReview(
          'Provider error or unknown status cannot be mapped to terminal fiscal outcome.',
        );
      case 'WORKER_CRASH':
        if (input.providerSendState === 'POSSIBLY_SENT' || input.providerSendState === 'SENT') {
          return this.reconcile(
            'Worker crash after possible POST requires reconciliation by Clave.',
          );
        }
        return this.retry('Worker crash before POST can be retried through the queue.');
      case 'LOCAL_ERROR_BEFORE_POST':
        return this.retry('Local DB/storage error before POST is retryable if transient.');
      case 'LOCAL_ERROR_AFTER_POST':
        return this.reconcile(
          'Local persistence failure after POST requires reconciliation by Clave.',
        );
    }
  }

  private retry(reason: string): RetryClassifierDecision {
    return {
      action: 'RETRY',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      shouldRetry: true,
      shouldReconcileBeforeRetry: false,
      isTerminal: false,
      requiresManualIntervention: false,
      tokenCacheAction: 'NONE',
      backoffStrategy: 'EXPONENTIAL_JITTER',
      reason,
    };
  }

  private reconcile(reason: string): RetryClassifierDecision {
    return {
      action: 'RECONCILE',
      nextStatus: 'POST_OUTCOME_UNKNOWN',
      shouldRetry: false,
      shouldReconcileBeforeRetry: true,
      isTerminal: false,
      requiresManualIntervention: false,
      tokenCacheAction: 'NONE',
      backoffStrategy: 'POLLING',
      reason,
    };
  }

  private manualReview(
    reason: string,
    tokenCacheAction: TokenCacheAction = 'NONE',
  ): RetryClassifierDecision {
    return {
      action: 'MANUAL_REVIEW',
      nextStatus: 'MANUAL_REVIEW_REQUIRED',
      shouldRetry: false,
      shouldReconcileBeforeRetry: false,
      isTerminal: false,
      requiresManualIntervention: true,
      tokenCacheAction,
      backoffStrategy: 'NONE',
      reason,
    };
  }

  private terminalRejected(reason: string): RetryClassifierDecision {
    return {
      action: 'TERMINAL_REJECTED',
      nextStatus: 'REJECTED',
      shouldRetry: false,
      shouldReconcileBeforeRetry: false,
      isTerminal: true,
      requiresManualIntervention: false,
      tokenCacheAction: 'NONE',
      backoffStrategy: 'NONE',
      reason,
    };
  }
}
