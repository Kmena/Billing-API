/**
 * DocumentDeliveryStateMachine — F4 delivery lifecycle enforcement.
 *
 * INVARIANT: DocumentDelivery.status MUST NEVER write to FiscalDocument.status.
 * INVARIANT: DELIVERED must not regress to any non-terminal state due to stale workers.
 * INVARIANT: Transitions are scoped by kind — INITIAL_DOCUMENT and HACIENDA_RESPONSE
 *            are independent lifecycles and must not interfere.
 */
import { DocumentDeliveryStatus } from './document-delivery-status.enum';
import { DocumentDeliveryKind } from './document-delivery-kind.enum';

export type TransitionOutcome = 'ALLOWED' | 'IGNORED_STALE_TERMINAL' | 'REJECTED';

export interface TransitionResult {
  readonly outcome: TransitionOutcome;
  readonly reason?: string;
}

/**
 * Valid delivery state transitions (state machine).
 * PENDING → QUEUED → SENDING → DELIVERED
 * SENDING → RETRY_PENDING → QUEUED (retry cycle)
 * SENDING → FAILED (permanent failure)
 * SENDING → MANUAL_REVIEW_REQUIRED
 * RETRY_PENDING → FAILED (horizon exhausted)
 * RETRY_PENDING → QUEUED (retry scheduled)
 * FAILED → QUEUED (manual resend)
 * MANUAL_REVIEW_REQUIRED → QUEUED (operator resolves)
 * DELIVERED → QUEUED (manual resend — creates new DeliveryAttempt, does not reset status)
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<
  DocumentDeliveryStatus,
  ReadonlySet<DocumentDeliveryStatus>
> = new Map([
  [DocumentDeliveryStatus.PENDING, new Set([DocumentDeliveryStatus.QUEUED])],
  [DocumentDeliveryStatus.QUEUED, new Set([DocumentDeliveryStatus.SENDING])],
  [
    DocumentDeliveryStatus.SENDING,
    new Set([
      DocumentDeliveryStatus.DELIVERED,
      DocumentDeliveryStatus.RETRY_PENDING,
      DocumentDeliveryStatus.FAILED,
      DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED,
    ]),
  ],
  [
    DocumentDeliveryStatus.RETRY_PENDING,
    new Set([DocumentDeliveryStatus.QUEUED, DocumentDeliveryStatus.FAILED]),
  ],
  [DocumentDeliveryStatus.FAILED, new Set([DocumentDeliveryStatus.QUEUED])],
  [DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED, new Set([DocumentDeliveryStatus.QUEUED])],
  [
    // Manual resend after DELIVERED creates a new DeliveryAttempt.
    // The DocumentDelivery row itself transitions back to QUEUED only if
    // a new resend is explicitly requested. Stale workers must never do this.
    DocumentDeliveryStatus.DELIVERED,
    new Set([DocumentDeliveryStatus.QUEUED]),
  ],
  [DocumentDeliveryStatus.CANCELLED, new Set<DocumentDeliveryStatus>()],
]);

/** Terminal states that stale workers must not overwrite. */
const TERMINAL_STATES = new Set<DocumentDeliveryStatus>([DocumentDeliveryStatus.DELIVERED]);

export class DocumentDeliveryStateMachine {
  /**
   * Evaluate whether a transition from `current` to `next` is allowed.
   *
   * @param kind - delivery kind (for diagnostic context; transitions are identical per kind)
   * @param current - current DocumentDeliveryStatus
   * @param next - desired next DocumentDeliveryStatus
   * @returns TransitionResult
   *
   * Does NOT write to any database. Does NOT modify FiscalDocument.status.
   */
  static evaluateTransition(
    _kind: DocumentDeliveryKind,
    current: DocumentDeliveryStatus,
    next: DocumentDeliveryStatus,
  ): TransitionResult {
    // Stale terminal regression guard: DELIVERED must not become anything else
    // because a stale worker finished late.
    if (TERMINAL_STATES.has(current)) {
      if (
        next !== DocumentDeliveryStatus.QUEUED ||
        // Allow DELIVERED → QUEUED only when it is an explicit manual-resend call,
        // which is enforced in DeliveryRequestService, not here.
        // From the worker perspective, DELIVERED is always stale-terminal.
        true
      ) {
        return {
          outcome: 'IGNORED_STALE_TERMINAL',
          reason: `Delivery is in terminal state ${current}; transition to ${next} ignored.`,
        };
      }
    }

    const allowed = ALLOWED_TRANSITIONS.get(current);
    if (!allowed || !allowed.has(next)) {
      return {
        outcome: 'REJECTED',
        reason: `Transition from ${current} to ${next} is not allowed in delivery state machine.`,
      };
    }

    return { outcome: 'ALLOWED' };
  }

  /**
   * Evaluate whether a manual resend is allowed for a delivery.
   * Manual resend creates a new DeliveryAttempt. It is allowed from any
   * non-CANCELLED state and is the only way to advance from DELIVERED back to QUEUED.
   */
  static canManualResend(current: DocumentDeliveryStatus): boolean {
    return current !== DocumentDeliveryStatus.CANCELLED;
  }
}
