import {
  ConsumerV2OperationIdentity,
  ConsumerV2Reservation,
  evaluateConsumerV2Lookup,
  evaluateConsumerV2Replay,
} from '../consumer-v2-idempotency.policy';

const hash = 'a'.repeat(64);
const query: ConsumerV2OperationIdentity = {
  associationId: 'association-1',
  environment: 'SANDBOX',
  operation: 'CREATE_INVOICE',
  idempotencyKey: 'invoice-1',
  requestHashVersion: 'sha256-canonical-v1',
  requestHash: hash,
};
const reservation: ConsumerV2Reservation = {
  ...query,
  state: 'COMMITTED',
  fiscalDocumentId: 'document-1',
};
const lookup = (q = query, r: ConsumerV2Reservation | null = reservation) =>
  evaluateConsumerV2Lookup({ query: q, reservation: r, retryAfterSeconds: 3 });

describe('W1-D1 pure idempotency and hash-bound lookup', () => {
  it('returns 404 for absent, foreign namespace, absent or discrepant hash', () => {
    expect(lookup(query, null)).toEqual({ status: 404, code: 'FISCAL_OPERATION_NOT_FOUND' });
    for (const change of [
      { associationId: 'association-2' },
      { environment: 'PRODUCTION' as const },
      { idempotencyKey: 'invoice-2' },
      { requestHashVersion: 'other-version' },
      { requestHashVersion: '' },
      { requestHash: 'b'.repeat(64) },
      { requestHash: '' },
    ]) {
      expect(lookup({ ...query, ...change })).toEqual({
        status: 404,
        code: 'FISCAL_OPERATION_NOT_FOUND',
      });
    }
  });

  it('returns 202 for pending recovery, 200 for terminal states, and 409 for corrupt records', () => {
    for (const state of ['RESERVED', 'RECOVERY_REQUIRED'] as const) {
      expect(lookup(query, { ...reservation, state, fiscalDocumentId: null })).toEqual({
        status: 202,
        state,
        fiscalDocumentId: null,
        retryAfterSeconds: 3,
      });
    }
    expect(lookup()).toEqual({ status: 200, state: 'COMMITTED', fiscalDocumentId: 'document-1' });
    expect(
      lookup(query, { ...reservation, state: 'ABORTED_BEFORE_ALLOCATION', fiscalDocumentId: null }),
    ).toEqual({
      status: 200,
      state: 'ABORTED_BEFORE_ALLOCATION',
      fiscalDocumentId: null,
    });
    expect(lookup(query, { ...reservation, fiscalDocumentId: null })).toEqual({
      status: 409,
      code: 'FISCAL_OPERATION_INTEGRITY_ERROR',
    });
    expect(lookup(query, { ...reservation, state: 'RESERVED' })).toEqual({
      status: 409,
      code: 'FISCAL_OPERATION_INTEGRITY_ERROR',
    });
    expect(lookup(query, { ...reservation, state: 'ABORTED_BEFORE_ALLOCATION' })).toEqual({
      status: 409,
      code: 'FISCAL_OPERATION_INTEGRITY_ERROR',
    });
  });

  it('replay conflicts on hash mismatch and survives key rotation within the same association', () => {
    expect(evaluateConsumerV2Replay(query, null)).toBe('NEW');
    expect(evaluateConsumerV2Replay(query, reservation)).toBe('SAME');
    expect(evaluateConsumerV2Replay({ ...query, requestHash: 'b'.repeat(64) }, reservation)).toBe(
      'CONFLICT',
    );
    expect(
      evaluateConsumerV2Replay({ ...query, associationId: 'association-2' }, reservation),
    ).toBe('NEW');
    expect(Object.keys(query)).not.toContain('apiKeyId');
  });
});
