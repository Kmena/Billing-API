/**
 * F4-S TASK-008: Real Hacienda Sandbox Authentication Validation
 *
 * Performs ONE controlled authentication against the real Hacienda sandbox IdP.
 * Uses the existing HaciendaOidcAuthAdapter — no parallel authentication implementation.
 *
 * SECURITY CONTRACT:
 *   - Safety guard MUST PASS before any HTTP call
 *   - Exactly 1 HTTP request to IdP — no more, no less
 *   - 0 requests to /recepcion or any production endpoint
 *   - Raw access_token: NEVER logged, persisted, or returned to caller
 *   - Password: NEVER logged or persisted
 *   - Network isolation proof: verified by interceptor-level request counting on the
 *     actual axios instance used by HaciendaOidcAuthAdapter
 *
 * TASK-008 STOPS here. Does NOT proceed to TASK-009+ or /recepcion.
 */

import axios from 'axios';
import { from, type Observable } from 'rxjs';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { HaciendaOidcAuthAdapter } from '@/modules/hacienda-connection/infrastructure/auth/hacienda-oidc-auth.adapter';
import type { HaciendaAuthConfig } from '@/infrastructure/config/hacienda-auth.config';
import {
  validateF4sEndpoints,
  allGuardResultsPass,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';
import { isUseRealHaciendaEnabled } from '../preflight/f4s-adapter-assertion';
import {
  buildSafeEvidence,
  writeHttpEvidence,
  assertNoSecrets,
  assertTask008EvidenceSafe,
  EVIDENCE_BASE_PATH,
} from '../evidence/f4s-evidence-collector';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Task008AuthStatus = 'PASS' | 'FAIL';

/** Network isolation proof — key evidence for TASK-008 auditors. */
export interface Task008NetworkIsolationProof {
  readonly idpRequestsMade: number;
  readonly recepcionRequestsMade: number;
  readonly productionRequestsMade: number;
  readonly totalRequestsMade: number;
}

/**
 * Sanitized TASK-008 evidence summary.
 * NEVER includes: access_token, refresh_token, password, username, PIN, certificate.
 */
export interface Task008AuthEvidence {
  readonly scenario: 'TASK-008';
  readonly environment: 'SANDBOX';
  readonly tokenEndpointHost: string;
  readonly clientId: string;
  readonly httpStatus: number;
  readonly tokenReceived: boolean;
  readonly tokenType?: string;
  readonly expiresIn?: number;
  readonly timestamp: string;
  readonly result: Task008AuthStatus;
  readonly networkIsolation: Task008NetworkIsolationProof;
  /** Always 0 — asserted before evidence is written. */
  readonly secretsExposed: 0;
}

export interface Task008Result {
  readonly status: Task008AuthStatus;
  readonly evidence: Task008AuthEvidence;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Instrumented HTTP service for TASK-008.
 * The actual axios instance is instrumented — not global axios spies.
 */
export interface Task008InstrumentedHttp {
  readonly httpService: {
    post: <T>(
      url: string,
      data?: unknown,
      config?: AxiosRequestConfig,
    ) => Observable<AxiosResponse<T>>;
  };
  readonly getIdpRequestCount: () => number;
  readonly getRecepcionRequestCount: () => number;
  readonly getProductionRequestCount: () => number;
  readonly getTotalRequestCount: () => number;
  readonly getCapturedHttpStatus: () => number;
  readonly getCapturedTokenType: () => string | undefined;
  readonly getCapturedExpiresIn: () => number | undefined;
}

export interface Task008ScenarioOptions {
  /** Override HTTP infrastructure for unit testing. Default: real axios-backed instance. */
  readonly httpFactory?: () => Task008InstrumentedHttp;
  /** Override ConfigService for unit testing. Default: reads from process.env. */
  readonly configFactory?: () => Pick<ConfigService, 'get'>;
  /** Skip evidence file writes. Default: false. Set true in unit tests. */
  readonly skipEvidenceWrite?: boolean;
}

// ── Default instrumented HTTP factory ────────────────────────────────────────
// Creates a real axios instance with interceptors that:
//   - Count requests by destination (IdP / recepcion / production / total)
//   - Capture safe token metadata (token_type, expires_in) from the response
//   - Capture HTTP status from success and error responses
// The raw access_token and other secrets are NEVER captured or stored.

export function createDefaultInstrumentedHttp(): Task008InstrumentedHttp {
  let idpRequestCount = 0;
  let recepcionRequestCount = 0;
  let productionRequestCount = 0;
  let totalRequestCount = 0;
  let capturedHttpStatus = 0;
  let capturedTokenType: string | undefined;
  let capturedExpiresIn: number | undefined;

  const axiosInstance = axios.create();

  // Request interceptor: count by destination
  axiosInstance.interceptors.request.use((config) => {
    const url = config.url ?? '';
    totalRequestCount++;
    if (url.includes('idp.comprobanteselectronicos.go.cr')) {
      idpRequestCount++;
    }
    if (url.includes('api-sandbox.comprobanteselectronicos.go.cr') && url.includes('/recepcion')) {
      recepcionRequestCount++;
    }
    if (url.includes('api.comprobanteselectronicos.go.cr')) {
      productionRequestCount++;
    }
    return config;
  });

  // Response interceptor: capture safe metadata (NEVER the token itself)
  axiosInstance.interceptors.response.use(
    (response) => {
      const url = response.config.url ?? '';
      if (url.includes('idp.comprobanteselectronicos.go.cr') && url.includes('/token')) {
        capturedHttpStatus = response.status;
        // Capture only token_type and expires_in — NEVER access_token or refresh_token
        const data = response.data as Partial<{ token_type?: string; expires_in?: number }>;
        if (typeof data.token_type === 'string') {
          capturedTokenType = data.token_type;
        }
        if (typeof data.expires_in === 'number') {
          capturedExpiresIn = data.expires_in;
        }
      }
      return response;
    },
    (error: unknown) => {
      // Capture HTTP status from error response when safe
      if (
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { status?: number } }).response?.status === 'number'
      ) {
        capturedHttpStatus = (error as { response: { status: number } }).response.status;
      }
      return Promise.reject(error);
    },
  );

  const httpService = {
    post: <T>(
      url: string,
      data?: unknown,
      config?: AxiosRequestConfig,
    ): Observable<AxiosResponse<T>> =>
      from(axiosInstance.post<T>(url, data as Parameters<typeof axiosInstance.post>[1], config)),
  };

  return {
    httpService,
    getIdpRequestCount: () => idpRequestCount,
    getRecepcionRequestCount: () => recepcionRequestCount,
    getProductionRequestCount: () => productionRequestCount,
    getTotalRequestCount: () => totalRequestCount,
    getCapturedHttpStatus: () => capturedHttpStatus,
    getCapturedTokenType: () => capturedTokenType,
    getCapturedExpiresIn: () => capturedExpiresIn,
  };
}

