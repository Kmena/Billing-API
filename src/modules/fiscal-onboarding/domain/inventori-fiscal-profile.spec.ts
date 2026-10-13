import {
  INVENTORI_FISCAL_PROFILE,
  INVENTORI_FISCAL_V1_SCOPES,
  scopesForIntegrationProfile,
} from './inventori-fiscal-profile';

describe('inventori-fiscal-v1 capability profile', () => {
  it('publishes the complete company-scoped fiscal capability catalog', () => {
    expect(scopesForIntegrationProfile(INVENTORI_FISCAL_PROFILE)).toEqual([
      ...INVENTORI_FISCAL_V1_SCOPES,
    ]);
    expect(INVENTORI_FISCAL_V1_SCOPES).toEqual(
      expect.arrayContaining([
        'fiscal-issuer:write',
        'fiscal-profile:write',
        'fiscal-activities:write',
        'fiscal-credentials:write',
        'fiscal-certificates:write',
        'fiscal-issuance-points:write',
        'fiscal-sequences:write',
        'fiscal-readiness:read',
        'fiscal-deliveries:resend',
      ]),
    );
  });

  it('never grants bootstrap, key administration, or JWT authority', () => {
    expect(INVENTORI_FISCAL_V1_SCOPES).not.toContain('api-keys:write');
    expect(INVENTORI_FISCAL_V1_SCOPES).not.toContain('tenant:admin');
    expect(INVENTORI_FISCAL_V1_SCOPES.some((scope) => scope.includes('bootstrap'))).toBe(false);
  });

  it('rejects unknown profile versions and returns a defensive scope copy', () => {
    expect(() => scopesForIntegrationProfile('inventori-fiscal-v2')).toThrow(
      'UNSUPPORTED_INTEGRATION_PROFILE',
    );
    const first = scopesForIntegrationProfile(INVENTORI_FISCAL_PROFILE);
    first.pop();
    expect(scopesForIntegrationProfile(INVENTORI_FISCAL_PROFILE)).toHaveLength(
      INVENTORI_FISCAL_V1_SCOPES.length,
    );
  });
});
