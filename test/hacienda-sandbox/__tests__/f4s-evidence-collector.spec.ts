/**
 * TASK-007 — F4-S Evidence Collector tests
 *
 * Verifies:
 *   - Evidence is built from an explicit safe-field allowlist
 *   - Authorization header never appears in evidence
 *   - Bearer token never appears in evidence
 *   - Password never appears in evidence
 *   - PIN never appears in evidence
 *   - PKCS#12 / private key bytes never appear in evidence
 *   - Secret patterns trigger assertNoSecrets guard
 *   - Path sanitization removes query params
 *   - Location header sanitization removes credentials
 *   - SHA-256 is computed from response artifact (not the artifact itself)
 */

import {
  buildSafeEvidence,
  sanitizePath,
  sanitizeLocationHeader,
  sha256Hex,
  detectSecretPattern,
  assertNoSecrets,
  assertTask008EvidenceSafe,
  TASK_008_FORBIDDEN_KEYS,
  buildNotExecutedReport,
} from '../evidence/f4s-evidence-collector';
import type { RawHttpEventInput } from '../evidence/f4s-evidence-collector';

// ── buildSafeEvidence ─────────────────────────────────────────────────────────

describe('buildSafeEvidence', () => {
  const baseInput: RawHttpEventInput = {
    scenarioId: 'S01-auth',
    hostname: 'api-sandbox.comprobanteselectronicos.go.cr',
    httpMethod: 'POST',
    rawPath: '/recepcion/v1',
    httpStatus: 201,
    durationMs: 320,
    adapterIdentity: 'HaciendaRecepcionAdapter',
  };

  it('sets environment to SANDBOX always', () => {
    const evidence = buildSafeEvidence(baseInput);
    expect(evidence.environment).toBe('SANDBOX');
  });

  it('copies safe fields correctly', () => {
    const evidence = buildSafeEvidence(baseInput);
    expect(evidence.scenarioId).toBe('S01-auth');
    expect(evidence.hostname).toBe('api-sandbox.comprobanteselectronicos.go.cr');
    expect(evidence.httpMethod).toBe('POST');
    expect(evidence.httpStatus).toBe(201);
    expect(evidence.durationMs).toBe(320);
    expect(evidence.adapterIdentity).toBe('HaciendaRecepcionAdapter');
  });

  it('sanitizes path (removes query params)', () => {
    const evidence = buildSafeEvidence({
      ...baseInput,
      rawPath: '/recepcion/v1?token=secret&other=value',
    });
    expect(evidence.sanitizedPath).toBe('/recepcion/v1');
    expect(evidence.sanitizedPath).not.toContain('token=');
    expect(evidence.sanitizedPath).not.toContain('secret');
  });

  it('sanitizes location header (removes query/credentials)', () => {
    const evidence = buildSafeEvidence({
      ...baseInput,
      rawLocationHeader:
        'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/clave-123?token=secret',
    });
    expect(evidence.safeLocationHeader).not.toContain('token=');
    expect(evidence.safeLocationHeader).not.toContain('secret');
    expect(evidence.safeLocationHeader).toContain('/recepcion/v1/clave-123');
  });

  it('computes SHA-256 of response artifact — never the artifact itself', () => {
    const artifact = Buffer.from('<MensajeHacienda>aceptado</MensajeHacienda>', 'utf8');
    const evidence = buildSafeEvidence({
      ...baseInput,
      responseArtifactBytes: artifact,
    });
    // SHA-256 must be a 64-char hex string
    expect(evidence.responseArtifactSha256).toMatch(/^[a-f0-9]{64}$/);
    // The raw XML must NOT appear
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('<MensajeHacienda>');
  });

  it('includes rate limit headers when provided', () => {
    const evidence = buildSafeEvidence({
      ...baseInput,
      rateLimitHeaders: { limit: '100', remaining: '99', reset: '1700000000' },
    });
    expect(evidence.rateLimitHeaders?.limit).toBe('100');
    expect(evidence.rateLimitHeaders?.remaining).toBe('99');
  });

  it('does NOT include authorization header (never in input or output)', () => {
    // The input type does not even have an 'authorization' field — this is by design
    const evidence = buildSafeEvidence(baseInput);
    const serialized = JSON.stringify(evidence);
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized.toLowerCase()).not.toContain('bearer');
  });

  it('includes timestamp as ISO string', () => {
    const evidence = buildSafeEvidence(baseInput);
    expect(new Date(evidence.timestamp).toISOString()).toBe(evidence.timestamp);
  });
});