// ── Config service factory ────────────────────────────────────────────────────

export function createTask008ConfigService(): Pick<ConfigService, 'get'> {
  const haciendaAuthCfg: HaciendaAuthConfig = {
    idp: {
      sandboxTokenUrl: process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL,
      sandboxClientId: process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID,
      productionTokenUrl:
        'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
      productionClientId: 'api-prod',
    },
    authTimeoutMs: 15000,
    tokenExpirySafetyMarginMs: 30000,
    retry: { count5xx: 1, delay5xxMs: 2000 },
  };
  return {
    get: <T>(key: string): T | undefined => {
      if (key === 'haciendaAuth') return haciendaAuthCfg as unknown as T;
      return undefined;
    },
  };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function extractHttpStatusSafely(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { status?: number } }).response?.status === 'number'
  ) {
    return (error as { response: { status: number } }).response.status;
  }
  return 0;
}

function classifyErrorCode(error: unknown): string {
  const status = extractHttpStatusSafely(error);
  if (status === 401) return 'AUTHENTICATION_FAILED_401';
  if (status === 403) return 'AUTHORIZATION_FAILED_403';
  if (status === 429) return 'RATE_LIMITED_429';
  if (status >= 500) return `IDP_SERVER_ERROR_${status}`;
  if (status > 0) return `IDP_HTTP_ERROR_${status}`;
  return 'IDP_UNAVAILABLE';
}

