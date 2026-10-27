import { timingSafeEqual } from 'crypto';
import { FiscalEnvironmentV2 } from './consumer-v2.policy';

/** Contract evaluation only. No reservation writer or fiscal operation is registered. */
export type ConsumerV2Operation = 'CREATE_INVOICE';
export type ConsumerV2ReservationState =
  'RESERVED' | 'COMMITTED' | 'RECOVERY_REQUIRED' | 'ABORTED_BEFORE_ALLOCATION';

export interface ConsumerV2Reservation {
  associationId: string;
  environment: FiscalEnvironmentV2;
  operation: ConsumerV2Operation;
  idempotencyKey: string;
  requestHashVersion: string;
  requestHash: string;
  state: ConsumerV2ReservationState;
  fiscalDocumentId?: string | null;
}

export interface ConsumerV2OperationIdentity {
  associationId: string;
  environment: FiscalEnvironmentV2;
  operation: ConsumerV2Operation;
  idempotencyKey: string;
  requestHashVersion: string;
  requestHash: string;
}

function sameNamespace(
  query: ConsumerV2OperationIdentity,
  reservation: ConsumerV2Reservation,
): boolean {
  return (
    query.associationId === reservation.associationId &&
    query.environment === reservation.environment &&
    query.operation === reservation.operation &&
    query.idempotencyKey === reservation.idempotencyKey
  );
}

function sameHash(query: ConsumerV2OperationIdentity, reservation: ConsumerV2Reservation): boolean {
  if (!query.requestHashVersion || query.requestHashVersion !== reservation.requestHashVersion)
    return false;
  if (
    !/^[a-f\d]{64}$/i.test(query.requestHash) ||
    !/^[a-f\d]{64}$/i.test(reservation.requestHash)
  ) {
    return false;
  }
  const received = Buffer.from(query.requestHash.toLowerCase(), 'hex');
  const stored = Buffer.from(reservation.requestHash.toLowerCase(), 'hex');
  return timingSafeEqual(received, stored);
}

export type ConsumerV2LookupDecision =
  | { status: 404; code: 'FISCAL_OPERATION_NOT_FOUND' }
  | { status: 409; code: 'FISCAL_OPERATION_INTEGRITY_ERROR' }
  | {
      status: 200 | 202;
      state: ConsumerV2ReservationState;
      fiscalDocumentId: string | null;
      retryAfterSeconds?: number;
    };

export function evaluateConsumerV2Lookup(input: {
  query: ConsumerV2OperationIdentity;
  reservation: ConsumerV2Reservation | null;
  retryAfterSeconds: number;
}): ConsumerV2LookupDecision {
  const { reservation, query } = input;
  if (!reservation || !sameNamespace(query, reservation) || !sameHash(query, reservation)) {
    return { status: 404, code: 'FISCAL_OPERATION_NOT_FOUND' };
  }
  if (reservation.state === 'COMMITTED' && !reservation.fiscalDocumentId) {
    return { status: 409, code: 'FISCAL_OPERATION_INTEGRITY_ERROR' };
  }
  if (reservation.state === 'RESERVED' && reservation.fiscalDocumentId) {
    return { status: 409, code: 'FISCAL_OPERATION_INTEGRITY_ERROR' };
  }
  if (reservation.state === 'ABORTED_BEFORE_ALLOCATION' && reservation.fiscalDocumentId) {
    return { status: 409, code: 'FISCAL_OPERATION_INTEGRITY_ERROR' };
  }
  if (reservation.state === 'RESERVED' || reservation.state === 'RECOVERY_REQUIRED') {
    return {
      status: 202,
      state: reservation.state,
      fiscalDocumentId: reservation.fiscalDocumentId ?? null,
      retryAfterSeconds: Math.max(1, Math.trunc(input.retryAfterSeconds) || 1),
    };
  }
  return {
    status: 200,
    state: reservation.state,
    fiscalDocumentId: reservation.fiscalDocumentId ?? null,
  };
}

/** Creation replay contract, without allocation or persistence. */
export function evaluateConsumerV2Replay(
  query: ConsumerV2OperationIdentity,
  reservation: ConsumerV2Reservation | null,
): 'NEW' | 'SAME' | 'CONFLICT' {
  if (!reservation || !sameNamespace(query, reservation)) return 'NEW';
  return sameHash(query, reservation) ? 'SAME' : 'CONFLICT';
}