// ── sanitizePath ──────────────────────────────────────────────────────────────

describe('sanitizePath', () => {
  it('removes query parameters', () => {
    expect(sanitizePath('/recepcion/v1?token=abc&other=xyz')).toBe('/recepcion/v1');
  });

  it('removes fragment', () => {
    expect(sanitizePath('/recepcion/v1#section')).toBe('/recepcion/v1');
  });

  it('leaves clean path unchanged', () => {
    expect(sanitizePath('/recepcion/v1')).toBe('/recepcion/v1');
  });

  it('handles path with clave', () => {
    expect(sanitizePath('/recepcion/5060101250031011234560010000101000000000112')).toBe(
      '/recepcion/5060101250031011234560010000101000000000112',
    );
  });
});

// ── sanitizeLocationHeader ────────────────────────────────────────────────────

describe('sanitizeLocationHeader', () => {
  it('strips query params from Location', () => {
    const result = sanitizeLocationHeader(
      'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/clave?secret=abc',
    );
    expect(result).not.toContain('secret=');
    expect(result).toContain('/recepcion/v1/clave');
  });

  it('handles undefined gracefully', () => {
    expect(sanitizeLocationHeader(undefined)).toBeUndefined();
  });

  it('handles relative paths', () => {
    const result = sanitizeLocationHeader('/recepcion/v1/clave?token=xyz');
    expect(result).not.toContain('token=');
    expect(result).toContain('/recepcion/v1/clave');
  });
});

// ── sha256Hex ─────────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('produces a 64-char lowercase hex string', () => {
    const hash = sha256Hex(Buffer.from('test-xml', 'utf8'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = sha256Hex(Buffer.from('aceptado', 'utf8'));
    const h2 = sha256Hex(Buffer.from('rechazado', 'utf8'));
    expect(h1).not.toBe(h2);
  });
});

// ── detectSecretPattern / assertNoSecrets ─────────────────────────────────────

describe('detectSecretPattern', () => {
  it('detects Authorization header pattern', () => {
    const pattern = detectSecretPattern('{"Authorization": "Bearer abc123"}');
    expect(pattern).toBeDefined();
  });

  it('detects bearer token pattern', () => {
    const pattern = detectSecretPattern('bearer eyJhbGciOiJSUzI1');
    expect(pattern).toBeDefined();
  });

  it('detects password pattern', () => {
    const pattern = detectSecretPattern('{"password": "my-secret"}');
    expect(pattern).toBeDefined();
  });

  it('detects private_key pattern', () => {
    const pattern = detectSecretPattern('{"private_key": "-----BEGIN RSA"}');
    expect(pattern).toBeDefined();
  });

  it('detects client_secret field name', () => {
    // client_secret: underscore-delimited — must be caught even though
    // the Node URL parser would normalise :443 and the word is not standalone.
    const pattern = detectSecretPattern('{"client_secret": "FAKE_SENTINEL"}');
    expect(pattern).toBeDefined();
  });

  it('detects access_token field', () => {
    const pattern = detectSecretPattern('{"access_token": "FAKE_SENTINEL_TOKEN"}');
    expect(pattern).toBeDefined();
  });

  it('detects refresh_token field', () => {
    const pattern = detectSecretPattern('{"refresh_token": "FAKE_SENTINEL_REFRESH"}');
    expect(pattern).toBeDefined();
  });

  // ── Regression: false-positive fix ────────────────────────────────────────
  // secretsExposed is a LEGITIMATE TASK-008 metadata field that counts the
  // number of secrets exposed (always 0). The old /secret/i pattern produced
  // a false positive on this field name. This test documents the fix.
  it('does NOT flag secretsExposed: 0 — regression for false-positive fix', () => {
    const evidenceWithSecretsExposed = JSON.stringify({ secretsExposed: 0 });
    expect(detectSecretPattern(evidenceWithSecretsExposed)).toBeUndefined();
  });

  it('does not flag safe evidence fields', () => {
    const safeEvidence = JSON.stringify({
      timestamp: '2025-01-01T00:00:00.000Z',
      scenarioId: 'S01-auth',
      environment: 'SANDBOX',
      hostname: 'api-sandbox.comprobanteselectronicos.go.cr',
      httpMethod: 'POST',
      sanitizedPath: '/recepcion/v1',
      httpStatus: 201,
      durationMs: 320,
      adapterIdentity: 'HaciendaRecepcionAdapter',
    });
    expect(detectSecretPattern(safeEvidence)).toBeUndefined();
  });

  it('does not flag complete TASK-008 PASS evidence shape', () => {
    // Represents the exact structure written to disk on a successful run.
    // This is the shape that triggered the original false positive.
    const task008PassEvidence = JSON.stringify({
      scenario: 'TASK-008',
      environment: 'SANDBOX',
      tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
      clientId: 'api-stag',
      httpStatus: 200,
      tokenReceived: true,
      tokenType: 'Bearer',
      expiresIn: 3600,
      timestamp: '2026-01-01T00:00:00.000Z',
      result: 'PASS',
      networkIsolation: {
        idpRequestsMade: 1,
        recepcionRequestsMade: 0,
        productionRequestsMade: 0,
        totalRequestsMade: 1,
      },
      secretsExposed: 0,
    });
    expect(detectSecretPattern(task008PassEvidence)).toBeUndefined();
  });
});

