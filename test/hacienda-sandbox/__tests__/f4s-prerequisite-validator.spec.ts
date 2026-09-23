/**
 * TASK-003 — F4-S Prerequisite Validator tests
 *
 * Verifies:
 *   - Missing credentials → BLOCKED_BY_MISSING_PREREQUISITES
 *   - Invalid PKCS#12 → FAIL_CONFIGURATION with sanitized code
 *   - Invalid PIN → FAIL_CONFIGURATION with sanitized code
 *   - Missing private key → FAIL_CONFIGURATION with sanitized code
 *   - Safety guard failure → FAIL_SECURITY_GUARD
 *   - No secret value appears in any PrerequisiteItem or result DTO
 */

import { validateF4sPrerequisites } from '../preflight/f4s-prerequisite-validator';
import type { CertificateLoadResult } from '../preflight/f4s-certificate-loader';

// ── Helpers ───────────────────────────────────────────────────────────────────

type CertLoader = (
  certPath: string | undefined,
  pin: string | undefined,
) => Promise<CertificateLoadResult>;

const READY_CERT_LOADER: CertLoader = async () => ({ status: 'READY' });
const MISSING_PIN_LOADER: CertLoader = async () => ({ status: 'MISSING_PIN' });
const INVALID_CERT_LOADER: CertLoader = async () => ({ status: 'CERT_PARSE_FAILED' });
const INVALID_PIN_LOADER: CertLoader = async () => ({ status: 'CERT_PIN_INVALID' });
const MISSING_KEY_LOADER: CertLoader = async () => ({ status: 'CERT_PRIVATE_KEY_MISSING' });

/** Sets up the minimum env vars needed for a READY result. */
function setReadyEnv(): void {
  process.env['USE_REAL_HACIENDA'] = 'true';
  process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
    'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';
  process.env['HACIENDA_IDP_SANDBOX_URL'] =
    'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';
  process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] = 'api-stag';
  process.env['F4S_SANDBOX_USERNAME'] = 'PRESENCE_CHECK_ONLY_NOT_A_REAL_VALUE';
  process.env['F4S_SANDBOX_PASSWORD'] = 'PRESENCE_CHECK_ONLY_NOT_A_REAL_VALUE';
  process.env['F4S_SANDBOX_CERT_PATH'] = '/fake/.secrets/test.p12';
  process.env['F4S_SANDBOX_CERT_PIN'] = 'PRESENCE_CHECK_ONLY_NOT_A_REAL_VALUE';
  process.env['F4S_COMPANY_ID'] = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  process.env['F4S_TENANT_ID'] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost/test';
  process.env['STORAGE_TYPE'] = 'local';
  process.env['F4S_EVIDENCE_PATH'] = 'test-output/hacienda-sandbox-test';
}

function clearEnv(): void {
  const keys = [
    'USE_REAL_HACIENDA',
    'HACIENDA_RECEPCION_SANDBOX_BASE_URL',
    'HACIENDA_IDP_SANDBOX_URL',
    'HACIENDA_IDP_CLIENT_ID_SANDBOX',
    'F4S_SANDBOX_USERNAME',
    'F4S_SANDBOX_PASSWORD',
    'F4S_SANDBOX_CERT_PATH',
    'F4S_SANDBOX_CERT_PIN',
    'F4S_COMPANY_ID',
    'F4S_TENANT_ID',
    'DATABASE_URL',
    'STORAGE_TYPE',
    'F4S_EVIDENCE_PATH',
  ];
  for (const key of keys) {
    delete process.env[key];
  }
}

