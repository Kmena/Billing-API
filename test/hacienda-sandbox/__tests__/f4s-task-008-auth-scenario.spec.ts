/**
 * TASK-008 Unit Tests — Real Hacienda Sandbox Authentication Scenario
 *
 * Tests the TASK-008 scenario logic without making real Hacienda HTTP requests.
 * All HTTP calls are intercepted by mock httpFactory overrides.
 *
 * MANDATORY: These tests must never contact real Hacienda infrastructure.
 * MANDATORY: These tests must pass in normal CI without any F4-S credentials.
 *
 * Covers:
 *   - USE_REAL_HACIENDA=false → abort before HTTP
 *   - Safety guard failure → abort before HTTP
 *   - Missing credentials → abort before HTTP
 *   - Successful auth → PASS, tokenReceived=true, token not in evidence
 *   - 401 response → FAIL, errorCode=AUTHENTICATION_FAILED_401
 *   - Network/connection error → FAIL, errorCode=IDP_UNAVAILABLE
 *   - Network isolation: recepcionRequestsMade=0 in all cases
 *   - Network isolation: productionRequestsMade=0 in all cases
 *   - Safety guard invoked before HTTP call (0 requests when guard fails)
 */

import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import {
  runTask008RealAuthScenario,
  type Task008InstrumentedHttp,
  type Task008ScenarioOptions,
} from '../scenarios/task-008-real-auth';

// ── Test environment helpers ──────────────────────────────────────────────────

const SANDBOX_RECEPTION_URL = 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';
const SANDBOX_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';
const SANDBOX_CLIENT_ID = 'api-stag';

function setSandboxEnv(): void {
  process.env['USE_REAL_HACIENDA'] = 'true';
  process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] = SANDBOX_RECEPTION_URL;
  process.env['HACIENDA_IDP_SANDBOX_URL'] = SANDBOX_TOKEN_URL;
  process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] = SANDBOX_CLIENT_ID;
  process.env['F4S_SANDBOX_USERNAME'] = 'test-user-task-008';
  process.env['F4S_SANDBOX_PASSWORD'] = 'test-pass-task-008';
}

function clearSandboxEnv(): void {
  const keys = [
    'USE_REAL_HACIENDA',
    'HACIENDA_RECEPCION_SANDBOX_BASE_URL',
    'HACIENDA_IDP_SANDBOX_URL',
    'HACIENDA_IDP_CLIENT_ID_SANDBOX',
    'F4S_SANDBOX_USERNAME',
    'F4S_SANDBOX_PASSWORD',
  ];
  for (const key of keys) {
    delete process.env[key];
  }
}

// ── Mock HTTP factory builders ────────────────────────────────────────────────

interface MockTokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
  refresh_token?: string;
}

/**
 * Builds a mock httpFactory that returns a successful token response.
 * Tracks request counts for network isolation proof verification.
 */
function buildSuccessHttpFactory(tokenResponse: MockTokenResponse): () => Task008InstrumentedHttp {
  return () => {
    let idpCount = 0;
    let recepcionCount = 0;
    let productionCount = 0;
    let totalCount = 0;

    const mockPost = jest
      .fn()
      .mockImplementation(
        <T>(url: string): ReturnType<Task008InstrumentedHttp['httpService']['post']> => {
          totalCount++;
          if (url.includes('idp.comprobanteselectronicos.go.cr')) idpCount++;
          if (
            url.includes('api-sandbox.comprobanteselectronicos.go.cr') &&
            url.includes('/recepcion')
          )
            recepcionCount++;
          if (url.includes('api.comprobanteselectronicos.go.cr')) productionCount++;

          return of({
            data: tokenResponse as T,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { url } as AxiosResponse['config'],
          } as AxiosResponse<T>);
        },
      );

    return {
      httpService: { post: mockPost },
      getIdpRequestCount: () => idpCount,
      getRecepcionRequestCount: () => recepcionCount,
      getProductionRequestCount: () => productionCount,
      getTotalRequestCount: () => totalCount,
      getCapturedHttpStatus: () => 200,
      getCapturedTokenType: () => tokenResponse.token_type,
      getCapturedExpiresIn: () => tokenResponse.expires_in,
    };
  };
}

