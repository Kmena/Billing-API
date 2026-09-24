/**
 * DeliveryRetryClassifier — F4 delivery error classification.
 *
 * Implements delivery-retry-matrix.md exactly.
 * NO classification may produce a FiscalDocument state transition.
 * All outcomes are delivery-layer decisions only.
 */
import { DocumentDeliveryStatus } from './document-delivery-status.enum';

export type DeliveryErrorClass =
  | 'TRANSIENT_PROVIDER_FAILURE'
  | 'PROVIDER_RATE_LIMIT'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_RECIPIENT'
  | 'PERMANENT_PROVIDER_REJECTION'
  | 'ARTIFACT_MISSING'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'PDF_NOT_YET_GENERATED'
  | 'CONFIG_CREDENTIAL_ERROR'
  | 'UNKNOWN_PROVIDER_RESPONSE'
  | 'WORKER_CRASH_STALE_SENDING'
  | 'DUPLICATE_TRIGGER'
  | 'MANUAL_RESEND_AFTER_DELIVERED'
  | 'REJECTED_HACIENDA_RESPONSE';

export interface DeliveryErrorInput {
  readonly errorClass: DeliveryErrorClass;
  readonly retryCount: number;
  readonly maxRetries: number;
  /** True if the delivery was already DELIVERED before this attempt. */
  readonly alreadyDelivered?: boolean;
}

export interface DeliveryClassificationResult {
  /** Next delivery status to apply. Never a fiscal status. */
  readonly nextStatus: DocumentDeliveryStatus;
  /** Whether to immediately trigger a retry (vs letting the scheduler do it). */
  readonly immediateRetry: boolean;
  /** Optional delay in seconds before the next retry attempt. */
  readonly retryDelaySeconds?: number;
  /** Whether a security audit event should be emitted. */
  readonly emitSecurityAudit: boolean;
  /** Human-readable reason for operators. */
  readonly reason: string;
}

