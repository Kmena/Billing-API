/**
 * TASK-009 Unit Tests — Real FE Submission via Billing Normal Pipeline
 *
 * Tests the TASK-009 scenario logic WITHOUT making real Hacienda HTTP requests.
 * All NestJS bootstrapping is skipped via contextFactory injection.
 *
 * MANDATORY: These tests must never contact real Hacienda infrastructure.
 * MANDATORY: These tests must pass in normal CI without any F4-S credentials.
 *
 * Covers:
 *   - USE_REAL_HACIENDA=false → abort before context bootstrap
 *   - Safety guard failure → abort before context bootstrap
 *   - Missing credentials/env vars → abort before context bootstrap
 *   - Company not found → FAIL, COMPANY_NOT_FOUND
 *   - Fiscal profile missing → FAIL, FISCAL_PROFILE_MISSING
 *   - Hacienda connection not connected → FAIL, HACIENDA_CONNECTION_NOT_CONNECTED
 *   - Signing certificate not configured → FAIL, SIGNING_CERTIFICATE_NOT_CONFIGURED
 *   - Production endpoint blocked before HTTP
 *   - Successful mock submission → PASS, ACKNOWLEDGED
 *   - HTTP 201 → ACKNOWLEDGED, http201MappedToAccepted=false
 *   - TECHNICAL_RETRY_PENDING → FAIL
 *   - POST_OUTCOME_UNKNOWN → FAIL, SUBMISSION_AMBIGUOUS_5XX
 *   - Rate limited → FAIL, RATE_LIMITED_429
 *   - Network isolation: productionRequestsMade=0 always
 *   - Evidence: no raw token, no certificate, no PIN, no password
 *   - secretsExposed=0 in all cases
 *   - http201MappedToAccepted=false in all cases
 */

import {
  runTask009FeSubmissionScenario,
  type Task009Context,
  type Task009Prerequisites,
  type Task009PreparedDocument,
  type Task009CreatedDocument,
  type Task009SubmissionOutcome,
  type Task009ScenarioOptions,
} from '../scenarios/task-009-fe-submission';

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
  process.env['F4S_SANDBOX_USERNAME'] = 'test-user-task-009';
  process.env['F4S_SANDBOX_PASSWORD'] = 'test-pass-task-009';
  process.env['F4S_SANDBOX_CERT_PATH'] = '/tmp/f4s-test-cert.p12';
  process.env['F4S_SANDBOX_CERT_PIN'] = 'test-pin';
  process.env['F4S_COMPANY_ID'] = 'company-uuid-0009';
  process.env['F4S_TENANT_ID'] = 'tenant-uuid-0009';
}

function clearSandboxEnv(): void {
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
  ];
  for (const key of keys) {
    delete process.env[key];
  }
}

// ── Mock context builders ─────────────────────────────────────────────────────

/** Complete mock prerequisites — all READY */
const READY_PREREQUISITES: Task009Prerequisites = {
  companyExists: true,
  fiscalProfileExists: true,
  haciendaConnectionConnected: true,
  signingCertificateConfigured: true,
  haciendaConnectionSecretReference: 'hacienda-secret-ref',
  signingCertificateSecretReference: 'cert-secret-ref',
  signingCertificatePasswordSecretReference: 'cert-pass-ref',
};

/** Stage 1 output */
const CREATED_DOCUMENT: Task009CreatedDocument = {
  documentId: 'doc-uuid-0009',
  clave: '50612011500310100001100100001000000010019999990001',
};

/** Stage 2 output (combined for backward-compat assertions) */
const PREPARED_DOCUMENT: Task009PreparedDocument = {
  documentId: CREATED_DOCUMENT.documentId,
  clave: CREATED_DOCUMENT.clave,
  signedXmlSha256: 'a'.repeat(64),
  submissionId: 'submission-uuid-0009',
};

/** Fake HttpException factory — duck-typed, no @nestjs/common import needed. */
function makeBadRequest(code: string): unknown {
  return {
    getStatus: () => 400,
    getResponse: () => ({ code }),
    constructor: { name: 'BadRequestException' },
    message: 'Bad Request Exception',
  };
}

/**
 * Fake XSD validation failure — includes sanitized errors array.
 * Mirrors the exact BadRequestException thrown by PrepareFiscalXmlService.
 */
