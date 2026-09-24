/**
 * TASK-009-STATUS Unit Tests — Query Existing Submission by Clave
 *
 * Tests the TASK-009-STATUS scenario logic WITHOUT making real Hacienda HTTP requests.
 * All NestJS bootstrapping is skipped via contextFactory injection.
 *
 * MANDATORY: These tests must NEVER contact real Hacienda infrastructure.
 * MANDATORY: POST /recepcion requests = ALWAYS 0.
 * MANDATORY: New FiscalDocuments = ALWAYS 0.
 * MANDATORY: New consecutives = ALWAYS 0.
 * MANDATORY: Production requests = ALWAYS 0.
 * MANDATORY: ACCEPTED only from ind-estado = 'aceptado'.
 * MANDATORY: REJECTED only from ind-estado = 'rechazado'.
 *
 * Covers:
 *   - USE_REAL_HACIENDA=false → abort
 *   - Safety guard failure → abort
 *   - Missing credentials → abort
 *   - Submission not found → abort
 *   - ind-estado=recibido → PASS, PENDING
 *   - ind-estado=procesando → PASS, PENDING
 *   - ind-estado=aceptado → PASS, ACCEPTED
 *   - ind-estado=rechazado → PASS, REJECTED
 *   - ind-estado=error → FAIL, HACIENDA_PROCESSING_ERROR
 *   - HTTP 404 (clave not found) → FAIL, CLAVE_NOT_FOUND_BY_HACIENDA
 *   - Auth failure → FAIL, QUERY_AUTH_FAILED
 *   - Provider 5xx → FAIL, QUERY_PROVIDER_5XX
 *   - Unknown ind-estado → FAIL, UNKNOWN_HACIENDA_STATUS
 *   - POST count always 0 in evidence
 *   - Production count always 0 in evidence
 *   - secretsExposed always 0
 */

import {
  runTask009StatusQueryScenario,
  type Task009StatusContext,
  type ExistingSubmission,
  type StatusQueryResult,
  type Task009StatusScenarioOptions,
} from '../scenarios/task-009-status-query';

// ── Environment helpers ───────────────────────────────────────────────────────

const SANDBOX_RECEPTION_URL = 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';
const SANDBOX_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';
const SANDBOX_CLIENT_ID = 'api-stag';

/** Clave from the real HTTP 202 sandbox run (safe to reference — it's a fiscal key, not a secret). */
const REAL_202_CLAVE = '50622092600310100000000100001010000000007157079215';

function setSandboxEnv(): void {
  process.env['USE_REAL_HACIENDA'] = 'true';
  process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] = SANDBOX_RECEPTION_URL;
  process.env['HACIENDA_IDP_SANDBOX_URL'] = SANDBOX_TOKEN_URL;
  process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] = SANDBOX_CLIENT_ID;
  process.env['F4S_SANDBOX_USERNAME'] = 'test-user-status';
  process.env['F4S_SANDBOX_PASSWORD'] = 'test-pass-status';
  process.env['F4S_COMPANY_ID'] = 'company-uuid-status';
  process.env['F4S_TENANT_ID'] = 'tenant-uuid-status';
  process.env['F4S_EXISTING_SUBMISSION_CLAVE'] = REAL_202_CLAVE;
}

function clearSandboxEnv(): void {
  const keys = [
    'USE_REAL_HACIENDA',
    'HACIENDA_RECEPCION_SANDBOX_BASE_URL',
    'HACIENDA_IDP_SANDBOX_URL',
    'HACIENDA_IDP_CLIENT_ID_SANDBOX',
    'F4S_SANDBOX_USERNAME',
    'F4S_SANDBOX_PASSWORD',
    'F4S_COMPANY_ID',
    'F4S_TENANT_ID',
    'F4S_EXISTING_SUBMISSION_CLAVE',
  ];
  for (const key of keys) delete process.env[key];
}

// ── Mock builders ─────────────────────────────────────────────────────────────

const READY_SUBMISSION: ExistingSubmission = {
  submissionId: 'sub-uuid-status-001',
  fiscalDocumentId: 'doc-uuid-status-001',
  clave: REAL_202_CLAVE,
  environment: 'SANDBOX',
  currentStatus: 'MANUAL_REVIEW_REQUIRED',
  lastHttpStatus: 202,
  lastNormalizedErrorCode: 'HACIENDA_UNEXPECTED_POST_STATUS',
  providerLocation: null,
  haciendaConnectionSecretReference: 'hacienda-conn-ref-status',
};

function makeQueryResult(overrides: Partial<StatusQueryResult>): StatusQueryResult {
  return {
    getHttpStatus: 200,
    indEstado: null,
    respuestaXmlPresent: false,
    newState: 'POST_OUTCOME_UNKNOWN',
    normalizedErrorCode: undefined,
    ...overrides,
  };
}