export class DeliveryRetryClassifier {
  /**
   * Classify a delivery error and return the next delivery status.
   * Does NOT modify FiscalDocument.status.
   * Does NOT create new FiscalDocument, Clave, or signed XML.
   */
  static classify(input: DeliveryErrorInput): DeliveryClassificationResult {
    const { errorClass, retryCount, maxRetries } = input;

    // Duplicate trigger: idempotent no-op
    if (errorClass === 'DUPLICATE_TRIGGER') {
      return {
        nextStatus: DocumentDeliveryStatus.QUEUED,
        immediateRetry: false,
        emitSecurityAudit: false,
        reason: 'Duplicate delivery trigger — already queued or processing.',
      };
    }

    // Artifact hash mismatch: security event, manual review, never retry
    if (errorClass === 'ARTIFACT_HASH_MISMATCH') {
      return {
        nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
        immediateRetry: false,
        emitSecurityAudit: true,
        reason: 'Artifact SHA-256 hash mismatch — possible tampering. Delivery blocked.',
      };
    }

    // Missing artifact: manual review, no immediate retry
    if (errorClass === 'ARTIFACT_MISSING') {
      return {
        nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
        immediateRetry: false,
        emitSecurityAudit: false,
        reason: 'Artifact missing — cannot compose delivery package without required artifact.',
      };
    }

    // PDF not yet generated: limited retry
    if (errorClass === 'PDF_NOT_YET_GENERATED') {
      if (retryCount >= maxRetries) {
        return {
          nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
          immediateRetry: false,
          emitSecurityAudit: false,
          reason: 'PDF generation did not complete within retry horizon.',
        };
      }
      return {
        nextStatus: DocumentDeliveryStatus.RETRY_PENDING,
        immediateRetry: false,
        retryDelaySeconds: 30,
        emitSecurityAudit: false,
        reason: 'PDF not yet generated — scheduling short retry.',
      };
    }

    // Config/credential error: manual review (operator fix required)
    if (errorClass === 'CONFIG_CREDENTIAL_ERROR') {
      return {
        nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
        immediateRetry: false,
        emitSecurityAudit: false,
        reason: 'Configuration or credential error — operator intervention required.',
      };
    }

    // Invalid recipient / hard bounce: permanent failure, no retry
    if (errorClass === 'INVALID_RECIPIENT' || errorClass === 'PERMANENT_PROVIDER_REJECTION') {
      return {
        nextStatus: DocumentDeliveryStatus.FAILED,
        immediateRetry: false,
        emitSecurityAudit: false,
        reason: `Permanent delivery failure (${errorClass}) — recipient correction and manual resend required.`,
      };
    }

    // Worker crash / stale SENDING: recover to retry
    if (errorClass === 'WORKER_CRASH_STALE_SENDING') {
      return {
        nextStatus: DocumentDeliveryStatus.RETRY_PENDING,
        immediateRetry: false,
        retryDelaySeconds: 60,
        emitSecurityAudit: false,
        reason: 'Worker crashed before provider result was applied — recovering to retry.',
      };
    }

    // Manual resend after DELIVERED: new attempt, preserve status
    if (errorClass === 'MANUAL_RESEND_AFTER_DELIVERED') {
      return {
        nextStatus: DocumentDeliveryStatus.QUEUED,
        immediateRetry: true,
        emitSecurityAudit: false,
        reason: 'Manual resend requested after successful delivery — new attempt created.',
      };
    }

    // Rejected HACIENDA_RESPONSE: normal delivery retries (same as transient)
    if (errorClass === 'REJECTED_HACIENDA_RESPONSE') {
      return this.classifyTransient(retryCount, maxRetries);
    }

    // Transient failures: TRANSIENT_PROVIDER_FAILURE, NETWORK_TIMEOUT, PROVIDER_RATE_LIMIT
    if (
      errorClass === 'TRANSIENT_PROVIDER_FAILURE' ||
      errorClass === 'NETWORK_TIMEOUT' ||
      errorClass === 'PROVIDER_RATE_LIMIT'
    ) {
      return this.classifyTransient(retryCount, maxRetries);
    }

    // Unknown provider response: limited bounded retry, escalate to MRR
    if (errorClass === 'UNKNOWN_PROVIDER_RESPONSE') {
      if (retryCount >= maxRetries) {
        return {
          nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
          immediateRetry: false,
          emitSecurityAudit: false,
          reason: 'Unknown provider response exceeded retry limit — manual review required.',
        };
      }
      return {
        nextStatus: DocumentDeliveryStatus.RETRY_PENDING,
        immediateRetry: false,
        retryDelaySeconds: this.exponentialBackoff(retryCount),
        emitSecurityAudit: false,
        reason: 'Unknown provider response — bounded retry.',
      };
    }

    // Fallback: treat as manual review to avoid blind retries
    return {
      nextStatus: DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
      immediateRetry: false,
      emitSecurityAudit: false,
      reason: `Unclassified error class '${errorClass}' — manual review required.`,
    };
  }

  private static classifyTransient(
    retryCount: number,
    maxRetries: number,
  ): DeliveryClassificationResult {
    if (retryCount >= maxRetries) {
      return {
        nextStatus: DocumentDeliveryStatus.FAILED,
        immediateRetry: false,
        emitSecurityAudit: false,
        reason: 'Transient failure retry horizon exhausted — delivery failed.',
      };
    }
    return {
      nextStatus: DocumentDeliveryStatus.RETRY_PENDING,
      immediateRetry: false,
      retryDelaySeconds: this.exponentialBackoff(retryCount),
      emitSecurityAudit: false,
      reason: 'Transient provider failure — exponential backoff retry scheduled.',
    };
  }

  /** Exponential backoff with jitter: base 60s, cap at 3600s. */
  private static exponentialBackoff(attempt: number): number {
    const base = 60;
    const cap = 3600;
    const raw = base * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 30);
    return Math.min(raw + jitter, cap);
  }
}