function makeXsdValidationFailure(errorMessage: string, line?: number): unknown {
  return {
    getStatus: () => 400,
    getResponse: () => ({
      code: 'FISCAL_XML_VALIDATION_FAILED',
      errors: [{ code: 'FISCAL_XML_VALIDATION_FAILED', message: errorMessage, line: line ?? null }],
    }),
    constructor: { name: 'BadRequestException' },
    message: 'Bad Request Exception',
  };
}

/** Mock successful submission outcome — HTTP 201 → ACKNOWLEDGED */
const ACKNOWLEDGED_OUTCOME: Task009SubmissionOutcome = {
  submissionState: 'ACKNOWLEDGED',
  httpStatus: 201,
  locationHeaderPresent: true,
};

function buildMockContext(overrides: {
  prereqs?: Partial<Task009Prerequisites>;
  bridgeFails?: boolean;
  /** Error thrown from createDocument (stage 1). */
  createDocumentFails?: unknown;
  /** Error thrown from prepareXmlAndQueue (stage 2). */
  prepareXmlFails?: unknown;
  outcome?: Partial<Task009SubmissionOutcome>;
  outcomeFails?: boolean;
}): Task009Context {
  const prereqs: Task009Prerequisites = {
    ...READY_PREREQUISITES,
    ...overrides.prereqs,
  };

  return {
    checkPrerequisites: jest.fn().mockResolvedValue(prereqs),

    bridgeSecrets: overrides.bridgeFails
      ? jest.fn().mockRejectedValue(new Error('BRIDGE_FAILED'))
      : jest.fn().mockResolvedValue(undefined),

    createTempApiKey: jest.fn().mockResolvedValue('temp-api-key-uuid'),

    createDocument: overrides.createDocumentFails
      ? jest.fn().mockRejectedValue(overrides.createDocumentFails)
      : jest.fn().mockResolvedValue(CREATED_DOCUMENT),

    prepareXmlAndQueue: overrides.prepareXmlFails
      ? jest.fn().mockRejectedValue(overrides.prepareXmlFails)
      : jest.fn().mockResolvedValue({
          signedXmlSha256: PREPARED_DOCUMENT.signedXmlSha256,
          submissionId: PREPARED_DOCUMENT.submissionId,
        }),

    executeSubmission: overrides.outcomeFails
      ? jest.fn().mockRejectedValue(new Error('EXECUTION_FAILED'))
      : jest.fn().mockResolvedValue({
          ...ACKNOWLEDGED_OUTCOME,
          ...overrides.outcome,
        }),

    findSubmission: jest
      .fn()
      .mockResolvedValue({ id: 'submission-uuid-0009', status: 'ACKNOWLEDGED' }),
  };
}