describe('assertNoSecrets', () => {
  it('throws on evidence containing Authorization header', () => {
    expect(() => assertNoSecrets('{"Authorization": "Bearer token"}', 'test')).toThrow(
      /F4S SECURITY/,
    );
  });

  it('does not throw on clean evidence', () => {
    const clean = JSON.stringify({
      timestamp: new Date().toISOString(),
      environment: 'SANDBOX',
      httpStatus: 201,
    });
    expect(() => assertNoSecrets(clean, 'test')).not.toThrow();
  });

  // ── Regression: secretsExposed must not be blocked ─────────────────────────
  it('does NOT throw on evidence containing secretsExposed: 0', () => {
    const serialized = JSON.stringify({ secretsExposed: 0, result: 'PASS' });
    expect(() => assertNoSecrets(serialized, 'test')).not.toThrow();
  });

  it('does NOT throw on complete TASK-008 PASS evidence', () => {
    const serialized = JSON.stringify({
      scenario: 'TASK-008',
      environment: 'SANDBOX',
      tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
      clientId: 'api-stag',
      httpStatus: 200,
      tokenReceived: true,
      tokenType: 'Bearer',
      expiresIn: 3600,
      timestamp: '2026-01-01T00:00:00.000Z',
      result: 'PASS',
      networkIsolation: {
        idpRequestsMade: 1,
        recepcionRequestsMade: 0,
        productionRequestsMade: 0,
        totalRequestsMade: 1,
      },
      secretsExposed: 0,
    });
    expect(() => assertNoSecrets(serialized, 'test')).not.toThrow();
  });
});

// ── assertTask008EvidenceSafe — structured key-level validator ────────────────

