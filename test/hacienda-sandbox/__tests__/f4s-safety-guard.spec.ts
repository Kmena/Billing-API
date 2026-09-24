/**
 * TASK-004 — F4-S Safety Guard tests
 *
 * Validates that the safety guard correctly:
 *   - Allows only the approved sandbox endpoints
 *   - Rejects production URLs (always)
 *   - Rejects the old repository sandbox URL
 *   - Rejects hostname suffix / subdomain attacks
 *   - Rejects userinfo URL tricks
 *   - Rejects unexpected ports
 *   - Rejects HTTP (non-HTTPS)
 *   - Rejects unknown hostnames
 *   - Rejects mixed sandbox/production configuration
 *   - Rejects production client ID
 */

import {
  validateReceptionUrl,
  validateTokenUrl,
  validateClientId,
  validateF4sEndpoints,
  allGuardResultsPass,
  F4S_ALLOWED_RECEPTION_URL,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';

// ── Reception URL tests ───────────────────────────────────────────────────────

describe('validateReceptionUrl', () => {
  describe('PASS — approved sandbox endpoint', () => {
    it('passes the PRIMARY_RUNTIME_CANDIDATE without trailing slash', () => {
      const result = validateReceptionUrl(F4S_ALLOWED_RECEPTION_URL);
      expect(result.status).toBe('PASS');
      expect(result.code).toBe('RECEPTION_URL_APPROVED');
    });

    it('passes the PRIMARY_RUNTIME_CANDIDATE with trailing slash (normalized)', () => {
      const result = validateReceptionUrl(`${F4S_ALLOWED_RECEPTION_URL}/`);
      expect(result.status).toBe('PASS');
    });
  });

  describe('FAIL — production URL (always denied)', () => {
    it('rejects the production reception URL', () => {
      const result = validateReceptionUrl(
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('PRODUCTION_HOST_DETECTED');
    });

    it('rejects any path on the production hostname', () => {
      const result = validateReceptionUrl('https://api.comprobanteselectronicos.go.cr/anything');
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('PRODUCTION_HOST_DETECTED');
    });
  });

  describe('FAIL — old repository sandbox URL (NOT in F4-S allowlist)', () => {
    it('rejects the old repository-default sandbox URL on the api. hostname', () => {
      const result = validateReceptionUrl(
        'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      // Old sandbox URL lives on the production host — blocked by PRODUCTION_HOST_DETECTED
      expect(result.code).toBe('PRODUCTION_HOST_DETECTED');
    });
  });

  describe('FAIL — hostname suffix / subdomain attacks', () => {
    it('rejects api.comprobanteselectronicos.go.cr.attacker.com', () => {
      const result = validateReceptionUrl(
        'https://api.comprobanteselectronicos.go.cr.attacker.com/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(['HOSTNAME_SUFFIX_ATTACK', 'UNKNOWN_RECEPTION_HOST']).toContain(result.code);
    });

    it('rejects api-sandbox.comprobanteselectronicos.go.cr.evil.com', () => {
      const result = validateReceptionUrl(
        'https://api-sandbox.comprobanteselectronicos.go.cr.evil.com/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(['HOSTNAME_SUFFIX_ATTACK', 'UNKNOWN_RECEPTION_HOST']).toContain(result.code);
    });

    it('rejects evil-api-sandbox.comprobanteselectronicos.go.cr', () => {
      const result = validateReceptionUrl(
        'https://evil-api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });

    it('rejects spoofed sandbox host with query tricks', () => {
      const result = validateReceptionUrl(
        'https://api-sandbox.comprobanteselectronicos.go.cr.attacker.io/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });
  });

  describe('FAIL — userinfo URL attack', () => {
    it('rejects URL with userinfo (user:pass@host)', () => {
      const result = validateReceptionUrl(
        'https://user:pass@api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('USERINFO_IN_URL');
    });

    it('rejects URL with only username in userinfo', () => {
      const result = validateReceptionUrl(
        'https://user@api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });
  });

  describe('FAIL — unexpected port', () => {
    it('rejects explicit port 443', () => {
      const result = validateReceptionUrl(
        'https://api-sandbox.comprobanteselectronicos.go.cr:443/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('UNEXPECTED_PORT');
    });

    it('rejects arbitrary port', () => {
      const result = validateReceptionUrl(
        'https://api-sandbox.comprobanteselectronicos.go.cr:8443/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('UNEXPECTED_PORT');
    });
  });

  describe('FAIL — non-HTTPS protocol', () => {
    it('rejects http://', () => {
      const result = validateReceptionUrl(
        'http://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('INSECURE_PROTOCOL');
    });

    it('rejects ftp://', () => {
      const result = validateReceptionUrl(
        'ftp://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });
  });

  describe('FAIL — unknown hostname', () => {
    it('rejects attacker.com', () => {
      const result = validateReceptionUrl('https://attacker.com/recepcion/v1');
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });

    it('rejects empty URL', () => {
      const result = validateReceptionUrl('');
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });

    it('rejects invalid URL format', () => {
      const result = validateReceptionUrl('not-a-url');
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
    });
  });

  describe('FAIL — wrong path on sandbox host', () => {
    it('rejects sandbox host with wrong path', () => {
      const result = validateReceptionUrl(
        'https://api-sandbox.comprobanteselectronicos.go.cr/wrong/path',
      );
      expect(result.status).toBe('FAIL_SECURITY_GUARD');
      expect(result.code).toBe('INVALID_RECEPTION_PATH');
    });
  });
});

// ── Token URL tests ───────────────────────────────────────────────────────────

describe('validateTokenUrl', () => {
  it('passes the verified sandbox token URL', () => {
    const result = validateTokenUrl(F4S_ALLOWED_TOKEN_URL);
    expect(result.status).toBe('PASS');
  });

  it('rejects the production token URL', () => {
    const result = validateTokenUrl(
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    );
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('PRODUCTION_REALM_IN_TOKEN_URL');
  });

  it('rejects unknown token host', () => {
    const result = validateTokenUrl('https://attacker.com/auth/realms/rut-stag/token');
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('UNKNOWN_TOKEN_HOST');
  });

  it('rejects IDP hostname suffix attack (idp.host.attacker.com)', () => {
    // Previously dead code — fixed by moving suffix check before hostname equality check
    const result = validateTokenUrl(
      'https://idp.comprobanteselectronicos.go.cr.attacker.com/auth/realms/rut-stag/protocol/openid-connect/token',
    );
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('HOSTNAME_SUFFIX_ATTACK');
  });

  it('rejects spoofed IDP with suffix (evil-idp.comprobanteselectronicos.go.cr)', () => {
    // isHostnameSuffixAttack detects substring match: includes(legitimateHostname)
    const result = validateTokenUrl(
      'https://evil-idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    );
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    // evil-idp.comprobanteselectronicos.go.cr includes idp.comprobanteselectronicos.go.cr → HOSTNAME_SUFFIX_ATTACK
    expect(['HOSTNAME_SUFFIX_ATTACK', 'UNKNOWN_TOKEN_HOST']).toContain(result.code);
  });

  it('rejects HTTP token URL', () => {
    const result = validateTokenUrl(
      'http://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    );
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('INSECURE_PROTOCOL');
  });

  it('rejects token URL with unexpected port', () => {
    const result = validateTokenUrl(
      'https://idp.comprobanteselectronicos.go.cr:9443/auth/realms/rut-stag/protocol/openid-connect/token',
    );
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('UNEXPECTED_PORT');
  });
});

// ── Client ID tests ───────────────────────────────────────────────────────────

describe('validateClientId', () => {
  it('passes api-stag', () => {
    const result = validateClientId(F4S_ALLOWED_CLIENT_ID);
    expect(result.status).toBe('PASS');
  });

  it('rejects api-prod (production client ID)', () => {
    const result = validateClientId('api-prod');
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('PRODUCTION_CLIENT_ID_DETECTED');
  });

  it('rejects unknown client ID', () => {
    const result = validateClientId('unknown-client');
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('UNKNOWN_CLIENT_ID');
  });

  it('rejects empty client ID', () => {
    const result = validateClientId('');
    expect(result.status).toBe('FAIL_SECURITY_GUARD');
    expect(result.code).toBe('MISSING_CLIENT_ID');
  });
});

// ── Full configuration tests ──────────────────────────────────────────────────

describe('validateF4sEndpoints', () => {
  it('all PASS for the approved sandbox configuration', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: F4S_ALLOWED_RECEPTION_URL,
      tokenUrl: F4S_ALLOWED_TOKEN_URL,
      clientId: F4S_ALLOWED_CLIENT_ID,
    });
    expect(allGuardResultsPass(results)).toBe(true);
    expect(results.every((r) => r.status === 'PASS')).toBe(true);
  });

  it('fails on production reception URL', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
      tokenUrl: F4S_ALLOWED_TOKEN_URL,
      clientId: F4S_ALLOWED_CLIENT_ID,
    });
    expect(allGuardResultsPass(results)).toBe(false);
    expect(results.some((r) => r.code === 'PRODUCTION_HOST_DETECTED')).toBe(true);
  });

  it('fails on production token URL', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: F4S_ALLOWED_RECEPTION_URL,
      tokenUrl:
        'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
      clientId: F4S_ALLOWED_CLIENT_ID,
    });
    expect(allGuardResultsPass(results)).toBe(false);
    expect(results.some((r) => r.code === 'PRODUCTION_REALM_IN_TOKEN_URL')).toBe(true);
  });

  it('fails on production client ID', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: F4S_ALLOWED_RECEPTION_URL,
      tokenUrl: F4S_ALLOWED_TOKEN_URL,
      clientId: 'api-prod',
    });
    expect(allGuardResultsPass(results)).toBe(false);
    expect(results.some((r) => r.code === 'PRODUCTION_CLIENT_ID_DETECTED')).toBe(true);
  });

  it('fails on old repository sandbox reception URL', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/',
      tokenUrl: F4S_ALLOWED_TOKEN_URL,
      clientId: F4S_ALLOWED_CLIENT_ID,
    });
    expect(allGuardResultsPass(results)).toBe(false);
  });

  it('fails on mixed sandbox reception + production client', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: F4S_ALLOWED_RECEPTION_URL,
      tokenUrl: F4S_ALLOWED_TOKEN_URL,
      clientId: 'api-prod',
    });
    expect(allGuardResultsPass(results)).toBe(false);
  });
});
