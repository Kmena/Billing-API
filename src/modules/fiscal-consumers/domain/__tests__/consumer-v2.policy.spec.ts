import {
  authorizeConsumerV2,
  BILLING_CONSUMER_V2_PROFILE,
  consumerV2AuditEvent,
  evaluateConsumerKeyIssue,
  evaluateConsumerKeyRevocation,
  hasOnlyW1ConsumerScopes,
  nextConsumerRotationDueAt,
} from '../consumer-v2.policy';

const now = new Date('2026-10-27T00:00:00.000Z');
const base = () => ({
  key: {
    id: 'key-1',
    tenantId: 'tenant-1',
    environment: 'TEST' as const,
    integrationProfile: BILLING_CONSUMER_V2_PROFILE,
    status: 'ACTIVE' as const,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    scopes: ['fiscal-v2:readiness:read', 'fiscal-v2:operations:read'],
  },
  binding: { apiKeyId: 'key-1', tenantId: 'tenant-1', associationId: 'association-1' },
  association: {
    id: 'association-1',
    tenantId: 'tenant-1',
    consumerId: 'consumer-1',
    companyId: 'company-1',
    environment: 'SANDBOX' as const,
    status: 'ACTIVE' as const,
  },
  consumer: { id: 'consumer-1', tenantId: 'tenant-1', status: 'ACTIVE' as const },
  requestedCompany: { id: 'company-1', tenantId: 'tenant-1', status: 'ACTIVE' as const },
  requestedCompanyId: 'company-1',
  requestedEnvironment: 'SANDBOX' as const,
  requiredScope: 'fiscal-v2:readiness:read' as const,
  now,
});

describe('W1-D1 isolated M2M authorization', () => {
  it('returns a constrained association principal for a valid synthetic binding', () => {
    expect(authorizeConsumerV2(base())).toEqual({
      allowed: true,
      principal: {
        tenantId: 'tenant-1',
        consumerId: 'consumer-1',
        associationId: 'association-1',
        companyId: 'company-1',
        environment: 'SANDBOX',
        apiKeyId: 'key-1',
      },
    });
  });

  it.each([
    ['absent key', (v: ReturnType<typeof base>) => ({ ...v, key: null }), 401],
    [
      'revoked key',
      (v: ReturnType<typeof base>) => ({ ...v, key: { ...v.key, status: 'REVOKED' } }),
      401,
    ],
    [
      'expired key',
      (v: ReturnType<typeof base>) => ({ ...v, key: { ...v.key, expiresAt: now } }),
      401,
    ],
    [
      'v1 profile',
      (v: ReturnType<typeof base>) => ({
        ...v,
        key: { ...v.key, integrationProfile: 'inventori-fiscal-v1' },
      }),
      403,
    ],
    ['missing binding', (v: ReturnType<typeof base>) => ({ ...v, binding: null }), 403],
    [
      'wrong key binding',
      (v: ReturnType<typeof base>) => ({ ...v, binding: { ...v.binding, apiKeyId: 'key-2' } }),
      403,
    ],
    [
      'wrong association',
      (v: ReturnType<typeof base>) => ({
        ...v,
        association: { ...v.association, id: 'association-2' },
      }),
      403,
    ],
    [
      'foreign tenant',
      (v: ReturnType<typeof base>) => ({
        ...v,
        association: { ...v.association, tenantId: 'tenant-2' },
      }),
      404,
    ],
    [
      'foreign company',
      (v: ReturnType<typeof base>) => ({
        ...v,
        requestedCompany: { ...v.requestedCompany, tenantId: 'tenant-2' },
      }),
      404,
    ],
    ['missing company', (v: ReturnType<typeof base>) => ({ ...v, requestedCompany: null }), 404],
    [
      'wrong company',
      (v: ReturnType<typeof base>) => ({
        ...v,
        requestedCompanyId: 'company-2',
        requestedCompany: { ...v.requestedCompany, id: 'company-2' },
      }),
      403,
    ],
    [
      'suspended consumer',
      (v: ReturnType<typeof base>) => ({ ...v, consumer: { ...v.consumer, status: 'SUSPENDED' } }),
      403,
    ],
    [
      'suspended association',
      (v: ReturnType<typeof base>) => ({
        ...v,
        association: { ...v.association, status: 'SUSPENDED' },
      }),
      403,
    ],
    [
      'suspended company',
      (v: ReturnType<typeof base>) => ({
        ...v,
        requestedCompany: { ...v.requestedCompany, status: 'SUSPENDED' },
      }),
      403,
    ],
    [
      'wrong requested environment',
      (v: ReturnType<typeof base>) => ({ ...v, requestedEnvironment: 'PRODUCTION' }),
      403,
    ],
    [
      'wrong key environment',
      (v: ReturnType<typeof base>) => ({ ...v, key: { ...v.key, environment: 'LIVE' } }),
      403,
    ],
    [
      'wrong association environment',
      (v: ReturnType<typeof base>) => ({
        ...v,
        association: { ...v.association, environment: 'PRODUCTION' },
      }),
      403,
    ],
    [
      'missing scope',
      (v: ReturnType<typeof base>) => ({
        ...v,
        key: { ...v.key, scopes: ['fiscal-v2:operations:read'] },
      }),
      403,
    ],
    [
      'legacy scope',
      (v: ReturnType<typeof base>) => ({ ...v, key: { ...v.key, scopes: ['invoices:write'] } }),
      403,
    ],
  ])('denies %s', (_name, change, status) => {
    expect(authorizeConsumerV2(change(base()) as ReturnType<typeof base>)).toMatchObject({
      allowed: false,
      status,
    });
  });

  it('accepts only distinct W1 scopes', () => {
    expect(hasOnlyW1ConsumerScopes(['fiscal-v2:operations:read'])).toBe(true);
    expect(hasOnlyW1ConsumerScopes([])).toBe(false);
    expect(
      hasOnlyW1ConsumerScopes(['fiscal-v2:operations:read', 'fiscal-v2:operations:read']),
    ).toBe(false);
    expect(hasOnlyW1ConsumerScopes(['invoices:write'])).toBe(false);
  });
});

