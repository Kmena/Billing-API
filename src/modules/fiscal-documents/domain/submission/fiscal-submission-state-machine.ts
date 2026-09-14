export const FISCAL_SUBMISSION_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'SUBMITTING',
  'POST_OUTCOME_UNKNOWN',
  'ACKNOWLEDGED',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'TECHNICAL_RETRY_PENDING',
  'MANUAL_REVIEW_REQUIRED',
] as const;

export type FiscalSubmissionStatus = (typeof FISCAL_SUBMISSION_STATUSES)[number];

export type FiscalSubmissionTransitionOutcome = 'APPLIED' | 'REJECTED' | 'IGNORED_STALE_TERMINAL';

export interface FiscalSubmissionTransitionResult {
  readonly outcome: FiscalSubmissionTransitionOutcome;
  readonly from: FiscalSubmissionStatus;
  readonly to: FiscalSubmissionStatus;
  readonly reason: string;
}

const TERMINAL_STATUSES = new Set<FiscalSubmissionStatus>(['ACCEPTED', 'REJECTED']);

const ALLOWED_TRANSITIONS: ReadonlyMap<
  FiscalSubmissionStatus,
  ReadonlySet<FiscalSubmissionStatus>
> = new Map([
  ['REQUESTED', new Set(['QUEUED'])],
  ['QUEUED', new Set(['SUBMITTING'])],
  [
    'SUBMITTING',
    new Set([
      'ACKNOWLEDGED',
      'ACCEPTED',
      'REJECTED',
      'POST_OUTCOME_UNKNOWN',
      'TECHNICAL_RETRY_PENDING',
      'MANUAL_REVIEW_REQUIRED',
    ]),
  ],
  [
    'POST_OUTCOME_UNKNOWN',
    new Set(['PROCESSING', 'ACCEPTED', 'REJECTED', 'MANUAL_REVIEW_REQUIRED']),
  ],
  ['ACKNOWLEDGED', new Set(['PROCESSING', 'ACCEPTED', 'REJECTED', 'TECHNICAL_RETRY_PENDING'])],
  ['PROCESSING', new Set(['ACCEPTED', 'REJECTED', 'TECHNICAL_RETRY_PENDING'])],
  ['TECHNICAL_RETRY_PENDING', new Set(['QUEUED'])],
  ['MANUAL_REVIEW_REQUIRED', new Set(['QUEUED', 'POST_OUTCOME_UNKNOWN'])],
  ['ACCEPTED', new Set()],
  ['REJECTED', new Set()],
]);

export class FiscalSubmissionStateMachine {
  static isTerminal(status: FiscalSubmissionStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  static canTransition(from: FiscalSubmissionStatus, to: FiscalSubmissionStatus): boolean {
    if (from === to) {
      return true;
    }

    return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
  }

  static evaluateTransition(
    from: FiscalSubmissionStatus,
    to: FiscalSubmissionStatus,
  ): FiscalSubmissionTransitionResult {
    if (from === to) {
      return {
        outcome: 'APPLIED',
        from,
        to,
        reason: 'Idempotent transition to the same state.',
      };
    }

    if (this.isTerminal(from)) {
      return {
        outcome: 'IGNORED_STALE_TERMINAL',
        from,
        to,
        reason: 'Terminal fiscal submission status is monotonic and cannot regress.',
      };
    }

    if (this.canTransition(from, to)) {
      return {
        outcome: 'APPLIED',
        from,
        to,
        reason: 'Transition is allowed by the fiscal submission state machine.',
      };
    }

    return {
      outcome: 'REJECTED',
      from,
      to,
      reason: 'Transition is not allowed by the fiscal submission state machine.',
    };
  }

  static assertCanTransition(from: FiscalSubmissionStatus, to: FiscalSubmissionStatus): void {
    const result = this.evaluateTransition(from, to);

    if (result.outcome === 'APPLIED') {
      return;
    }

    throw new Error(result.reason);
  }
}