function buildMockContext(overrides: {
  submission?: ExistingSubmission | null;
  queryResult?: StatusQueryResult;
  queryFails?: unknown;
  bridgeFails?: boolean;
}): Task009StatusContext {
  return {
    findSubmissionByClave: jest.fn().mockResolvedValue(
      overrides.submission !== undefined ? overrides.submission : READY_SUBMISSION,
    ),

    bridgeSecrets: overrides.bridgeFails
      ? jest.fn().mockRejectedValue(new Error('BRIDGE_FAILED'))
      : jest.fn().mockResolvedValue(undefined),

    executeStatusQuery: overrides.queryFails
      ? jest.fn().mockRejectedValue(overrides.queryFails)
      : jest.fn().mockResolvedValue(
          overrides.queryResult ??
            makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
        ),
  };
}

function baseOptions(context: Task009StatusContext): Task009StatusScenarioOptions {
  return {
    contextFactory: async () => context,
    skipEvidenceWrite: true,
    targetClave: REAL_202_CLAVE,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TASK-009-STATUS Scenario — unit tests (no real network)', () => {
  beforeEach(setSandboxEnv);
  afterEach(clearSandboxEnv);

  // ── Precondition: USE_REAL_HACIENDA guard ────────────────────────────────

  describe('Precondition: USE_REAL_HACIENDA guard', () => {
    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is absent', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is false', async () => {
      process.env['USE_REAL_HACIENDA'] = 'false';
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('contextFactory is never called when USE_REAL_HACIENDA is not set', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const factory = jest.fn();
      await runTask009StatusQueryScenario({ contextFactory: factory, skipEvidenceWrite: true });
      expect(factory).not.toHaveBeenCalled();
    });
  });

  // ── Precondition: safety guard ────────────────────────────────────────────

  describe('Precondition: safety guard', () => {
    it('returns FAIL with SAFETY_GUARD_FAILED when production URL is configured', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SAFETY_GUARD_FAILED');
    });

    it('contextFactory is never called when safety guard fails', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const factory = jest.fn();
      await runTask009StatusQueryScenario({ contextFactory: factory, skipEvidenceWrite: true });
      expect(factory).not.toHaveBeenCalled();
    });

    it('productionRequestsMade is 0 when safety guard fails', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });
  });

  // ── Precondition: missing credentials ────────────────────────────────────

  describe('Precondition: missing credentials', () => {
    it('returns FAIL with MISSING_CREDENTIALS when username is absent', async () => {
      delete process.env['F4S_SANDBOX_USERNAME'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when password is absent', async () => {
      delete process.env['F4S_SANDBOX_PASSWORD'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when F4S_COMPANY_ID is absent', async () => {
      delete process.env['F4S_COMPANY_ID'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when F4S_TENANT_ID is absent', async () => {
      delete process.env['F4S_TENANT_ID'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when clave is absent', async () => {
      delete process.env['F4S_EXISTING_SUBMISSION_CLAVE'];
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });
  });

  // ── Submission not found ──────────────────────────────────────────────────

  describe('Submission not found', () => {
    it('returns FAIL with EXISTING_SUBMISSION_NOT_FOUND when no submission in DB', async () => {
      const context = buildMockContext({ submission: null });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('EXISTING_SUBMISSION_NOT_FOUND');
    });

    it('executeStatusQuery is never called when submission not found', async () => {
      const context = buildMockContext({ submission: null });
      await runTask009StatusQueryScenario(baseOptions(context));
      expect(context.executeStatusQuery).not.toHaveBeenCalled();
    });

    it('recepcionPostRequestsMade is 0 when submission not found', async () => {
      const context = buildMockContext({ submission: null });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.recepcionPostRequestsMade).toBe(0);
    });
  });

  // ── Hacienda status: recibido ─────────────────────────────────────────────

  describe('Hacienda status: recibido (confirmed, pending)', () => {
    it('returns PASS when ind-estado=recibido', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('PASS');
    });

    it('fiscalAcceptance=PENDING when ind-estado=recibido', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).toBe('PENDING');
    });

    it('newState is propagated into evidence for recibido', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.newState).toBe('PROCESSING');
    });
  });

  // ── Hacienda status: procesando ───────────────────────────────────────────

  describe('Hacienda status: procesando (confirmed, still processing)', () => {
    it('returns PASS when ind-estado=procesando', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'procesando', newState: 'PROCESSING' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('PASS');
      expect(result.evidence.fiscalAcceptance).toBe('PENDING');
    });
  });

  // ── Hacienda status: aceptado ─────────────────────────────────────────────

  describe('Hacienda status: aceptado (ACCEPTED — fiscal decision confirmed)', () => {
    it('returns PASS when ind-estado=aceptado', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({
          indEstado: 'aceptado',
          newState: 'ACCEPTED',
          respuestaXmlPresent: true,
        }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('PASS');
    });

    it('fiscalAcceptance=ACCEPTED when ind-estado=aceptado', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'aceptado', newState: 'ACCEPTED', respuestaXmlPresent: true }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).toBe('ACCEPTED');
    });

    it('ACCEPTED is NEVER produced from HTTP transport status alone — requires ind-estado', async () => {
      // HTTP 200 with no ind-estado must NOT produce ACCEPTED
      const context = buildMockContext({
        queryResult: makeQueryResult({ getHttpStatus: 200, indEstado: null, newState: 'MANUAL_REVIEW_REQUIRED' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).not.toBe('ACCEPTED');
    });

    it('respuestaXmlPresent is propagated into evidence', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'aceptado', newState: 'ACCEPTED', respuestaXmlPresent: true }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.respuestaXmlPresent).toBe(true);
    });
  });

  // ── Hacienda status: rechazado ────────────────────────────────────────────

  describe('Hacienda status: rechazado (REJECTED — fiscal decision confirmed)', () => {
    it('returns PASS when ind-estado=rechazado', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'rechazado', newState: 'REJECTED', respuestaXmlPresent: true }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('PASS');
      expect(result.evidence.fiscalAcceptance).toBe('REJECTED');
    });

    it('REJECTED is NEVER produced from HTTP transport status alone — requires ind-estado', async () => {
      // HTTP 200 with no ind-estado must NOT produce REJECTED
      const context = buildMockContext({
        queryResult: makeQueryResult({ getHttpStatus: 200, indEstado: null, newState: 'MANUAL_REVIEW_REQUIRED' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).not.toBe('REJECTED');
    });
  });

  // ── Hacienda status: error ────────────────────────────────────────────────

  describe('Hacienda status: error (Hacienda processing error)', () => {
    it('returns FAIL with HACIENDA_PROCESSING_ERROR when ind-estado=error', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'error', newState: 'MANUAL_REVIEW_REQUIRED' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('HACIENDA_PROCESSING_ERROR');
    });
  });

  // ── Hacienda status: clave not found (HTTP 404) ───────────────────────────

  describe('Hacienda status: clave not found', () => {
    it('returns FAIL with CLAVE_NOT_FOUND_BY_HACIENDA on HTTP 404', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({
          getHttpStatus: 404,
          indEstado: null,
          newState: 'MANUAL_REVIEW_REQUIRED',
          normalizedErrorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
        }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('CLAVE_NOT_FOUND_BY_HACIENDA');
    });

    it('fiscalAcceptance=NOT_FOUND on HTTP 404', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ getHttpStatus: 404, indEstado: null, newState: 'MANUAL_REVIEW_REQUIRED' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).toBe('NOT_FOUND');
    });
  });

  // ── Auth failure ──────────────────────────────────────────────────────────

  describe('Hacienda GET: auth failure', () => {
    it('returns FAIL with QUERY_AUTH_FAILED on HACIENDA_TOKEN_EXPIRED', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({
          getHttpStatus: 401,
          indEstado: null,
          newState: 'TECHNICAL_RETRY_PENDING',
          normalizedErrorCode: 'HACIENDA_TOKEN_EXPIRED',
        }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('QUERY_AUTH_FAILED');
    });
  });

  // ── Provider 5xx ─────────────────────────────────────────────────────────

  describe('Hacienda GET: provider 5xx', () => {
    it('returns FAIL with QUERY_PROVIDER_5XX on HACIENDA_UNAVAILABLE', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({
          getHttpStatus: 503,
          indEstado: null,
          newState: 'TECHNICAL_RETRY_PENDING',
          normalizedErrorCode: 'HACIENDA_UNAVAILABLE',
        }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('QUERY_PROVIDER_5XX');
    });
  });

  // ── Unknown ind-estado ────────────────────────────────────────────────────

  describe('Hacienda GET: unknown ind-estado', () => {
    it('returns FAIL with UNKNOWN_HACIENDA_STATUS when ind-estado is an undocumented value', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({
          getHttpStatus: 200,
          indEstado: 'undocumented-value-xyz',
          newState: 'MANUAL_REVIEW_REQUIRED',
          normalizedErrorCode: 'HACIENDA_UNKNOWN_STATUS',
        }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('UNKNOWN_HACIENDA_STATUS');
    });

    it('fiscalAcceptance=UNKNOWN for undocumented ind-estado', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'undocumented-value-xyz', newState: 'MANUAL_REVIEW_REQUIRED' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).toBe('UNKNOWN');
    });
  });

  // ── Network isolation invariants ──────────────────────────────────────────

  describe('Network isolation invariants', () => {
    it.each([
      ['recibido',  'PROCESSING'],
      ['procesando','PROCESSING'],
      ['aceptado',  'ACCEPTED'],
      ['rechazado', 'REJECTED'],
    ] as const)('recepcionPostRequestsMade=0 for ind-estado=%s', async (indEstado, newState) => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado, newState }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.recepcionPostRequestsMade).toBe(0);
    });

    it('productionRequestsMade is ALWAYS 0 on PASS', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('productionRequestsMade is ALWAYS 0 on FAIL (not found)', async () => {
      const context = buildMockContext({ submission: null });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('productionRequestsMade is ALWAYS 0 on guard failure', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const result = await runTask009StatusQueryScenario({ skipEvidenceWrite: true });
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('executeStatusQuery called exactly once per scenario run (no duplicate GETs)', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      await runTask009StatusQueryScenario(baseOptions(context));
      expect(context.executeStatusQuery).toHaveBeenCalledTimes(1);
    });

    it('findSubmissionByClave is called with the exact clave', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      await runTask009StatusQueryScenario(baseOptions(context));
      expect(context.findSubmissionByClave).toHaveBeenCalledWith(REAL_202_CLAVE);
    });
  });

  // ── Evidence integrity ────────────────────────────────────────────────────

  describe('Evidence integrity', () => {
    it('evidence.scenario is always TASK-009-STATUS', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.scenario).toBe('TASK-009-STATUS');
    });

    it('evidence.environment is always SANDBOX', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.environment).toBe('SANDBOX');
    });

    it('evidence.secretsExposed is always 0', async () => {
      const ctx1 = buildMockContext({});
      const ctx2 = buildMockContext({ submission: null });
      const [r1, r2] = await Promise.all([
        runTask009StatusQueryScenario(baseOptions(ctx1)),
        runTask009StatusQueryScenario(baseOptions(ctx2)),
      ]);
      expect(r1.evidence.secretsExposed).toBe(0);
      expect(r2.evidence.secretsExposed).toBe(0);
    });

    it('evidence does not contain password or token fields', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/access_token/i);
      expect(serialized).not.toMatch(/bearer/i);
    });

    it('evidence existingClave matches the queried clave', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.existingClave).toBe(REAL_202_CLAVE);
    });

    it('previousState from DB is reflected in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.previousState).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('previousPostHttpStatus=202 in evidence for the real 202 submission', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.previousPostHttpStatus).toBe(202);
    });

    it('evidence result matches overall PASS/FAIL status', async () => {
      const pass = buildMockContext({
        queryResult: makeQueryResult({ indEstado: 'recibido', newState: 'PROCESSING' }),
      });
      const fail = buildMockContext({ submission: null });
      const [r1, r2] = await Promise.all([
        runTask009StatusQueryScenario(baseOptions(pass)),
        runTask009StatusQueryScenario(baseOptions(fail)),
      ]);
      expect(r1.evidence.result).toBe(r1.status);
      expect(r2.evidence.result).toBe(r2.status);
    });

    it('timestamp is valid ISO 8601', async () => {
      const context = buildMockContext({});
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(new Date(result.evidence.timestamp).toISOString()).toBe(result.evidence.timestamp);
    });
  });

  // ── ACCEPTED / REJECTED source of truth ──────────────────────────────────

  describe('ACCEPTED and REJECTED only from authoritative ind-estado', () => {
    it('HTTP 200 without ind-estado does NOT produce ACCEPTED', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ getHttpStatus: 200, indEstado: null }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).not.toBe('ACCEPTED');
    });

    it('HTTP 200 without ind-estado does NOT produce REJECTED', async () => {
      const context = buildMockContext({
        queryResult: makeQueryResult({ getHttpStatus: 200, indEstado: null }),
      });
      const result = await runTask009StatusQueryScenario(baseOptions(context));
      expect(result.evidence.fiscalAcceptance).not.toBe('REJECTED');
    });

    it('ACCEPTED requires ind-estado=aceptado exclusively', async () => {
      const allNonAceptado = ['recibido', 'procesando', 'rechazado', 'error', null, 'unknown'];
      for (const indEstado of allNonAceptado) {
        const context = buildMockContext({
          queryResult: makeQueryResult({ indEstado, newState: 'PROCESSING' }),
        });
        const result = await runTask009StatusQueryScenario(baseOptions(context));
        expect(result.evidence.fiscalAcceptance).not.toBe('ACCEPTED');
      }
    });

    it('REJECTED requires ind-estado=rechazado exclusively', async () => {
      const allNonRechazado = ['recibido', 'procesando', 'aceptado', 'error', null, 'unknown'];
      for (const indEstado of allNonRechazado) {
        const context = buildMockContext({
          queryResult: makeQueryResult({ indEstado, newState: 'PROCESSING' }),
        });
        const result = await runTask009StatusQueryScenario(baseOptions(context));
        expect(result.evidence.fiscalAcceptance).not.toBe('REJECTED');
      }
    });
  });
});
