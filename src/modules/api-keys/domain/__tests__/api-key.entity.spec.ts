import { ApiKey } from '../entities/api-key.entity';

function buildApiKey(overrides: Partial<Parameters<typeof ApiKey.reconstruct>[0]> = {}): ApiKey {
  return ApiKey.reconstruct({
    id: 'key-id-1',
    tenantId: 'tenant-id-1',
    name: 'Test Key',
    environment: 'LIVE',
    keyPrefix: 'a1b2c3d4',
    keyHash: '$argon2id$hashed',
    scopes: ['invoices:read'],
    status: 'ACTIVE',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

describe('ApiKey entity', () => {
  describe('initial state', () => {
    it('is created as ACTIVE', () => {
      const key = ApiKey.create(
        'key-id-1',
        'tenant-id-1',
        'Test Key',
        'LIVE',
        'a1b2c3d4',
        '$argon2id$hash',
        ['invoices:read'],
      );
      expect(key.status).toBe('ACTIVE');
      expect(key.isActive).toBe(true);
      expect(key.isRevoked).toBe(false);
    });
  });

  describe('revoke()', () => {
    it('sets status to REVOKED', () => {
      const key = buildApiKey();
      key.revoke('user-id-1');
      expect(key.status).toBe('REVOKED');
      expect(key.isRevoked).toBe(true);
      expect(key.revokedAt).toBeDefined();
      expect(key.revokedBy).toBe('user-id-1');
    });

    it('is idempotent — BR-005: revoking twice does not throw', () => {
      const key = buildApiKey();
      key.revoke('user-1');
      expect(() => key.revoke('user-2')).not.toThrow();
      // First revocation timestamp preserved
      expect(key.revokedBy).toBe('user-1');
    });
  });

  describe('isExpired', () => {
    it('returns false when expiresAt is in the future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const key = buildApiKey({ expiresAt: future });
      expect(key.isExpired).toBe(false);
    });

    it('returns true when expiresAt is in the past', () => {
      const past = new Date();
      past.setFullYear(past.getFullYear() - 1);
      const key = buildApiKey({ expiresAt: past });
      expect(key.isExpired).toBe(true);
    });

    it('returns false when no expiry is set', () => {
      const key = buildApiKey({ expiresAt: null });
      expect(key.isExpired).toBe(false);
    });
  });

  describe('scopes', () => {
    it('returns a copy of scopes array (immutable)', () => {
      const key = buildApiKey({ scopes: ['read', 'write'] });
      const scopes = key.scopes;
      scopes.push('admin');
      expect(key.scopes).toHaveLength(2); // Original unchanged
    });
  });
});