/**
 * Builds a mock httpFactory that throws an HTTP error response.
 */
function buildErrorHttpFactory(httpStatus: number): () => Task008InstrumentedHttp {
  return () => {
    let idpCount = 0;
    let recepcionCount = 0;
    let productionCount = 0;
    let totalCount = 0;

    const axiosError = Object.assign(new Error(`Request failed with status code ${httpStatus}`), {
      response: { status: httpStatus, data: { error: 'test_error' } },
      isAxiosError: true,
    });

    const mockPost = jest
      .fn()
      .mockImplementation(
        (url: string): ReturnType<Task008InstrumentedHttp['httpService']['post']> => {
          totalCount++;
          if (url.includes('idp.comprobanteselectronicos.go.cr')) idpCount++;
          if (
            url.includes('api-sandbox.comprobanteselectronicos.go.cr') &&
            url.includes('/recepcion')
          )
            recepcionCount++;
          if (url.includes('api.comprobanteselectronicos.go.cr')) productionCount++;

          return throwError(() => axiosError) as ReturnType<
            Task008InstrumentedHttp['httpService']['post']
          >;
        },
      );

    return {
      httpService: { post: mockPost },
      getIdpRequestCount: () => idpCount,
      getRecepcionRequestCount: () => recepcionCount,
      getProductionRequestCount: () => productionCount,
      getTotalRequestCount: () => totalCount,
      getCapturedHttpStatus: () => httpStatus,
      getCapturedTokenType: () => undefined,
      getCapturedExpiresIn: () => undefined,
    };
  };
}

/**
 * Builds a mock httpFactory that throws a network/connection error (no HTTP response).
 */
function buildNetworkErrorHttpFactory(): () => Task008InstrumentedHttp {
  return () => {
    let idpCount = 0;
    let recepcionCount = 0;
    let productionCount = 0;
    let totalCount = 0;

    const networkError = Object.assign(new Error('connect ECONNREFUSED'), {
      isAxiosError: true,
      code: 'ECONNREFUSED',
      // No response property — simulates a network-level failure
    });

    const mockPost = jest
      .fn()
      .mockImplementation(
        (url: string): ReturnType<Task008InstrumentedHttp['httpService']['post']> => {
          totalCount++;
          if (url.includes('idp.comprobanteselectronicos.go.cr')) idpCount++;
          if (
            url.includes('api-sandbox.comprobanteselectronicos.go.cr') &&
            url.includes('/recepcion')
          )
            recepcionCount++;
          if (url.includes('api.comprobanteselectronicos.go.cr')) productionCount++;

          return throwError(() => networkError) as ReturnType<
            Task008InstrumentedHttp['httpService']['post']
          >;
        },
      );

    return {
      httpService: { post: mockPost },
      getIdpRequestCount: () => idpCount,
      getRecepcionRequestCount: () => recepcionCount,
      getProductionRequestCount: () => productionCount,
      getTotalRequestCount: () => totalCount,
      getCapturedHttpStatus: () => 0,
      getCapturedTokenType: () => undefined,
      getCapturedExpiresIn: () => undefined,
    };
  };
}