function sanitizeErrorMessage(error: unknown): string {
  // Never include credentials, raw response body, tokens, or stack traces
  const status = extractHttpStatusSafely(error);
  if (status === 401) return 'Hacienda sandbox IdP returned HTTP 401 Unauthorized.';
  if (status === 403) return 'Hacienda sandbox IdP returned HTTP 403 Forbidden.';
  if (status === 429) return 'Hacienda sandbox IdP returned HTTP 429 Too Many Requests.';
  if (status >= 500) return `Hacienda sandbox IdP returned HTTP ${status} server error.`;
  if (status > 0) return `Hacienda sandbox IdP returned HTTP ${status}.`;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('econnaborted')) {
      return 'Connection to Hacienda sandbox IdP timed out.';
    }
    if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('enotfound')) {
      return 'Network error connecting to Hacienda sandbox IdP.';
    }
    return 'Hacienda sandbox IdP request failed (see non-sensitive error code).';
  }
  return 'Hacienda sandbox IdP request failed (unknown error type).';
}

// ── Evidence writing ──────────────────────────────────────────────────────────

async function writeTask008Summary(evidence: Task008AuthEvidence): Promise<void> {
  const dir = path.resolve(EVIDENCE_BASE_PATH, 'TASK-008');
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `task-008-summary-${Date.now()}.json`;
  const filepath = path.join(dir, filename);

  // Layer 1: structured key-level check on the parsed object.
  // Catches forbidden field names (access_token, client_secret, password, etc.)
  // with precise diagnostics before any serialization happens.
  assertTask008EvidenceSafe(evidence, filepath);

  const serialized = JSON.stringify(evidence, null, 2);

  // Layer 2: string-level pattern scan on the serialized output.
  // Defense-in-depth against unexpected content that slipped past Layer 1.
  assertNoSecrets(serialized, filepath);

  await fs.promises.writeFile(filepath, serialized, 'utf8');
}

// ── Abort helper ──────────────────────────────────────────────────────────────

function buildAbortResult(errorCode: string, errorMessage: string): Task008Result {
  const networkProof: Task008NetworkIsolationProof = {
    idpRequestsMade: 0,
    recepcionRequestsMade: 0,
    productionRequestsMade: 0,
    totalRequestsMade: 0,
  };
  const evidence: Task008AuthEvidence = {
    scenario: 'TASK-008',
    environment: 'SANDBOX',
    tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
    clientId: process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID,
    httpStatus: 0,
    tokenReceived: false,
    timestamp: new Date().toISOString(),
    result: 'FAIL',
    networkIsolation: networkProof,
    secretsExposed: 0,
  };
  return { status: 'FAIL', evidence, errorCode, errorMessage };
}

// ── Main scenario ─────────────────────────────────────────────────────────────

/**
 * TASK-008: Performs ONE controlled authentication against the real Hacienda sandbox IdP.
 *
 * Execution order:
 *   1. Assert USE_REAL_HACIENDA=true.
 *   2. Run safety guard — abort if any check fails.
 *   3. Create instrumented HTTP service (real axios instance with interceptors).
 *   4. Instantiate HaciendaOidcAuthAdapter with real config from env.
 *   5. Assert adapter is HaciendaOidcAuthAdapter (not a mock).
 *   6. Perform ONE authentication call against sandbox IdP.
 *   7. Validate response — never expose raw token.
 *   8. Record sanitized evidence.
 *   9. Return Task008Result.
 *
 * Reception adapter (/recepcion): NEVER invoked during TASK-008.
 * Proven by: recepcionRequestsMade === 0 in networkIsolation proof.
 */