function baseOptions(context: Task009Context): Task009ScenarioOptions {
  return {
    contextFactory: async () => context,
    skipEvidenceWrite: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TASK-009 FE Submission Scenario — unit tests (no real network)', () => {
  beforeEach(setSandboxEnv);
  afterEach(clearSandboxEnv);

  // ── Precondition: USE_REAL_HACIENDA guard ────────────────────────────────

  describe('Precondition: USE_REAL_HACIENDA guard', () => {
    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is absent', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('returns FAIL with USE_REAL_HACIENDA_NOT_SET when flag is false', async () => {
      process.env['USE_REAL_HACIENDA'] = 'false';
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('makes ZERO HTTP requests when USE_REAL_HACIENDA is not set', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario({
        contextFactory: async () => context,
        skipEvidenceWrite: true,
      });
      expect(result.status).toBe('FAIL');
      expect(context.checkPrerequisites).not.toHaveBeenCalled();
    });
  });

  // ── Precondition: safety guard ───────────────────────────────────────────

  describe('Precondition: safety guard', () => {
    it('returns FAIL with SAFETY_GUARD_FAILED when production reception URL is configured', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SAFETY_GUARD_FAILED');
    });

    it('makes ZERO HTTP requests when safety guard fails', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const context = buildMockContext({});
      await runTask009FeSubmissionScenario({
        contextFactory: async () => context,
        skipEvidenceWrite: true,
      });
      expect(context.checkPrerequisites).not.toHaveBeenCalled();
      expect(context.createDocument).not.toHaveBeenCalled();
      expect(context.executeSubmission).not.toHaveBeenCalled();
    });

    it('production endpoint is blocked: productionRequestsMade=0 in abort result', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });
  });

  // ── Precondition: missing credentials ───────────────────────────────────

  describe('Precondition: missing credentials', () => {
    it('returns FAIL with MISSING_CREDENTIALS when username is absent', async () => {
      delete process.env['F4S_SANDBOX_USERNAME'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when password is absent', async () => {
      delete process.env['F4S_SANDBOX_PASSWORD'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when cert path is absent', async () => {
      delete process.env['F4S_SANDBOX_CERT_PATH'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when cert PIN is absent', async () => {
      delete process.env['F4S_SANDBOX_CERT_PIN'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when F4S_COMPANY_ID is absent', async () => {
      delete process.env['F4S_COMPANY_ID'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns FAIL with MISSING_CREDENTIALS when F4S_TENANT_ID is absent', async () => {
      delete process.env['F4S_TENANT_ID'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('makes ZERO context calls when credentials are missing', async () => {
      delete process.env['F4S_SANDBOX_USERNAME'];
      const context = buildMockContext({});
      await runTask009FeSubmissionScenario({
        contextFactory: async () => context,
        skipEvidenceWrite: true,
      });
      expect(context.checkPrerequisites).not.toHaveBeenCalled();
    });
  });

  // ── Precondition: company prerequisites ──────────────────────────────────

  describe('Precondition: company prerequisites', () => {
    it('returns FAIL with COMPANY_NOT_FOUND when company does not exist', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('COMPANY_NOT_FOUND');
    });

    it('returns FAIL with FISCAL_PROFILE_MISSING when fiscal profile absent', async () => {
      const context = buildMockContext({ prereqs: { fiscalProfileExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('FISCAL_PROFILE_MISSING');
    });

    it('returns FAIL with HACIENDA_CONNECTION_NOT_CONNECTED when connection not active', async () => {
      const context = buildMockContext({ prereqs: { haciendaConnectionConnected: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('HACIENDA_CONNECTION_NOT_CONNECTED');
    });

    it('returns FAIL with SIGNING_CERTIFICATE_NOT_CONFIGURED when no certificate', async () => {
      const context = buildMockContext({ prereqs: { signingCertificateConfigured: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SIGNING_CERTIFICATE_NOT_CONFIGURED');
    });

    it('returns FAIL when connection secret reference is null', async () => {
      const context = buildMockContext({
        prereqs: { haciendaConnectionSecretReference: null },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SIGNING_CERTIFICATE_NOT_CONFIGURED');
    });

    it('does NOT call createDocument when company prerequisite check fails', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      await runTask009FeSubmissionScenario(baseOptions(context));
      expect(context.createDocument).not.toHaveBeenCalled();
      expect(context.executeSubmission).not.toHaveBeenCalled();
    });

    it('wrong company is blocked before HTTP — productionRequestsMade=0', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('wrong tenant is blocked before HTTP', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.recepcionPostRequestsMade).toBe(0);
    });
  });

  // ── Document creation and XML preparation failures ───────────────────────

  describe('Document creation and XML preparation', () => {
    // Requirement 7: failure stage is explicit
    // Requirement 8: XML_PREPARATION_FAILED is NOT determined by string matching

    it('returns FAIL with XML_PREPARATION_FAILED when prepareXmlAndQueue throws', async () => {
      // Stage is EXPLICIT: prepareXmlAndQueue threw — not inferred from message content
      const context = buildMockContext({ prepareXmlFails: new Error('SOME_XML_ERROR') });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('XML_PREPARATION_FAILED');
    });

    it('returns FAIL with DOCUMENT_CREATION_FAILED when createDocument throws', async () => {
      // Stage is EXPLICIT: createDocument threw
      const context = buildMockContext({
        createDocumentFails: new Error('SOME_CREATION_ERROR'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('DOCUMENT_CREATION_FAILED');
    });

    it('pipelineStage is DOCUMENT_CREATION when createDocument fails', async () => {
      const context = buildMockContext({
        createDocumentFails: makeBadRequest('COMPANY_FISCAL_PROFILE_INCOMPLETE'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.pipelineStage).toBe('DOCUMENT_CREATION');
    });

    it('pipelineStage is XML_PREPARATION when prepareXmlAndQueue fails', async () => {
      const context = buildMockContext({
        prepareXmlFails: makeBadRequest('FISCAL_XML_SIGNING_FAILED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.pipelineStage).toBe('XML_PREPARATION');
    });

    it('preserves domainCode from BadRequestException in DOCUMENT_CREATION failure', async () => {
      const context = buildMockContext({
        createDocumentFails: makeBadRequest('COMPANY_FISCAL_PROFILE_INCOMPLETE'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.domainCode).toBe('COMPANY_FISCAL_PROFILE_INCOMPLETE');
      expect(result.evidence.httpStatus).toBe(400);
    });

    it('preserves domainCode from BadRequestException in XML_PREPARATION failure', async () => {
      const context = buildMockContext({
        prepareXmlFails: makeBadRequest('FISCAL_XML_SIGNING_FAILED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.domainCode).toBe('FISCAL_XML_SIGNING_FAILED');
      expect(result.evidence.httpStatus).toBe(400);
    });

    it('captures xsdFirstError in evidence when prepareXmlAndQueue fails with FISCAL_XML_VALIDATION_FAILED', async () => {
      // Reproduces TASK-009 root cause: Emisor.Nombre < 5 chars → XSD minLength error
      const context = buildMockContext({
        prepareXmlFails: makeXsdValidationFailure('value length cannot be lesser than 5', 42),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.domainCode).toBe('FISCAL_XML_VALIDATION_FAILED');
      expect(result.evidence.xsdFirstError).toBeDefined();
      expect(result.evidence.xsdFirstError?.xsdLine).toBe(42);
      expect(result.evidence.xsdFirstError?.xsdMessage).toBe('value length cannot be lesser than 5');
    });

    it('xsdFirstError is absent when DOCUMENT_CREATION fails (not an XSD failure)', async () => {
      const context = buildMockContext({
        createDocumentFails: makeBadRequest('COMPANY_FISCAL_PROFILE_INCOMPLETE'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.xsdFirstError).toBeUndefined();
    });

    it('xsdFirstError is absent for non-XSD XML_PREPARATION failures', async () => {
      const context = buildMockContext({
        prepareXmlFails: makeBadRequest('FISCAL_XML_SIGNING_FAILED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.xsdFirstError).toBeUndefined();
    });

    it('xsdFirstError.xsdMessage strips XML tags but preserves diagnostic text content', async () => {
      // Tags are stripped; text between tags (the offending value) is preserved
      // so the operator can see exactly what field value caused the XSD failure.
      const context = buildMockContext({
        prepareXmlFails: makeXsdValidationFailure('<Nombre>Corp</Nombre>', 10),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.xsdFirstError?.xsdMessage).not.toContain('<Nombre>');
      expect(result.evidence.xsdFirstError?.xsdMessage).toContain('[xml]');
    });

    // Requirement 8: stage NOT determined by string matching
    it('classifies as XML_PREPARATION_FAILED even when error message has NO XML keywords', async () => {
      // No 'XML', 'XSD', 'SIGN', or 'certificate' in the message
      const context = buildMockContext({
        prepareXmlFails: new Error('completely_generic_error_without_xml_keywords'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      // Stage is explicit from WHICH method threw — not from message content
      expect(result.errorCode).toBe('XML_PREPARATION_FAILED');
      expect(result.evidence.pipelineStage).toBe('XML_PREPARATION');
    });

    it('classifies as DOCUMENT_CREATION_FAILED even when error message CONTAINS XML/SIGN keywords', async () => {
      // Contains 'XML' and 'SIGN' — under the old string-matching this would be misclassified
      const context = buildMockContext({
        createDocumentFails: new Error('XML_SIGNING_RELATED_BUT_IN_WRONG_STAGE'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      // Stage is explicit from WHICH method threw — not from message string
      expect(result.errorCode).toBe('DOCUMENT_CREATION_FAILED');
      expect(result.evidence.pipelineStage).toBe('DOCUMENT_CREATION');
    });

    it('does NOT call executeSubmission when createDocument fails', async () => {
      const context = buildMockContext({
        createDocumentFails: new Error('SIGNED_XML_ARTIFACT_NOT_FOUND'),
      });
      await runTask009FeSubmissionScenario(baseOptions(context));
      expect(context.executeSubmission).not.toHaveBeenCalled();
    });

    it('does NOT call executeSubmission when prepareXmlAndQueue fails', async () => {
      const context = buildMockContext({
        prepareXmlFails: new Error('FISCAL_XML_ARTIFACT_STORAGE_FAILED'),
      });
      await runTask009FeSubmissionScenario(baseOptions(context));
      expect(context.executeSubmission).not.toHaveBeenCalled();
    });

    it('missing fiscal prerequisites are blocked before HTTP (no recepcion requests)', async () => {
      const context = buildMockContext({
        createDocumentFails: new Error('FISCAL_ISSUANCE_POINT_REQUIRED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.recepcionPostRequestsMade).toBe(0);
    });

    it('generic Error without HttpException shape: domainCode is absent from evidence', async () => {
      const context = buildMockContext({ createDocumentFails: new Error('some error') });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      // domainCode is absent — plain Error has no getResponse()
      expect(result.evidence.domainCode).toBeUndefined();
    });

    it('secretsExposed is 0 in pipeline failure evidence', async () => {
      const context = buildMockContext({
        createDocumentFails: makeBadRequest('COMPANY_FISCAL_PROFILE_INCOMPLETE'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.secretsExposed).toBe(0);
    });

    it('http201MappedToAccepted is false in pipeline failure evidence', async () => {
      const context = buildMockContext({
        createDocumentFails: makeBadRequest('FISCAL_ISSUANCE_POINT_REQUIRED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.http201MappedToAccepted).toBe(false);
    });
  });

  // ── Successful submission path ────────────────────────────────────────────

  describe('Success path: valid FE received by Hacienda', () => {
    it('returns PASS status on successful ACKNOWLEDGED submission', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('PASS');
    });

    it('records submissionState=ACKNOWLEDGED in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.submissionState).toBe('ACKNOWLEDGED');
    });

    it('http201MappedToAccepted is always false — HTTP 201 is NOT accepted', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.http201MappedToAccepted).toBe(false);
    });

    it('records httpStatus=201 in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.httpStatus).toBe(201);
    });

    it('records clave in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.clave).toBe(PREPARED_DOCUMENT.clave);
    });

    it('records signedXmlSha256 in evidence (hash only, not XML content)', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.signedXmlSha256).toBe(PREPARED_DOCUMENT.signedXmlSha256);
    });

    it('records locationHeaderPresent in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.locationHeaderPresent).toBe(true);
    });

    it('records environment=SANDBOX in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.environment).toBe('SANDBOX');
    });

    it('records scenario=TASK-009 in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.scenario).toBe('TASK-009');
    });

    it('records secretsExposed=0 in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.secretsExposed).toBe(0);
    });

    it('records companyId in evidence', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.companyId).toBe('company-uuid-0009');
    });

    it('does not include errorCode in PASS result', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorCode).toBeUndefined();
    });
  });

  // ── Network isolation proof ───────────────────────────────────────────────

  describe('Network isolation proof', () => {
    it('productionRequestsMade is ALWAYS 0 on success', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('productionRequestsMade is ALWAYS 0 on failure', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('productionRequestsMade is ALWAYS 0 after TECHNICAL_RETRY_PENDING', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 0,
          errorCode: 'HACIENDA_TOKEN_EXPIRED',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });
  });

  // ── Failure paths ─────────────────────────────────────────────────────────

  describe('Failure path: TECHNICAL_RETRY_PENDING (401)', () => {
    it('returns FAIL status on TECHNICAL_RETRY_PENDING with HACIENDA_TOKEN_EXPIRED', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 401,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_TOKEN_EXPIRED',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('AUTHENTICATION_FAILED_401');
    });

    it('http201MappedToAccepted remains false on 401 failure', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 401,
          errorCode: 'HACIENDA_TOKEN_EXPIRED',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.http201MappedToAccepted).toBe(false);
    });
  });

  describe('Failure path: POST_OUTCOME_UNKNOWN (5xx / ambiguous)', () => {
    it('returns FAIL with SUBMISSION_AMBIGUOUS_5XX on POST_OUTCOME_UNKNOWN state', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'POST_OUTCOME_UNKNOWN',
          httpStatus: 503,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_POST_OUTCOME_UNKNOWN',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SUBMISSION_AMBIGUOUS_5XX');
    });

    it('does NOT blindly duplicate a POST for ambiguous result — executeSubmission called once', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'POST_OUTCOME_UNKNOWN',
          httpStatus: 503,
          errorCode: 'HACIENDA_POST_OUTCOME_UNKNOWN',
        },
      });
      await runTask009FeSubmissionScenario(baseOptions(context));
      expect(context.executeSubmission).toHaveBeenCalledTimes(1);
    });
  });

  describe('Failure path: rate limiting (429)', () => {
    it('returns FAIL with RATE_LIMITED_429 when rate limited', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 429,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_RATE_LIMIT',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('RATE_LIMITED_429');
    });

    it('no aggressive retry — executeSubmission called exactly once', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 429,
          errorCode: 'HACIENDA_RATE_LIMIT',
        },
      });
      await runTask009FeSubmissionScenario(baseOptions(context));
      expect(context.executeSubmission).toHaveBeenCalledTimes(1);
    });
  });

  describe('Failure path: network error', () => {
    it('returns FAIL with SUBMISSION_NETWORK_ERROR on network error', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 0,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NETWORK_ERROR',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('SUBMISSION_NETWORK_ERROR');
    });
  });

  // ── errorMessage propagation — never prints "none" for known HTTP failures ───

  describe('errorMessage propagation', () => {
    it('errorMessage is never undefined for a definitive HTTP 400 failure', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: { responseContentType: 'application/json' },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).not.toBe('none');
      expect(result.errorMessage!.length).toBeGreaterThan(0);
    });

    it('errorMessage for HTTP 400 mentions HTTP 400 when no allowlisted fields captured', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: { responseContentType: 'application/json' },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('400');
    });

    it('errorMessage for HTTP 400 with body keys mentions the keys', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            providerBodyType: 'object',
            providerBodyKeys: 'codigo, mensaje, descripcion',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('codigo');
      expect(result.errorMessage).toContain('mensaje');
    });

    it('errorMessage for HTTP 400 with haciendaDetail uses detail text', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            haciendaDetail: 'El campo fecha no coincide con FechaEmision',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('El campo fecha no coincide');
    });

    it('errorMessage for HTTP 400 with no providerMetadata at all still has a message', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          // haciendaProviderMetadata: undefined
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('400');
    });

    it('errorMessage for 401 mentions token/expired', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 401,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_TOKEN_EXPIRED',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage!.toLowerCase()).toMatch(/401|token|expired/);
    });

    it('errorMessage for 429 mentions rate limit', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 429,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_RATE_LIMIT',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage!.toLowerCase()).toMatch(/429|rate/);
    });

    it('errorMessage for network error describes network failure', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'TECHNICAL_RETRY_PENDING',
          httpStatus: 0,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NETWORK_ERROR',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage!.toLowerCase()).toMatch(/network/);
    });

    it('PASS result has no errorMessage', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toBeUndefined();
    });

    it('errorMessage uses haciendaErrorCause when present — highest priority', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            providerBodyParseStatus: 'EMPTY_STRING',
            providerBodyType: 'null',
            haciendaErrorCause: 'Comprobante ya fue recibido anteriormente',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('Comprobante ya fue recibido anteriormente');
      // Must not say 'Expand the allowlist' for empty body when error cause is present
      expect(result.errorMessage).not.toContain('Expand the allowlist');
      expect(result.errorMessage).not.toContain('extractProviderDiagnostic');
    });

    it('errorMessage for empty body WITHOUT X-Error-Cause says empty-body explicitly', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            providerBodyParseStatus: 'EMPTY_STRING',
            providerBodyType: 'null',
            // NO haciendaErrorCause
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('empty response body');
      expect(result.errorMessage).toContain('X-Error-Cause');
      // Must NOT say 'Expand the allowlist'
      expect(result.errorMessage).not.toContain('Expand the allowlist');
    });

    it('errorMessage for empty body with X-Error-Cause takes priority over empty-body message', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            providerBodyParseStatus: 'EMPTY_STRING',
            providerBodyType: 'null',
            haciendaErrorCause: 'firma electronica invalida',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('firma electronica invalida');
      expect(result.errorMessage).not.toContain('empty response body');
    });

    it('errorMessage never contains raw credentials, tokens, or XML', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            haciendaDetail: 'some error about the document',
            responseContentType: 'application/json',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const msg = result.errorMessage ?? '';
      expect(msg).not.toMatch(/authorization/i);
      expect(msg).not.toMatch(/bearer/i);
      expect(msg).not.toMatch(/access_token/i);
      expect(msg).not.toMatch(/<[^>]+>/);
    });
  });

  // ── Hacienda HTTP 400 diagnostic ─────────────────────────────────────────

  describe('Hacienda HTTP 400 diagnostic', () => {
    it('captures haciendaDiagnostic in evidence when Hacienda returns HTTP 400 with JSON body', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            haciendaDetail: 'El campo fecha no corresponde con FechaEmision del comprobante',
            haciendaTitle: 'Bad Request',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));

      expect(result.status).toBe('FAIL');
      expect(result.evidence.haciendaDiagnostic).toBeDefined();
      expect(result.evidence.haciendaDiagnostic?.['haciendaDetail']).toContain('fecha');
      expect(result.evidence.haciendaDiagnostic?.['haciendaTitle']).toBe('Bad Request');
    });

    it('haciendaDiagnostic is absent when Hacienda returns HTTP 201 (success path)', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.haciendaDiagnostic).toBeUndefined();
    });

    it('haciendaDiagnostic is absent when submission fails before Hacienda is reached', async () => {
      const context = buildMockContext({
        prepareXmlFails: makeBadRequest('FISCAL_XML_SIGNING_FAILED'),
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.haciendaDiagnostic).toBeUndefined();
    });

    it('haciendaDiagnostic is absent when providerMetadata is undefined', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          // No haciendaProviderMetadata — adapter returned nothing
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.haciendaDiagnostic).toBeUndefined();
    });

    it('haciendaDiagnostic does not contain authorization or token fields', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: {
            responseContentType: 'application/json',
            haciendaDetail: 'some error',
          },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toMatch(/authorization/i);
      expect(serialized).not.toMatch(/bearer/i);
      expect(serialized).not.toMatch(/access_token/i);
    });

    it('HTTP 400 maps to SUBMISSION_FAILED error code — no retry', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'MANUAL_REVIEW_REQUIRED',
          httpStatus: 400,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_NON_RETRYABLE_ERROR',
          haciendaProviderMetadata: { responseContentType: 'application/json' },
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorCode).toBe('SUBMISSION_FAILED');
      // executeSubmission called exactly once — no retry
      expect(context.executeSubmission).toHaveBeenCalledTimes(1);
    });
  });

  // ── Evidence integrity ────────────────────────────────────────────────────

  describe('Evidence integrity', () => {
    it('evidence result matches status in PASS case', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.result).toBe(result.status);
    });

    it('evidence result matches status in FAIL case', async () => {
      const context = buildMockContext({ prereqs: { companyExists: false } });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.result).toBe(result.status);
    });

    it('evidence timestamp is a valid ISO 8601 string', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(() => new Date(result.evidence.timestamp)).not.toThrow();
      expect(new Date(result.evidence.timestamp).toISOString()).toBe(result.evidence.timestamp);
    });

    it('PASS evidence does not contain password field', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toContain('"password"');
    });

    it('PASS evidence does not contain access_token field', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const evidenceKeys = Object.keys(result.evidence);
      expect(evidenceKeys).not.toContain('access_token');
    });

    it('PASS evidence does not contain certificate bytes or pkcs12', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toMatch(/pkcs12/i);
    });

    it('PASS evidence does not contain PIN', async () => {
      const context = buildMockContext({});
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toMatch(/\bpin\b/i);
    });

    it('http201MappedToAccepted is always false in every result', async () => {
      const successCtx = buildMockContext({});
      const failCtx = buildMockContext({ prereqs: { companyExists: false } });
      const [success, fail] = await Promise.all([
        runTask009FeSubmissionScenario(baseOptions(successCtx)),
        runTask009FeSubmissionScenario(baseOptions(failCtx)),
      ]);
      expect(success.evidence.http201MappedToAccepted).toBe(false);
      expect(fail.evidence.http201MappedToAccepted).toBe(false);
    });

    it('secretsExposed is always 0 in every result', async () => {
      const successCtx = buildMockContext({});
      const failCtx = buildMockContext({ prereqs: { companyExists: false } });
      const [success, fail] = await Promise.all([
        runTask009FeSubmissionScenario(baseOptions(successCtx)),
        runTask009FeSubmissionScenario(baseOptions(failCtx)),
      ]);
      expect(success.evidence.secretsExposed).toBe(0);
      expect(fail.evidence.secretsExposed).toBe(0);
    });
  });

  // ── Observed HTTP 202: UNRESOLVED_UNDOCUMENTED_2XX ─────────────────────
  //
  // HTTP 202 was returned by Hacienda sandbox after the envelope fix.
  // The published Hacienda POST /recepcion contract does NOT document HTTP 202.
  // MUST NOT map to ACKNOWLEDGED (not proven), ACCEPTED (not proven),
  // or SUBMISSION_FAILED (not a definitive rejection).
  // MUST preserve clave for a future GET /recepcion/{clave} query.
  //
  // ALL TESTS USE MOCKS. ZERO real Hacienda requests.

  describe('Observed HTTP 202 — UNRESOLVED_UNDOCUMENTED_2XX', () => {
    const outcome202: Task009SubmissionOutcome = {
      submissionState: 'POST_OUTCOME_UNKNOWN',
      httpStatus: 202,
      locationHeaderPresent: false,
      errorCode: 'HACIENDA_UNDOCUMENTED_2XX_STATUS',
      haciendaProviderMetadata: { responseClassification: 'UNDOCUMENTED_2XX' },
    };

    it('HTTP 202 maps to FAIL with UNRESOLVED_UNDOCUMENTED_2XX error code', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('UNRESOLVED_UNDOCUMENTED_2XX');
    });

    it('HTTP 202 is NOT classified as SUBMISSION_FAILED (not a definitive rejection)', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorCode).not.toBe('SUBMISSION_FAILED');
    });

    it('HTTP 202 is NOT classified as SUBMISSION_AMBIGUOUS_5XX (transport succeeded)', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorCode).not.toBe('SUBMISSION_AMBIGUOUS_5XX');
    });

    it('HTTP 202 errorMessage mentions NOT DOCUMENTED FOR POST /recepcion', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('NOT DOCUMENTED FOR POST /recepcion');
    });

    it('HTTP 202 errorMessage mentions UNRESOLVED_PROVIDER_RESPONSE', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('UNRESOLVED_PROVIDER_RESPONSE');
    });

    it('HTTP 202 errorMessage advises GET /recepcion/{clave} query (not re-POST)', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('GET /recepcion/{clave}');
      expect(result.errorMessage).toContain('DO NOT re-POST');
    });

    it('HTTP 202 errorMessage mentions fiscal acceptance is NOT PROVEN', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('NOT PROVEN');
    });

    it('HTTP 202 errorMessage shows the actual HTTP status', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorMessage).toContain('202');
    });

    it('HTTP 202 evidence has httpStatus=202', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.httpStatus).toBe(202);
    });

    it('HTTP 202 evidence preserves haciendaDiagnostic with responseClassification', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.haciendaDiagnostic?.['responseClassification']).toBe('UNDOCUMENTED_2XX');
    });

    it('HTTP 202 http201MappedToAccepted is always false', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.http201MappedToAccepted).toBe(false);
    });

    it('HTTP 202 secretsExposed is 0', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.secretsExposed).toBe(0);
    });

    it('HTTP 202 productionRequestsMade is 0', async () => {
      const context = buildMockContext({ outcome: outcome202 });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.evidence.networkIsolation.productionRequestsMade).toBe(0);
    });

    it('5xx ambiguous is still classified as SUBMISSION_AMBIGUOUS_5XX (not confused with 202)', async () => {
      const context = buildMockContext({
        outcome: {
          submissionState: 'POST_OUTCOME_UNKNOWN',
          httpStatus: 503,
          locationHeaderPresent: false,
          errorCode: 'HACIENDA_POST_OUTCOME_UNKNOWN',
        },
      });
      const result = await runTask009FeSubmissionScenario(baseOptions(context));
      expect(result.errorCode).toBe('SUBMISSION_AMBIGUOUS_5XX');
      expect(result.errorCode).not.toBe('UNRESOLVED_UNDOCUMENTED_2XX');
    });
  });

  // ── Normal CI isolation ───────────────────────────────────────────────────

  describe('Normal CI isolation: no real Hacienda calls without credentials', () => {
    it('returns FAIL immediately when USE_REAL_HACIENDA is not set — no NestJS bootstrap', async () => {
      delete process.env['USE_REAL_HACIENDA'];
      const result = await runTask009FeSubmissionScenario({ skipEvidenceWrite: true });
      // NestJS bootstrap is NOT triggered — the test module is lazy-imported
      expect(result.status).toBe('FAIL');
      expect(result.errorCode).toBe('USE_REAL_HACIENDA_NOT_SET');
    });

    it('contextFactory is never called when safety guard fails', async () => {
      process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] =
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
      const factoryFn = jest.fn();
      await runTask009FeSubmissionScenario({
        contextFactory: factoryFn,
        skipEvidenceWrite: true,
      });
      expect(factoryFn).not.toHaveBeenCalled();
    });
  });
});
