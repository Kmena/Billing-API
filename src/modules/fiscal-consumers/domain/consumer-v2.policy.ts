/** W1 policy used only by the isolated laboratory module. */
export const BILLING_CONSUMER_V2_PROFILE = 'billing-consumer-v2' as const;
/** Issued by a Billing administrator for one company and SANDBOX only. */
export const AFFILIATIONS_ENROLLMENT_V2_PROFILE = 'affiliations-enrollment-v2' as const;
export const CONSUMER_V2_ASSOCIATION_CONTRACT = 'fiscal-consumer-v2' as const;
export const CONSUMER_V2_W1_SCOPES = [
  'fiscal-v2:readiness:read',
  'fiscal-v2:operations:read',
] as const;
export const CONSUMER_V2_LAB_SCOPES = [
  ...CONSUMER_V2_W1_SCOPES,
  'fiscal-v2:invoices:create',
  'fiscal-v2:invoices:submit',
  'fiscal-v2:tickets:create',
  'fiscal-v2:credit-notes:create',
  'fiscal-v2:debit-notes:create',
  'fiscal-v2:onboarding:read',
  'fiscal-v2:onboarding:issuer:write',
  'fiscal-v2:onboarding:profile:write',
  'fiscal-v2:onboarding:activity:write',
  'fiscal-v2:onboarding:association:write',
  'fiscal-v2:onboarding:certificate:write',
  'fiscal-v2:onboarding:credentials:write',
  'fiscal-v2:onboarding:recovery:write',
  'fiscal-v2:onboarding:issuance-point:write',
  'fiscal-v2:onboarding:connection:test',
  'fiscal-v2:onboarding:audit:read',
  'fiscal-v2:onboarding:request',
] as const;
export const AFFILIATIONS_ENROLLMENT_V2_SCOPES = [
  'fiscal-v2:onboarding:request',
  'fiscal-v2:onboarding:read',
  'fiscal-v2:onboarding:issuer:write',
  'fiscal-v2:onboarding:association:write',
  'fiscal-v2:onboarding:certificate:write',
  'fiscal-v2:onboarding:credentials:write',
  'fiscal-v2:onboarding:recovery:write',
  'fiscal-v2:onboarding:issuance-point:write',
  'fiscal-v2:onboarding:connection:test',
  'fiscal-v2:onboarding:audit:read',
] as const;
export const AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES = [
  'fiscal-v2:onboarding:profile:write',
  'fiscal-v2:onboarding:activity:write',
] as const;
/** Explicit rotation option for synthetic membership invoices in SANDBOX only. */
export const AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES = [
  'fiscal-v2:operations:read',
  'fiscal-v2:invoices:create',
  'fiscal-v2:invoices:submit',
] as const;

/** Preserve existing enrollment keys while permitting only these two audited additions. */
export function hasEnrollmentV2Scopes(scopes: readonly string[]): boolean {
  return (
    new Set(scopes).size === scopes.length &&
    AFFILIATIONS_ENROLLMENT_V2_SCOPES.every((scope) => scopes.includes(scope)) &&
    (AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES.every((scope) => scopes.includes(scope)) ||
      AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES.every((scope) => !scopes.includes(scope))) &&
    scopes.every(
      (scope) =>
        AFFILIATIONS_ENROLLMENT_V2_SCOPES.includes(
          scope as (typeof AFFILIATIONS_ENROLLMENT_V2_SCOPES)[number],
        ) ||
        AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES.includes(
          scope as (typeof AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES)[number],
        ) ||
        AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES.includes(
          scope as (typeof AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES)[number],
        ),
    )
  );
}
export type ConsumerV2Scope = (typeof CONSUMER_V2_LAB_SCOPES)[number];
export type FiscalEnvironmentV2 = 'SANDBOX' | 'PRODUCTION';

export function hasOnlyW1ConsumerScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length > 0 &&
    new Set(scopes).size === scopes.length &&
    scopes.every((scope) =>
      CONSUMER_V2_W1_SCOPES.includes(scope as (typeof CONSUMER_V2_W1_SCOPES)[number]),
    )
  );
}

/** Additional scope exists only in the unregistered laboratory module. */
export function hasOnlyLabConsumerScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length > 0 &&
    new Set(scopes).size === scopes.length &&
    scopes.every((scope) => CONSUMER_V2_LAB_SCOPES.includes(scope as ConsumerV2Scope))
  );
}