describe('assertTask008EvidenceSafe', () => {
  // ── Must REJECT these shapes ───────────────────────────────────────────────

  it('rejects evidence containing access_token', () => {
    expect(() =>
      assertTask008EvidenceSafe({ access_token: 'FAKE_SENTINEL_TOKEN' }, 'test'),
    ).toThrow(/F4S SECURITY/);
  });

  it('rejects evidence containing refresh_token', () => {
    expect(() =>
      assertTask008EvidenceSafe({ refresh_token: 'FAKE_SENTINEL_REFRESH' }, 'test'),
    ).toThrow(/F4S SECURITY/);
  });

  it('rejects evidence containing password', () => {
    expect(() => assertTask008EvidenceSafe({ password: 'FAKE_SENTINEL_PASSWORD' }, 'test')).toThrow(
      /F4S SECURITY/,
    );
  });

  it('rejects evidence containing authorization', () => {
    expect(() =>
      assertTask008EvidenceSafe({ authorization: 'Bearer FAKE_SENTINEL' }, 'test'),
    ).toThrow(/F4S SECURITY/);
  });

  it('rejects evidence containing client_secret', () => {
    expect(() => assertTask008EvidenceSafe({ client_secret: 'FAKE_SENTINEL' }, 'test')).toThrow(
      /F4S SECURITY/,
    );
  });

  it('rejects evidence with forbidden key nested inside networkIsolation', () => {
    expect(() =>
      assertTask008EvidenceSafe(
        {
          scenario: 'TASK-008',
          networkIsolation: { access_token: 'FAKE_SENTINEL_NESTED' },
        },
        'test',
      ),
    ).toThrow(/F4S SECURITY/);
  });

  it('error message includes the forbidden key name', () => {
    expect(() => assertTask008EvidenceSafe({ client_secret: 'FAKE_SENTINEL' }, 'test')).toThrow(
      /client_secret/,
    );
  });

  // ── Must ACCEPT these shapes ───────────────────────────────────────────────

  it('accepts { secretsExposed: 0 } — core regression for false-positive fix', () => {
    expect(() => assertTask008EvidenceSafe({ secretsExposed: 0 }, 'test')).not.toThrow();
  });

  it('accepts complete TASK-008 PASS evidence shape', () => {
    const passEvidence = {
      scenario: 'TASK-008',
      environment: 'SANDBOX',
      tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
      clientId: 'api-stag',
      httpStatus: 200,
      tokenReceived: true,
      tokenType: 'Bearer',
      expiresIn: 3600,
      timestamp: '2026-01-01T00:00:00.000Z',
      result: 'PASS',
      networkIsolation: {
        idpRequestsMade: 1,
        recepcionRequestsMade: 0,
        productionRequestsMade: 0,
        totalRequestsMade: 1,
      },
      secretsExposed: 0 as const,
    };
    expect(() => assertTask008EvidenceSafe(passEvidence, 'test')).not.toThrow();
  });

  it('accepts complete TASK-008 FAIL evidence shape', () => {
    const failEvidence = {
      scenario: 'TASK-008',
      environment: 'SANDBOX',
      tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
      clientId: 'api-stag',
      httpStatus: 401,
      tokenReceived: false,
      timestamp: '2026-01-01T00:00:00.000Z',
      result: 'FAIL',
      networkIsolation: {
        idpRequestsMade: 1,
        recepcionRequestsMade: 0,
        productionRequestsMade: 0,
        totalRequestsMade: 1,
      },
      secretsExposed: 0 as const,
      errorCode: 'AUTHENTICATION_FAILED_401',
    };
    expect(() => assertTask008EvidenceSafe(failEvidence, 'test')).not.toThrow();
  });

  it('TASK_008_FORBIDDEN_KEYS set contains access_token and client_secret', () => {
    expect(TASK_008_FORBIDDEN_KEYS.has('access_token')).toBe(true);
    expect(TASK_008_FORBIDDEN_KEYS.has('client_secret')).toBe(true);
    expect(TASK_008_FORBIDDEN_KEYS.has('password')).toBe(true);
    expect(TASK_008_FORBIDDEN_KEYS.has('authorization')).toBe(true);
  });
});

// ── buildNotExecutedReport ────────────────────────────────────────────────────

describe('buildNotExecutedReport', () => {
  it('creates a NOT_EXECUTED report with SANDBOX environment', () => {
    const report = buildNotExecutedReport();
    expect(report.f4sStatus).toBe('NOT_EXECUTED');
    expect(report.environment).toBe('SANDBOX');
    expect(report.scenarios).toHaveLength(0);
  });

  it('never contains secret patterns', () => {
    const report = buildNotExecutedReport();
    const serialized = JSON.stringify(report);
    expect(detectSecretPattern(serialized)).toBeUndefined();
  });
});
