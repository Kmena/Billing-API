/**
 * TASK-006 — F4-S Preflight Zero-Network Proof
 *
 * MANDATORY test that proves preflight makes ZERO real Hacienda HTTP requests.
 * This is executable evidence, not a code inspection claim.
 *
 * All Hacienda adapter calls go through @nestjs/axios → axios.
 * Spies are placed on axios.post and axios.get (the application-level HTTP layer).
 * These spies are set to reject, so any accidental Hacienda call would fail loudly.
 *
 * Expected: 0 calls on all axios.post / axios.get spies throughout preflight.
 */

import axios from 'axios';
import { validateF4sPrerequisites } from '../preflight/f4s-prerequisite-validator';
import { validateF4sEndpoints } from '../guards/f4s-safety-guard';
import { assertAdapterConfigForPreflight } from '../preflight/f4s-adapter-assertion';
import type { CertificateLoadResult } from '../preflight/f4s-certificate-loader';

// ── Test setup ────────────────────────────────────────────────────────────────

type CertLoader = (
  certPath: string | undefined,
  pin: string | undefined,
) => Promise<CertificateLoadResult>;

const READY_CERT_LOADER: CertLoader = async () => ({ status: 'READY' });

const SANDBOX_RECEPTION_URL = 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';
const SANDBOX_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';

function setMinimalEnv(): void {
  process.env['USE_REAL_HACIENDA'] = 'true';
  process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] = SANDBOX_RECEPTION_URL;
  process.env['HACIENDA_IDP_SANDBOX_URL'] = SANDBOX_TOKEN_URL;
  process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] = 'api-stag';
  process.env['F4S_SANDBOX_USERNAME'] = 'preflight-test-presence-check';
  process.env['F4S_SANDBOX_PASSWORD'] = 'preflight-test-presence-check';
  process.env['F4S_SANDBOX_CERT_PATH'] = '/fake/path/test.p12';
  process.env['F4S_SANDBOX_CERT_PIN'] = 'preflight-test-presence-check';
  process.env['F4S_COMPANY_ID'] = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  process.env['F4S_TENANT_ID'] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost/testdb';
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

// ── Zero-network tests ────────────────────────────────────────────────────────

describe('F4-S Preflight — ZERO Hacienda HTTP requests (TASK-006 mandatory proof)', () => {
  /**
   * Spy on axios HTTP methods — these are what all Hacienda adapters use.
   * Set to reject so any accidental real call causes an immediate, loud failure.
   */
  let axiosPostSpy: jest.SpyInstance;
  let axiosGetSpy: jest.SpyInstance;
  let axiosRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    setMinimalEnv();

    axiosPostSpy = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('[F4S TEST FAIL] Unexpected real HTTP POST during preflight'));
    axiosGetSpy = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(new Error('[F4S TEST FAIL] Unexpected real HTTP GET during preflight'));
    axiosRequestSpy = jest
      .spyOn(axios, 'request')
      .mockRejectedValue(
        new Error('[F4S TEST FAIL] Unexpected real HTTP request during preflight'),
      );
  });

  afterEach(() => {
    axiosPostSpy.mockRestore();
    axiosGetSpy.mockRestore();
    axiosRequestSpy.mockRestore();
    clearEnv();
  });

  // ── Individual component tests ──────────────────────────────────────────────

  it('safety guard validation makes zero HTTP requests', () => {
    validateF4sEndpoints({
      receptionBaseUrl: SANDBOX_RECEPTION_URL,
      tokenUrl: SANDBOX_TOKEN_URL,
      clientId: 'api-stag',
    });

    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('adapter config assertion makes zero HTTP requests', () => {
    assertAdapterConfigForPreflight();

    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('prerequisite validation makes zero HTTP requests (READY scenario)', async () => {
    await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  // ── Full preflight sequence tests ───────────────────────────────────────────

  it('full preflight sequence (safety + adapter + prerequisites) makes zero HTTP requests', async () => {
    // Step 1: Safety guard
    validateF4sEndpoints({
      receptionBaseUrl: process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL']!,
      tokenUrl: process.env['HACIENDA_IDP_SANDBOX_URL']!,
      clientId: process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX']!,
    });

    // Step 2: Adapter assertion
    assertAdapterConfigForPreflight();

    // Step 3: Prerequisites
    await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    // MANDATORY: axios must not have been called at all
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('BLOCKED_BY_MISSING_PREREQUISITES preflight (missing credentials) makes zero HTTP requests', async () => {
    delete process.env['F4S_SANDBOX_USERNAME'];
    delete process.env['F4S_SANDBOX_PASSWORD'];

    const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('BLOCKED_BY_MISSING_PREREQUISITES (not FAIL_SECURITY_GUARD) when NO env vars are set at all', async () => {
    // Normal CI scenario: no F4-S env vars configured.
    // Critical regression test for the empty-URL guard-bypass defect fix.
    clearEnv();

    const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    // MUST be BLOCKED, not FAIL_SECURITY_GUARD — missing URL ≠ dangerous URL
    expect(result.aggregateStatus).toBe('BLOCKED_BY_MISSING_PREREQUISITES');
    expect(result.aggregateStatus).not.toBe('FAIL_SECURITY_GUARD');
    // AND still zero HTTP calls
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('FAIL_SECURITY_GUARD preflight also makes zero HTTP requests', async () => {
    process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
      'https://api.comprobanteselectronicos.go.cr/recepcion/v1/';

    const result = await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    expect(result.aggregateStatus).toBe('FAIL_SECURITY_GUARD');
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  it('safety guard rejection of production URL makes zero HTTP requests', () => {
    const results = validateF4sEndpoints({
      receptionBaseUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
      tokenUrl: SANDBOX_TOKEN_URL,
      clientId: 'api-stag',
    });

    // Guard must fail
    expect(results.some((r) => r.status === 'FAIL_SECURITY_GUARD')).toBe(true);
    // And zero HTTP calls
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(axiosGetSpy).not.toHaveBeenCalled();
    expect(axiosRequestSpy).not.toHaveBeenCalled();
  });

  // ── Hacienda HTTP count summary ─────────────────────────────────────────────

  it('total Hacienda HTTP request count across entire preflight is exactly 0', async () => {
    // Run the complete preflight sequence
    validateF4sEndpoints({
      receptionBaseUrl: process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL']!,
      tokenUrl: process.env['HACIENDA_IDP_SANDBOX_URL']!,
      clientId: process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX']!,
    });
    assertAdapterConfigForPreflight();
    await validateF4sPrerequisites({ certificateLoader: READY_CERT_LOADER });

    const totalHaciendaRequests =
      axiosPostSpy.mock.calls.length +
      axiosGetSpy.mock.calls.length +
      axiosRequestSpy.mock.calls.length;

    // This is the MANDATORY evidence: Hacienda HTTP requests = 0
    expect(totalHaciendaRequests).toBe(0);
  });
});