export interface ConsumerV2Key {
  id: string;
  tenantId: string;
  environment: 'TEST' | 'LIVE';
  integrationProfile?: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt?: Date | null;
  scopes: readonly string[];
}

export interface ConsumerV2Binding {
  apiKeyId: string;
  tenantId: string;
  associationId: string;
}

export interface ConsumerV2Association {
  id: string;
  tenantId: string;
  consumerId: string;
  companyId: string;
  environment: FiscalEnvironmentV2;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface ConsumerV2Identity {
  id: string;
  tenantId: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface ConsumerV2Company {
  id: string;
  tenantId: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export type ConsumerV2Authorization =
  | {
      allowed: true;
      principal: {
        tenantId: string;
        consumerId: string;
        associationId: string;
        companyId: string;
        environment: FiscalEnvironmentV2;
        apiKeyId: string;
      };
    }
  | { allowed: false; status: 401 | 403 | 404; code: string };

const deny = (status: 401 | 403 | 404, code: string): ConsumerV2Authorization => ({
  allowed: false,
  status,
  code,
});

/** Pure authorization over trusted, already-loaded records. Persistence is a later gate. */
export function authorizeConsumerV2(input: {
  key: ConsumerV2Key | null;
  binding: ConsumerV2Binding | null;
  association: ConsumerV2Association | null;
  consumer: ConsumerV2Identity | null;
  requestedCompany: ConsumerV2Company | null;
  requestedCompanyId: string;
  requestedEnvironment: FiscalEnvironmentV2;
  requiredScope: ConsumerV2Scope;
  now: Date;
  tenantActive?: boolean;
  grantCompanyIds?: readonly string[];
}): ConsumerV2Authorization {
  const { key, binding, association, consumer, requestedCompany } = input;
  if (!key || key.status !== 'ACTIVE' || !key.expiresAt || key.expiresAt <= input.now) {
    return deny(401, 'CONSUMER_KEY_UNAUTHORIZED');
  }
  if (input.tenantActive === false) return deny(403, 'CONSUMER_TENANT_INACTIVE');
  if (
    key.integrationProfile !== BILLING_CONSUMER_V2_PROFILE &&
    key.integrationProfile !== AFFILIATIONS_ENROLLMENT_V2_PROFILE
  ) {
    return deny(403, 'INTEGRATION_PROFILE_NOT_AUTHORIZED');
  }
  if (
    key.integrationProfile === AFFILIATIONS_ENROLLMENT_V2_PROFILE &&
    (!hasEnrollmentV2Scopes(key.scopes) ||
      input.grantCompanyIds?.length !== 1 ||
      input.grantCompanyIds[0] !== input.requestedCompanyId)
  ) {
    return deny(403, 'INTEGRATION_PROFILE_NOT_AUTHORIZED');
  }
  if (!binding || binding.apiKeyId !== key.id) return deny(403, 'CONSUMER_BINDING_REQUIRED');
  if (!association || association.id !== binding.associationId || !consumer) {
    return deny(403, 'CONSUMER_ASSOCIATION_INACTIVE');
  }
  if (
    binding.tenantId !== key.tenantId ||
    association.tenantId !== key.tenantId ||
    consumer.tenantId !== key.tenantId ||
    association.consumerId !== consumer.id
  ) {
    return deny(404, 'CONSUMER_RESOURCE_NOT_FOUND');
  }
  if (!requestedCompany || requestedCompany.tenantId !== key.tenantId) {
    return deny(404, 'CONSUMER_RESOURCE_NOT_FOUND');
  }
  if (requestedCompany.id !== input.requestedCompanyId) {
    return deny(404, 'CONSUMER_RESOURCE_NOT_FOUND');
  }
  if (
    requestedCompany.status !== 'ACTIVE' ||
    consumer.status !== 'ACTIVE' ||
    association.status !== 'ACTIVE'
  ) {
    return deny(403, 'CONSUMER_ASSOCIATION_INACTIVE');
  }
  if (association.companyId !== input.requestedCompanyId) {
    return deny(403, 'CONSUMER_COMPANY_NOT_AUTHORIZED');
  }
  const keyEnvironment = key.environment === 'TEST' ? 'SANDBOX' : 'PRODUCTION';
  if (
    keyEnvironment !== input.requestedEnvironment ||
    association.environment !== input.requestedEnvironment
  ) {
    return deny(403, 'CONSUMER_ENVIRONMENT_NOT_AUTHORIZED');
  }
  if (!hasOnlyLabConsumerScopes(key.scopes) || !key.scopes.includes(input.requiredScope)) {
    return deny(403, 'INSUFFICIENT_SCOPE');
  }
  return {
    allowed: true,
    principal: {
      tenantId: key.tenantId,
      consumerId: consumer.id,
      associationId: association.id,
      companyId: association.companyId,
      environment: association.environment,
      apiKeyId: key.id,
    },
  };
}

/** Rotation interval is configurable; 90 days is the initial reference, not an expiry grant. */
export const INITIAL_ROTATION_REFERENCE_DAYS = 90;
/** Conservative laboratory ceiling; operational duration still requires Security approval. */
export const MAX_CONSUMER_V2_LAB_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

export function nextConsumerRotationDueAt(
  issuedAt: Date,
  intervalDays = INITIAL_ROTATION_REFERENCE_DAYS,
): Date {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error('CONSUMER_ROTATION_INTERVAL_INVALID');
  }
  return new Date(issuedAt.getTime() + intervalDays * 86_400_000);
}

export function evaluateConsumerKeyIssue(input: {
  activeKeys: readonly { id: string; expiresAt: Date }[];
  now: Date;
  rotation?: { endsAt: Date };
}): { allowed: true } | { allowed: false; code: string } {
  const active = input.activeKeys.filter((key) => key.expiresAt > input.now);
  if (active.length > 2) return { allowed: false, code: 'CONSUMER_KEY_LIMIT_EXCEEDED' };
  if (!input.rotation) {
    return active.length === 0
      ? { allowed: true }
      : { allowed: false, code: 'CONSUMER_ROTATION_REQUIRED' };
  }
  if (input.rotation.endsAt <= input.now) {
    return { allowed: false, code: 'CONSUMER_ROTATION_WINDOW_EXPIRED' };
  }
  if (
    input.rotation.endsAt.getTime() - input.now.getTime() >
    MAX_CONSUMER_V2_LAB_ROTATION_OVERLAP_MS
  ) {
    return { allowed: false, code: 'CONSUMER_ROTATION_WINDOW_TOO_LONG' };
  }
  return active.length === 1
    ? { allowed: true }
    : { allowed: false, code: 'CONSUMER_KEY_LIMIT_EXCEEDED' };
}

/** Decision for a future transactional writer; no row is changed here. */
export function evaluateConsumerKeyRevocation(input: {
  key: Pick<ConsumerV2Key, 'id' | 'tenantId' | 'status'> | null;
  binding: ConsumerV2Binding | null;
  association: Pick<ConsumerV2Association, 'id' | 'tenantId'>;
}):
  | { allowed: false; status: 404; code: 'CONSUMER_KEY_NOT_FOUND' }
  | { allowed: true; action: 'REVOKE' | 'ALREADY_REVOKED' } {
  const { key, binding, association } = input;
  if (
    !key ||
    !binding ||
    key.id !== binding.apiKeyId ||
    key.tenantId !== association.tenantId ||
    binding.tenantId !== association.tenantId ||
    binding.associationId !== association.id
  ) {
    return { allowed: false, status: 404, code: 'CONSUMER_KEY_NOT_FOUND' };
  }
  return { allowed: true, action: key.status === 'REVOKED' ? 'ALREADY_REVOKED' : 'REVOKE' };
}

export interface ConsumerV2AuditEvent {
  action:
    | 'consumer.registered'
    | 'association.created'
    | 'association.suspended'
    | 'key.issued'
    | 'key.rotated'
    | 'key.revoked'
    | 'operation.lookup';
  tenantId: string;
  consumerId: string;
  associationId: string;
  apiKeyId?: string;
  correlationId: string;
}

/** Explicit projection prevents accidental persistence of raw keys or payloads. */
export function consumerV2AuditEvent(input: ConsumerV2AuditEvent): ConsumerV2AuditEvent {
  return {
    action: input.action,
    tenantId: input.tenantId,
    consumerId: input.consumerId,
    associationId: input.associationId,
    ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
    correlationId: input.correlationId,
  };
}

/** Future mutation services must write this event in the same DB transaction. */
export interface ConsumerV2TransactionalAuditPort {
  recordInTransaction(event: ConsumerV2AuditEvent): Promise<void>;
}