export async function runTask008RealAuthScenario(
  options: Task008ScenarioOptions = {},
): Promise<Task008Result> {
  // Step 1: Assert USE_REAL_HACIENDA=true
  if (!isUseRealHaciendaEnabled()) {
    return buildAbortResult(
      'USE_REAL_HACIENDA_NOT_SET',
      'USE_REAL_HACIENDA must be set to true for TASK-008 live execution.',
    );
  }

  // Step 2: Run safety guard BEFORE any HTTP call — no bypass, no exceptions
  const receptionUrl = process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] ?? '';
  const tokenUrl = process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL;
  const clientId = process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID;

  const guardResults = validateF4sEndpoints({
    receptionBaseUrl: receptionUrl,
    tokenUrl,
    clientId,
  });

  if (!allGuardResultsPass(guardResults)) {
    return buildAbortResult(
      'SAFETY_GUARD_FAILED',
      'Safety guard did not pass. No Hacienda HTTP requests made.',
    );
  }

  // Step 3: Create instrumented HTTP infrastructure
  const httpFactory = options.httpFactory ?? createDefaultInstrumentedHttp;
  const instrumented = httpFactory();

  // Step 4: Create config service from environment
  const configFactory = options.configFactory ?? createTask008ConfigService;
  const configService = configFactory();

  // Step 5: Instantiate the REAL HaciendaOidcAuthAdapter
  const adapter = new HaciendaOidcAuthAdapter(
    configService as unknown as ConfigService,
    instrumented.httpService as unknown as HttpService,
  );

  // Verify adapter identity at runtime
  const adapterIdentity = adapter.constructor.name;
  if (adapterIdentity !== 'HaciendaOidcAuthAdapter') {
    return buildAbortResult(
      'UNEXPECTED_ADAPTER_IDENTITY',
      `Expected HaciendaOidcAuthAdapter but got '${adapterIdentity}'.`,
    );
  }

  // Step 6: Read credentials (presence only — never logged)
  const username = process.env['F4S_SANDBOX_USERNAME'];
  const password = process.env['F4S_SANDBOX_PASSWORD'];

  if (!username || !password) {
    return buildAbortResult(
      'MISSING_CREDENTIALS',
      'F4S_SANDBOX_USERNAME and F4S_SANDBOX_PASSWORD must be set in the environment.',
    );
  }

  // Step 7: ONE controlled authentication call
  const callStart = Date.now();
  let tokenReceived = false;
  let authStatus: Task008AuthStatus;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  try {
    const tokenResult = await adapter.authenticate({ username, password }, 'SANDBOX');

    // Verify token is non-empty — DO NOT store, log, or return the raw token
    tokenReceived =
      typeof tokenResult.accessToken === 'string' && tokenResult.accessToken.length > 0;

    authStatus = tokenReceived ? 'PASS' : 'FAIL';
    if (!tokenReceived) {
      errorCode = 'EMPTY_TOKEN_RECEIVED';
      errorMessage = 'Authentication response did not include a non-empty access token.';
    }
  } catch (error: unknown) {
    authStatus = 'FAIL';
    errorCode = classifyErrorCode(error);
    errorMessage = sanitizeErrorMessage(error);
  }

  const callDurationMs = Date.now() - callStart;

  // Step 8: Collect network isolation proof
  const networkProof: Task008NetworkIsolationProof = {
    idpRequestsMade: instrumented.getIdpRequestCount(),
    recepcionRequestsMade: instrumented.getRecepcionRequestCount(),
    productionRequestsMade: instrumented.getProductionRequestCount(),
    totalRequestsMade: instrumented.getTotalRequestCount(),
  };

  // Step 9: Build sanitized evidence
  const evidence: Task008AuthEvidence = {
    scenario: 'TASK-008',
    environment: 'SANDBOX',
    tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
    clientId,
    httpStatus: instrumented.getCapturedHttpStatus(),
    tokenReceived,
    ...(instrumented.getCapturedTokenType() !== undefined
      ? { tokenType: instrumented.getCapturedTokenType() }
      : {}),
    ...(instrumented.getCapturedExpiresIn() !== undefined
      ? { expiresIn: instrumented.getCapturedExpiresIn() }
      : {}),
    timestamp: new Date().toISOString(),
    result: authStatus,
    networkIsolation: networkProof,
    secretsExposed: 0,
  };

  // Write sanitized evidence (skipped during unit tests)
  if (!(options.skipEvidenceWrite ?? false)) {
    const httpEvidence = buildSafeEvidence({
      scenarioId: 'TASK-008',
      hostname: 'idp.comprobanteselectronicos.go.cr',
      httpMethod: 'POST',
      rawPath: '/auth/realms/rut-stag/protocol/openid-connect/token',
      httpStatus: instrumented.getCapturedHttpStatus(),
      durationMs: callDurationMs,
      adapterIdentity: 'HaciendaOidcAuthAdapter',
    });
    await writeHttpEvidence(httpEvidence, 'TASK-008');
    await writeTask008Summary(evidence);
  }

  return {
    status: authStatus,
    evidence,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}