/** Base options for all TASK-008 unit tests (skips file writes, uses mock HTTP). */
function baseOptions(httpFactory: () => Task008InstrumentedHttp): Task008ScenarioOptions {
  return {
    httpFactory,
    skipEvidenceWrite: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TASK-008 Real Hacienda Auth Scenario — unit tests (no real network)', () => {
  beforeEach(() => {
    setSandboxEnv();
  });

  afterEach(() => {
    clearSandboxEnv();
  });

  // ── Guard and precondition tests ────────────────────────────────────────────

  describe('Precondition: USE_REAL_HACIENDA guard', () => {
    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is absent', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
      expect(result.evidence.networkIsolation.totalRequestsMade).toBe(0);
    });

    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is false', async () => {
      process.env['USE_REAL_HACIENDA'] = 'false';
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('makes ZERO HTTP requests when USE_REAL_HACIENDA is not set', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      let httpCallCount = 0;
      const countingFactory = (): Task008InstrumentedHttp => ({
        httpService: {
          post: (<_T>(_url: string) => {
            httpCallCount++;
            return of({} as AxiosResponse<_T>);
          }) as Task008InstrumentedHttp['httpService']['post'],
        },
        getIdpRequestCount: () => 0,
        getRecepcionRequestCount: () => 0,
        getProductionRequestCount: () => 0,
        getTotalRequestCount: () => httpCallCount,
        getCapturedHttpStatus: () => 0,
        getCapturedTokenType: () => undefined,
        getCapturedExpiresIn: () => undefined,
      });

      await runTask008RealAuthScenario(baseOptions(countingFactory));
      expect(httpCallCount).toBe(0);
    });
  });

  describe('Precondition: credentials', () => {
    it('returns FAIL with SAFETY_GUARD_FAILED when production URL is configured', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/';
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SAFETY_GUARD_FAILED');
    });

    it('makes ZERO HTTP requests when safety guard fails', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/';
      let httpCallCount = 0;
      const countingFactory = (): Task008InstrumentedHttp => ({
        httpService: {
          post: (<T>(_url: string) => {
            httpCallCount++;
            return of({} as AxiosResponse<T>);
          }) as Task008InstrumentedHttp['httpService']['post'],
        },
        getIdpRequestCount: () => 0,
        getRecepcionRequestCount: () => 0,
        getProductionRequestCount: () => 0,
        getTotalRequestCount: () => httpCallCount,
        getCapturedHttpStatus: () => 0,
        getCapturedTokenType: () => undefined,
        getCapturedExpiresIn: () => undefined,
      });

      await runTask008RealAuthScenario(baseOptions(countingFactory));
      expect(httpCallCount).toBe(0);
    });

    it('returns FAIL when production client ID is configured', async () => {
      process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] = 'api-prod';
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SAFETY_GUARD_FAILED');
    });
  });

  describe('Precondition: credentials', () => {
    it('returns FAIL with MISSING_CREDENTIALS when username is absent', async () => {
      delete process.env['F4S_SANDBOX_USERNAME'];
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
      expect(result.evidence.networkIsolation.totalRequestsMade).toBe(0);
    });

    it('returns FAIL with MISSING_CREDENTIALS when password is absent', async () => {
      delete process.env['F4S_SANDBOX_PASSWORD'];
      const successFactory = buildSuccessHttpFactory({
        access_token: 'should-not-reach',
        expires_in: 300,
      });
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));

      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
      expect(result.evidence.networkIsolation.totalRequestsMade).toBe(0);
    });
  });

  // ── Success path tests ──────────────────────────────────────────────────────

  describe('Success path: valid token received', () => {
    const validTokenResponse: MockTokenResponse = {
      access_token: 'real-sandbox-access-token-must-not-appear-in-evidence',
      expires_in: 300,
      token_type: 'Bearer',
      refresh_token: 'real-sandbox-refresh-token-must-not-appear',
    };

    let successFactory: () => Task008InstrumentedHttp;

    beforeEach(() => {
      successFactory = buildSuccessHttpFactory(validTokenResponse);
    });

    it('returns PASS status on successful authentication', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.status).toBe('PASS');
    });

    it('records tokenReceived=true in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.tokenReceived).toBe(true);
    });

    it('does NOT include the raw access_token in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      const evidenceStr = JSON.stringify(result.evidence);
      // The raw token value must not appear in the evidence
      expect(evidenceStr).not.toContain('real-sandbox-access-token-must-not-appear-in-evidence');
    });

    it('does NOT include the raw refresh_token in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      const evidenceStr = JSON.stringify(result.evidence);
      expect(evidenceStr).not.toContain('real-sandbox-refresh-token-must-not-appear');
    });

    it('records tokenType in evidence when provided', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.tokenType).toBe('Bearer');
    });

    it('records expiresIn in evidence when provided', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.expiresIn).toBe(300);
    });

    it('records environment=SANDBOX in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.environment).toBe('SANDBOX');
    });

    it('records scenario=TASK-008 in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.scenario).toBe('TASK-008');
    });

    it('records secretsExposed=0 in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.secretsExposed).toBe(0);
    });

    it('records the correct token endpoint host in evidence', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.evidence.tokenEndpointHost).toBe('idp.comprobanteselectronicos.go.cr');
    });

    it('does not include errorCode in PASS result', async () => {
      const result = await runTask008RealAuthScenario(baseOptions(successFactory));
      expect(result.errorCode).toBeUndefined();
    });
  });

  // ── Network isolation proof tests ───────────────────────────────────────────

  describe('Network isolation proof', () => {
    it('records exactly 1 IdP request after successful auth', async () => {
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.idpRequestsMade).toBe(1);
    });

    it('records ZERO recepcion requests after successful auth', async () => {
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.recepcionRequestsMade).toBe(0);
    });

    it('records ZERO production requests after successful auth', async () => {
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('records ZERO recepcion requests after 401 failure', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.recepcionRequestsMade).toBe(0);
    });

    it('records ZERO production requests after network error', async () => {
      const factory = buildNetworkErrorHttpFactory();
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('records ZERO total requests when safety guard aborts', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/';
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.totalRequestsMade).toBe(0);
    });
  });

  // ── Failure path tests ──────────────────────────────────────────────────────

  describe('Failure path: HTTP 401 Unauthorized', () => {
    it('returns FAIL status on 401', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.status).toBe('FAIL');
    });

    it('records errorCode=AUTHENTICATION_FAILED_401 on 401', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.errorCode).toBe('AUTHENTICATION_FAILED_401');
    });

    it('does not retry on 401 (only 1 IdP request total)', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.networkIsolation.idpRequestsMade).toBe(1);
    });

    it('records tokenReceived=false on 401', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.tokenReceived).toBe(false);
    });
  });

  describe('Failure path: network/connection error', () => {
    it('returns FAIL status on network error', async () => {
      const factory = buildNetworkErrorHttpFactory();
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.status).toBe('FAIL');
    });

    it('records errorCode=IDP_UNAVAILABLE on connection error', async () => {
      const factory = buildNetworkErrorHttpFactory();
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.errorCode).toBe('IDP_UNAVAILABLE');
    });

    it('records tokenReceived=false on network error', async () => {
      const factory = buildNetworkErrorHttpFactory();
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.tokenReceived).toBe(false);
    });

    it('records httpStatus=0 when no HTTP response exists', async () => {
      const factory = buildNetworkErrorHttpFactory();
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.httpStatus).toBe(0);
    });
  });

  describe('Failure path: HTTP 429 rate limiting', () => {
    it('returns FAIL with RATE_LIMITED_429 on 429', async () => {
      const factory = buildErrorHttpFactory(429);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('RATE_LIMITED_429');
    });
  });

  describe('Failure path: HTTP 500 server error', () => {
    it('returns FAIL with IDP_SERVER_ERROR_500 on 500', async () => {
      const factory = buildErrorHttpFactory(500);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('IDP_SERVER_ERROR_500');
    });
  });

  // ── Evidence integrity tests ────────────────────────────────────────────────

  describe('Evidence integrity', () => {
    it('evidence result matches status in PASS case', async () => {
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.result).toBe(result.status);
    });

    it('evidence result matches status in FAIL case', async () => {
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(result.evidence.result).toBe(result.status);
    });

    it('evidence timestamp is a valid ISO 8601 string', async () => {
      const factory = buildSuccessHttpFactory({ access_token: 'tok', expires_in: 300 });
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      expect(() => new Date(result.evidence.timestamp)).not.toThrow();
      expect(new Date(result.evidence.timestamp).toISOString()).toBe(result.evidence.timestamp);
    });

    it('does not expose credentials in error message (sanitized)', async () => {
      process.env['F4S_SANDBOX_USERNAME'] = 'my-secret-username';
      process.env['F4S_SANDBOX_PASSWORD'] = 'my-secret-password';
      const factory = buildErrorHttpFactory(401);
      const result = await runTask008RealAuthScenario(baseOptions(factory));
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('my-secret-username');
      expect(resultStr).not.toContain('my-secret-password');
    });
  });
});