describe('W1-D1 key lifecycle policy', () => {
  const key = { id: 'key-1', expiresAt: new Date('2027-01-01T00:00:00Z') };
  const rotation = { endsAt: new Date('2026-11-01T00:00:00Z') };

  it('allows one steady key and a second only in a live rotation window', () => {
    expect(evaluateConsumerKeyIssue({ activeKeys: [], now })).toEqual({ allowed: true });
    expect(evaluateConsumerKeyIssue({ activeKeys: [key], now })).toMatchObject({
      allowed: false,
      code: 'CONSUMER_ROTATION_REQUIRED',
    });
    expect(evaluateConsumerKeyIssue({ activeKeys: [key], now, rotation })).toEqual({
      allowed: true,
    });
    expect(evaluateConsumerKeyIssue({ activeKeys: [key, key], now, rotation })).toMatchObject({
      allowed: false,
      code: 'CONSUMER_KEY_LIMIT_EXCEEDED',
    });
    expect(
      evaluateConsumerKeyIssue({ activeKeys: [key], now, rotation: { endsAt: now } }),
    ).toMatchObject({ allowed: false, code: 'CONSUMER_ROTATION_WINDOW_EXPIRED' });
  });

  it('uses 90 days as a configurable reference only', () => {
    expect(nextConsumerRotationDueAt(now).toISOString()).toBe('2027-01-25T00:00:00.000Z');
    expect(nextConsumerRotationDueAt(now, 30).toISOString()).toBe('2026-11-26T00:00:00.000Z');
    expect(() => nextConsumerRotationDueAt(now, 0)).toThrow('CONSUMER_ROTATION_INTERVAL_INVALID');
  });

  it('revokes only a key bound to the selected association, and is idempotent', () => {
    const association = { id: 'association-1', tenantId: 'tenant-1' };
    const binding = { apiKeyId: 'key-1', tenantId: 'tenant-1', associationId: 'association-1' };
    const active = { id: 'key-1', tenantId: 'tenant-1', status: 'ACTIVE' as const };
    expect(evaluateConsumerKeyRevocation({ key: active, binding, association })).toEqual({
      allowed: true,
      action: 'REVOKE',
    });
    expect(
      evaluateConsumerKeyRevocation({
        key: { ...active, status: 'REVOKED' },
        binding,
        association,
      }),
    ).toEqual({
      allowed: true,
      action: 'ALREADY_REVOKED',
    });
    expect(
      evaluateConsumerKeyRevocation({
        key: active,
        binding: { ...binding, associationId: 'association-2' },
        association,
      }),
    ).toEqual({
      allowed: false,
      status: 404,
      code: 'CONSUMER_KEY_NOT_FOUND',
    });
  });

  it('projects audit metadata without secret or payload', () => {
    const event = {
      action: 'key.revoked' as const,
      tenantId: 'tenant-1',
      consumerId: 'consumer-1',
      associationId: 'association-1',
      apiKeyId: 'key-1',
      correlationId: 'trace-1',
      secret: 'never-record',
      payload: { taxpayer: 'private' },
    };
    expect(consumerV2AuditEvent(event)).toEqual({
      action: 'key.revoked',
      tenantId: 'tenant-1',
      consumerId: 'consumer-1',
      associationId: 'association-1',
      apiKeyId: 'key-1',
      correlationId: 'trace-1',
    });
  });
});
