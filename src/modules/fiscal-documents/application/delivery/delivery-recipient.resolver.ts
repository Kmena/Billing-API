import { Email } from '../../../identity/domain/value-objects/email.vo';

export type DeliveryRecipientResolution =
  | { readonly kind: 'RESOLVED'; readonly recipient: string }
  | {
      readonly kind: 'MISSING' | 'INVALID' | 'CONFLICT';
      readonly code:
        | 'FISCAL_DELIVERY_RECIPIENT_MISSING'
        | 'FISCAL_DELIVERY_RECIPIENT_INVALID'
        | 'FISCAL_DELIVERY_RECIPIENT_CONFLICT';
    };

type SnapshotEmail =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'VALID'; readonly value: string }
  | { readonly kind: 'INVALID' };

/**
 * Resolves the immutable fiscal receiver snapshot at the delivery boundary.
 *
 * `correoElectronico` is the delivery-era spelling; `email` is the original
 * creation and XML snapshot contract. A snapshot containing conflicting or
 * malformed supplied values must never select an arbitrary recipient.
 */
export function resolveDeliveryRecipient(receiverSnapshot: unknown): DeliveryRecipientResolution {
  if (receiverSnapshot === null || receiverSnapshot === undefined) {
    return missing();
  }
  if (typeof receiverSnapshot !== 'object' || Array.isArray(receiverSnapshot)) {
    return invalid();
  }

  const snapshot = receiverSnapshot as Record<string, unknown>;
  const canonical = normalizeSnapshotEmail(snapshot.correoElectronico);
  const legacy = normalizeSnapshotEmail(snapshot.email);

  if (canonical.kind === 'INVALID' || legacy.kind === 'INVALID') return invalid();
  if (canonical.kind === 'ABSENT' && legacy.kind === 'ABSENT') return missing();
  if (canonical.kind === 'ABSENT' && legacy.kind === 'VALID') return resolved(legacy.value);
  if (canonical.kind === 'VALID' && legacy.kind === 'ABSENT') return resolved(canonical.value);
  if (canonical.kind !== 'VALID' || legacy.kind !== 'VALID') return invalid();
  if (canonical.value !== legacy.value) return conflict();
  return resolved(canonical.value);
}

function normalizeSnapshotEmail(value: unknown): SnapshotEmail {
  if (value === null || value === undefined) return { kind: 'ABSENT' };
  if (typeof value !== 'string') return { kind: 'INVALID' };
  if (!value.trim()) return { kind: 'ABSENT' };

  try {
    return { kind: 'VALID', value: Email.create(value).value };
  } catch {
    return { kind: 'INVALID' };
  }
}

function resolved(recipient: string): DeliveryRecipientResolution {
  return { kind: 'RESOLVED', recipient };
}

function missing(): DeliveryRecipientResolution {
  return { kind: 'MISSING', code: 'FISCAL_DELIVERY_RECIPIENT_MISSING' };
}

function invalid(): DeliveryRecipientResolution {
  return { kind: 'INVALID', code: 'FISCAL_DELIVERY_RECIPIENT_INVALID' };
}

function conflict(): DeliveryRecipientResolution {
  return { kind: 'CONFLICT', code: 'FISCAL_DELIVERY_RECIPIENT_CONFLICT' };
}
