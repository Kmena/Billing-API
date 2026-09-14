import {
  FISCAL_SUBMISSION_STATUSES,
  FiscalSubmissionStateMachine,
  type FiscalSubmissionStatus,
} from '../fiscal-submission-state-machine';

describe('FiscalSubmissionStateMachine', () => {
  const allowedTransitions: Array<[FiscalSubmissionStatus, FiscalSubmissionStatus]> = [
    ['REQUESTED', 'QUEUED'],
    ['QUEUED', 'SUBMITTING'],
    ['SUBMITTING', 'ACKNOWLEDGED'],
    ['SUBMITTING', 'ACCEPTED'],
    ['SUBMITTING', 'REJECTED'],
    ['SUBMITTING', 'POST_OUTCOME_UNKNOWN'],
    ['SUBMITTING', 'TECHNICAL_RETRY_PENDING'],
    ['SUBMITTING', 'MANUAL_REVIEW_REQUIRED'],
    ['POST_OUTCOME_UNKNOWN', 'PROCESSING'],
    ['POST_OUTCOME_UNKNOWN', 'ACCEPTED'],
    ['POST_OUTCOME_UNKNOWN', 'REJECTED'],
    ['POST_OUTCOME_UNKNOWN', 'MANUAL_REVIEW_REQUIRED'],
    ['ACKNOWLEDGED', 'PROCESSING'],
    ['ACKNOWLEDGED', 'ACCEPTED'],
    ['ACKNOWLEDGED', 'REJECTED'],
    ['ACKNOWLEDGED', 'TECHNICAL_RETRY_PENDING'],
    ['PROCESSING', 'ACCEPTED'],
    ['PROCESSING', 'REJECTED'],
    ['PROCESSING', 'TECHNICAL_RETRY_PENDING'],
    ['TECHNICAL_RETRY_PENDING', 'QUEUED'],
    ['MANUAL_REVIEW_REQUIRED', 'QUEUED'],
    ['MANUAL_REVIEW_REQUIRED', 'POST_OUTCOME_UNKNOWN'],
  ];

  it.each(allowedTransitions)('allows %s -> %s', (from, to) => {
    expect(FiscalSubmissionStateMachine.canTransition(from, to)).toBe(true);
    expect(FiscalSubmissionStateMachine.evaluateTransition(from, to)).toMatchObject({
      outcome: 'APPLIED',
      from,
      to,
    });
  });

  it.each(FISCAL_SUBMISSION_STATUSES)(
    'treats same-state %s transitions as idempotent',
    (status) => {
      expect(FiscalSubmissionStateMachine.canTransition(status, status)).toBe(true);
      expect(FiscalSubmissionStateMachine.evaluateTransition(status, status)).toMatchObject({
        outcome: 'APPLIED',
        from: status,
        to: status,
      });
    },
  );

  it.each([
    ['REQUESTED', 'SUBMITTING'],
    ['QUEUED', 'ACCEPTED'],
    ['ACKNOWLEDGED', 'POST_OUTCOME_UNKNOWN'],
    ['PROCESSING', 'POST_OUTCOME_UNKNOWN'],
    ['TECHNICAL_RETRY_PENDING', 'REJECTED'],
  ] satisfies Array<[FiscalSubmissionStatus, FiscalSubmissionStatus]>)(
    'rejects invalid %s -> %s',
    (from, to) => {
      expect(FiscalSubmissionStateMachine.canTransition(from, to)).toBe(false);
      expect(FiscalSubmissionStateMachine.evaluateTransition(from, to)).toMatchObject({
        outcome: 'REJECTED',
        from,
        to,
      });
    },
  );

  it.each([
    ['ACCEPTED', 'PROCESSING'],
    ['ACCEPTED', 'REJECTED'],
    ['REJECTED', 'PROCESSING'],
    ['REJECTED', 'ACCEPTED'],
  ] satisfies Array<[FiscalSubmissionStatus, FiscalSubmissionStatus]>)(
    'ignores stale terminal %s -> %s',
    (from, to) => {
      expect(FiscalSubmissionStateMachine.evaluateTransition(from, to)).toMatchObject({
        outcome: 'IGNORED_STALE_TERMINAL',
        from,
        to,
      });
    },
  );

  it('keeps technical failures separate from fiscal rejection', () => {
    expect(
      FiscalSubmissionStateMachine.canTransition('SUBMITTING', 'TECHNICAL_RETRY_PENDING'),
    ).toBe(true);
    expect(FiscalSubmissionStateMachine.canTransition('SUBMITTING', 'MANUAL_REVIEW_REQUIRED')).toBe(
      true,
    );
    expect(FiscalSubmissionStateMachine.isTerminal('TECHNICAL_RETRY_PENDING')).toBe(false);
    expect(FiscalSubmissionStateMachine.isTerminal('MANUAL_REVIEW_REQUIRED')).toBe(false);
  });

  it('models unknown POST outcome as non-terminal reconciliation state', () => {
    expect(FiscalSubmissionStateMachine.canTransition('SUBMITTING', 'POST_OUTCOME_UNKNOWN')).toBe(
      true,
    );
    expect(FiscalSubmissionStateMachine.isTerminal('POST_OUTCOME_UNKNOWN')).toBe(false);
    expect(FiscalSubmissionStateMachine.canTransition('POST_OUTCOME_UNKNOWN', 'PROCESSING')).toBe(
      true,
    );
    expect(FiscalSubmissionStateMachine.canTransition('POST_OUTCOME_UNKNOWN', 'ACCEPTED')).toBe(
      true,
    );
    expect(FiscalSubmissionStateMachine.canTransition('POST_OUTCOME_UNKNOWN', 'REJECTED')).toBe(
      true,
    );
  });

  it('throws when an invalid transition is asserted', () => {
    expect(() => FiscalSubmissionStateMachine.assertCanTransition('REQUESTED', 'ACCEPTED')).toThrow(
      'Transition is not allowed',
    );
  });
});