function resultContainsSecret(result: object): boolean {
  const serialized = JSON.stringify(result).toLowerCase();
  const secretPatterns = [
    'not_a_real_value',
    'presence_check_only',
    'postgresql://test:test',
    'aaaaaaaa',
    'bbbbbbbb',
  ];
  // The patterns above are our fake "secrets" — they should not appear literally
  // in status codes or sanitized messages.
  // Note: we use known-fake values, so this checks the validator doesn't echo them back.
  return secretPatterns.some((pattern) => serialized.includes(pattern));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('F4sPrerequisiteValidator — TASK-003', () => {
  afterEach(() => {
    clearEnv();
  });

  describe('READY result', () => {
    it('returns READY_FOR_SANDBOX_EXECUTION when all prerequisites are met', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('READY_FOR_SANDBOX_EXECUTION');
      expect(result.items.every((i) => i.status === 'READY')).toBe(true);
    });
  });

  describe('BLOCKED_BY_MISSING_PREREQUISITES — missing credentials', () => {
    it('is blocked when USE_REAL_HACIENDA is not set', async () => {
      setReadyEnv();
      delete process.env['USE_REAL_HACIENDA'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
      const item = result.items.find((i) => i.name === 'useRealHacienda');
      expect(item?.status).toBe('MISSING');
    });

    it('is blocked when F4S_SANDBOX_USERNAME is not set', async () => {
      setReadyEnv();
      delete process.env['F4S_SANDBOX_USERNAME'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
      const item = result.items.find((i) => i.name === 'sandboxUsername');
      expect(item?.status).toBe('MISSING');
    });

    it('is blocked when F4S_SANDBOX_PASSWORD is not set', async () => {
      setReadyEnv();
      delete process.env['F4S_SANDBOX_PASSWORD'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
    });

    it('is blocked when F4S_SANDBOX_CERT_PIN is not set (loader returns MISSING_PIN)', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: MISSING_PIN_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
      const item = result.items.find((i) => i.name === 'signingCertificate');
      expect(item?.status).toBe('MISSING');
      expect(item?.sanitizedCode).toBe('SIGNING_CERTIFICATE_PIN_NOT_CONFIGURED');
    });

    it('is blocked when F4S_COMPANY_ID is not set', async () => {
      setReadyEnv();
      delete process.env['F4S_COMPANY_ID'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
    });

    it('is blocked when DATABASE_URL is not set', async () => {
      setReadyEnv();
      delete process.env['DATABASE_URL'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
    });
  });

  describe('FAIL_CONFIGURATION — invalid certificate', () => {
    it('fails with SIGNING_CERTIFICATE_INVALID when PKCS#12 cannot be parsed', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: INVALID_CERT_LOADER,
      });
      expect(result.aggregateStatus).toBe('FAIL_CONFIGURATION');
      const item = result.items.find((i) => i.name === 'signingCertificate');
      expect(item?.status).toBe('INVALID');
      expect(item?.sanitizedCode).toBe('SIGNING_CERTIFICATE_INVALID');
    });

    it('fails with SIGNING_CERTIFICATE_PIN_INVALID when PIN is wrong', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: INVALID_PIN_LOADER,
      });
      expect(result.aggregateStatus).toBe('FAIL_CONFIGURATION');
      const item = result.items.find((i) => i.name === 'signingCertificate');
      expect(item?.sanitizedCode).toBe('SIGNING_CERTIFICATE_PIN_INVALID');
    });

    it('fails with SIGNING_PRIVATE_KEY_MISSING when private key is absent', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: MISSING_KEY_LOADER,
      });
      expect(result.aggregateStatus).toBe('FAIL_CONFIGURATION');
      const item = result.items.find((i) => i.name === 'signingCertificate');
      expect(item?.sanitizedCode).toBe('SIGNING_PRIVATE_KEY_MISSING');
    });

    it('fails when HACIENDA_RECEPCION_SANDBOX_BASE_URL is the old repository default', async () => {
      setReadyEnv();
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/';
      const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });
      // sandboxReceptionUrl item should be INVALID (wrong value vs F4S_ALLOWED_RECEPTION_URL)
      const item = result.items.find((i) => i.name === 'sandboxReceptionUrl');
      expect(item?.status).toBe('INVALID');
      // The old URL is on the PRODUCTION host → safety guard also fires → FAIL_SECURITY_GUARD
      expect(result.aggregateStatus).toBe('FAIL_SECURITY_GUARD');
    });

    it('fails on FAIL_SECURITY_GUARD when safety guard detects production URL explicitly set', async () => {
      setReadyEnv();
      // This is a DANGEROUS explicit value — operator set a production URL
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/';
      const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });
      // Guard fires because a dangerous value was explicitly configured
      expect(result.aggregateStatus).toBe('FAIL_SECURITY_GUARD');
    });

    it('returns BLOCKED_BY_MISSING_PREREQUISITES (not FAIL_SECURITY_GUARD) when reception URL is not set at all', async () => {
      // This is the normal CI scenario — no F4-S env vars configured
      clearEnv();
      const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });
      // Must be BLOCKED, NOT security guard failure (missing ≠ dangerous)
      expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
      expect(result.aggregateStatus).not.toBe('FAIL_SECURITY_GUARD');
    });
  });

  describe('Secret leakage prevention', () => {
    it('does not include credential values in any result item', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(resultContainsSecret(result)).toBe(false);
    });

    it('does not include credential values in a BLOCKED result', async () => {
      setReadyEnv();
      delete process.env['F4S_SANDBOX_USERNAME'];
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      expect(resultContainsSecret(result)).toBe(false);
    });

    it('does not include PIN in the SIGNING_CERTIFICATE_PIN_INVALID error', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: INVALID_PIN_LOADER,
      });
      const serialized = JSON.stringify(result);
      // PIN value must not appear
      expect(serialized).not.toContain('PRESENCE_CHECK_ONLY_NOT_A_REAL_VALUE');
      // Sanitized code must appear
      expect(serialized).toContain('SIGNING_CERTIFICATE_PIN_INVALID');
    });

    it('status codes are sanitized strings, not secret values', async () => {
      setReadyEnv();
      const result = await validateF4sPrerequisites({
        certificateLoader: READY_CERT_LOADER,
      });
      for (const item of result.items) {
        if (item.sanitizedCode) {
          // Sanitized codes must be UPPERCASE_WITH_UNDERSCORES patterns
          expect(item.sanitizedCode).toMatch(/^[A-Z0-9_]+$/);
        }
      }
    });
  });
});