// ── Evidence serialization safety — regression tests ──────────────────────────
// Verifies the false-positive fix: the evidence produced by TASK-008 can be
// serialized without triggering assertNoSecrets, and that raw OAuth token
// fields are never present in the evidence object.

describe('TASK-008 evidence serialization safety', () => {
  beforeEach(setSandboxEnv);
  afterEach(clearSandboxEnv);

  const opts = (factory: () => Task008InstrumentedHttp): Task008ScenarioOptions => ({
    httpFactory: factory,
    skipEvidenceWrite: true,
  });

  it('PASS evidence does not contain access_token key', async () => {
    // Raw OAuth response objects must never be passed to evidence.
    // The access_token received from Hacienda must NEVER appear as an evidence key.
    const result = await runTask008RealAuthScenario(
      opts(buildSuccessHttpFactory({ access_token: 'FAKE_SENTINEL_TOKEN', expires_in: 3600 })),
    );
    expect(result.status).toBe('PASS');
    expect(Object.keys(result.evidence)).not.toContain('access_token');
    expect(JSON.stringify(result.evidence)).not.toContain('FAKE_SENTINEL_TOKEN');
  });

  it('PASS evidence does not contain refresh_token key', async () => {
    const result = await runTask008RealAuthScenario(
      opts(
        buildSuccessHttpFactory({
          access_token: 'FAKE_SENTINEL_TOKEN',
          refresh_token: 'FAKE_SENTINEL_REFRESH',
          expires_in: 3600,
        }),
      ),
    );
    expect(result.status).toBe('PASS');
    expect(Object.keys(result.evidence)).not.toContain('refresh_token');
    expect(JSON.stringify(result.evidence)).not.toContain('FAKE_SENTINEL_REFRESH');
  });

  it('PASS evidence with secretsExposed: 0 serializes without throwing — core regression', () => {
    // The old /secret/i pattern falsely blocked this because the key name
    // "secretsExposed" contains the substring "secret".
    // With the fix, the serialized evidence must not throw assertNoSecrets.
    const { assertNoSecrets } = jest.requireActual<
      typeof import('../evidence/f4s-evidence-collector')
    >('../evidence/f4s-evidence-collector');
    const serialized = JSON.stringify({
      scenario: 'TASK-008',
      environment: 'SANDBOX',
      tokenEndpointHost: 'idp.comprobanteselectronicos.go.cr',
      clientId: 'api-stag',
      httpStatus: 200,
      tokenReceived: true,
      tokenType: 'Bearer',
      expiresIn: 3600,
      timestamp: new Date().toISOString(),
      result: 'PASS',
      networkIsolation: {
        idpRequestsMade: 1,
        recepcionRequestsMade: 0,
        productionRequestsMade: 0,
        totalRequestsMade: 1,
      },
      secretsExposed: 0,
    });
    expect(() => assertNoSecrets(serialized, 'regression-test')).not.toThrow();
  });

  it('PASS evidence secretsExposed field is exactly 0', async () => {
    const result = await runTask008RealAuthScenario(
      opts(buildSuccessHttpFactory({ access_token: 'FAKE_SENTINEL_TOKEN', expires_in: 3600 })),
    );
    expect(result.evidence.secretsExposed).toBe(0);
  });

  it('PASS evidence tokenReceived is true and raw token value absent from serialized output', async () => {
    const result = await runTask008RealAuthScenario(
      opts(buildSuccessHttpFactory({ access_token: 'FAKE_SENTINEL_TOKEN', expires_in: 3600 })),
    );
    expect(result.evidence.tokenReceived).toBe(true);
    expect(JSON.stringify(result.evidence)).not.toContain('FAKE_SENTINEL_TOKEN');
  });
});
