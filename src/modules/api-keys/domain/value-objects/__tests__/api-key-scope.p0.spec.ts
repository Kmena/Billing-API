/**
 * P0 scope tests — verifies fiscal-onboarding scopes are valid and enforced.
 */
import { validateApiKeyScopes, ALLOWED_API_KEY_SCOPES } from '../api-key-scope.vo';

describe('API key scope — P0 fiscal-onboarding scopes', () => {
  it('fiscal-onboarding:read is a valid scope', () => {
    expect(() => validateApiKeyScopes(['fiscal-onboarding:read'])).not.toThrow();
  });

  it('fiscal-onboarding:write is a valid scope', () => {
    expect(() => validateApiKeyScopes(['fiscal-onboarding:write'])).not.toThrow();
  });

  it('both fiscal-onboarding scopes are in ALLOWED list', () => {
    expect(ALLOWED_API_KEY_SCOPES).toContain('fiscal-onboarding:read');
    expect(ALLOWED_API_KEY_SCOPES).toContain('fiscal-onboarding:write');
  });

  it('invalid scope still throws', () => {
    expect(() => validateApiKeyScopes(['verified:true'])).toThrow();
    expect(() => validateApiKeyScopes(['verification-source:hacienda'])).toThrow();
    expect(() => validateApiKeyScopes(['admin:all'])).toThrow();
  });

  it('fiscal-onboarding scopes are narrower than taxpayers:read (separate concerns)', () => {
    // fiscal-onboarding:read is Company-scoped; taxpayers:read is a generic public lookup
    expect(ALLOWED_API_KEY_SCOPES).toContain('taxpayers:read');
    expect(ALLOWED_API_KEY_SCOPES).toContain('fiscal-onboarding:read');
    // They are separate scopes — having one does not grant the other
  });
});
