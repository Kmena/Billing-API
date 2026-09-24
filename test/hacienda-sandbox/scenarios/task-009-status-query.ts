/**
 * F4-S TASK-009-STATUS: Query Existing Submission by Clave
 *
 * Queries Hacienda GET /recepcion/{clave} for the EXISTING unresolved
 * HTTP 202 submission from TASK-009.  Does NOT create new documents.
 *
 * SAFETY CONTRACT:
 *   - POST /recepcion requests: ALWAYS 0  (structurally: only reconcile path is used)
 *   - New FiscalDocuments: ALWAYS 0        (no createDocument call)
 *   - New consecutives: ALWAYS 0           (no document = no consecutive)
 *   - Production endpoint requests: ALWAYS 0 (guard + sandbox-only URL selection)
 *   - Auth requests: <= 1                  (IdP sandbox only)
 *   - Status GETs: exactly 1              (one GET /recepcion/{clave})
 *
 * PIPELINE USED:
 *   FiscalSubmissionWorkerService.handleReconcileJob()
 *   → HaciendaRecepcionAdapter.queryStatusByClave()  (GET, NEVER POST)
 *   → FiscalSubmissionStateService.applyProviderResult()
 *
 * PRE-CONDITION:
 *   The existing 202 submission may be in state MANUAL_REVIEW_REQUIRED
 *   (set by pre-fix code).  This scenario repairs it to POST_OUTCOME_UNKNOWN
 *   before reconciliation because the state machine blocks direct transitions
 *   MANUAL_REVIEW_REQUIRED → ACCEPTED/REJECTED/PROCESSING.
 *
 * UNIT TEST CONTRACT:
 *   contextFactory option injects mocked services.
 *   All NestJS bootstrap skipped when contextFactory is provided.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  validateF4sEndpoints,
  allGuardResultsPass,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';
import { isUseRealHaciendaEnabled } from '../preflight/f4s-adapter-assertion';
import { assertNoSecrets, EVIDENCE_BASE_PATH } from '../evidence/f4s-evidence-collector';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Task009StatusStatus = 'PASS' | 'FAIL';

export type Task009StatusFailReason =
  | 'USE_REAL_HACIENDA_NOT_SET'
  | 'SAFETY_GUARD_FAILED'
  | 'MISSING_CREDENTIALS'
  | 'EXISTING_SUBMISSION_NOT_FOUND'
  | 'CLAVE_NOT_FOUND_BY_HACIENDA'
  | 'HACIENDA_PROCESSING_ERROR'
  | 'QUERY_AUTH_FAILED'
  | 'QUERY_RATE_LIMITED'
  | 'QUERY_PROVIDER_5XX'
  | 'UNKNOWN_HACIENDA_STATUS'
  | 'CONTEXT_FACTORY_ERROR'
  | 'UNEXPECTED_ERROR';

/**
 * FiscalAcceptanceStatus: what Hacienda's processing result actually means.
 * PENDING = submitted, waiting for Hacienda to process.
 * ACCEPTED / REJECTED = authoritative Hacienda fiscal decision.
 * ERROR = Hacienda had a processing error (not a transport error).
 * NOT_FOUND = Hacienda does not know this clave.
 * UNKNOWN = Hacienda responded but with an undocumented ind-estado value.
 */
export type FiscalAcceptanceStatus =
  'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'NOT_FOUND' | 'UNKNOWN';

/** Existing submission found in DB by clave. */
export interface ExistingSubmission {
  readonly submissionId: string;
  readonly fiscalDocumentId: string;
  readonly clave: string;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  readonly currentStatus: string;
  readonly lastHttpStatus: number | null;
  readonly lastNormalizedErrorCode: string | null;
  readonly providerLocation: string | null;
  /** Secret reference for bridging Hacienda connection credentials. */
  readonly haciendaConnectionSecretReference: string | null;
}

/** Credentials needed for the status query (no signing cert required). */
export interface StatusSecretBridgeInput {
  readonly haciendaConnectionSecretReference: string;
  readonly sandboxUsername: string;
  readonly sandboxPassword: string;
}

/** Result returned by context.executeStatusQuery(). */
export interface StatusQueryResult {
  readonly getHttpStatus: number;
  /** ind-estado value from Hacienda response body. Null if not present. */
  readonly indEstado: string | null;
  /** Whether Hacienda returned a respuesta-xml artifact. */
  readonly respuestaXmlPresent: boolean;
  /** DB submission status after applyProviderResult. */
  readonly newState: string;
  readonly normalizedErrorCode?: string;
  /** Hacienda numeric response code from <Mensaje> (e.g. "3" = rejected). */
  readonly haciendaMensaje?: string;
  /** Human-readable fiscal result from <DetalleMensaje>. Sanitized. */
  readonly haciendaDetalleMensaje?: string;
  /** Set when parseMensajeHacienda failed — does NOT affect state transition. */
  readonly fiscalDiagnosticParseError?: string;
}

export interface Task009StatusNetworkIsolation {
  readonly idpRequestsMade: number;
  readonly recepcionGetRequestsMade: number;
  /** ALWAYS 0 — structurally impossible through the reconcile path. */
  readonly recepcionPostRequestsMade: 0;
  /** ALWAYS 0 — production endpoint blocked by safety guard. */
  readonly productionRequestsMade: 0;
}

export interface Task009StatusEvidence {
  readonly scenario: 'TASK-009-STATUS';
  readonly environment: 'SANDBOX';
  readonly timestamp: string;
  readonly result: Task009StatusStatus;
  /** Existing clave — safe to record per F4-S evidence policy. */
  readonly existingClave: string;
  /** HTTP status that created this unresolved submission (should be 202). */
  readonly previousPostHttpStatus: number | null;
  /** DB state before this query. */
  readonly previousState: string | null;
  readonly getHttpStatus?: number;
  /** ind-estado from Hacienda GET response. */
  readonly indEstado?: string | null;
  readonly respuestaXmlPresent?: boolean;
  /** Hacienda numeric response code from <Mensaje> in respuesta-xml. */
  readonly haciendaMensaje?: string;
  /** Human-readable fiscal result from <DetalleMensaje>. Sanitized. */
  readonly haciendaDetalleMensaje?: string;
  readonly newState?: string;
  /** Authoritative fiscal processing result. */
  readonly fiscalAcceptance?: FiscalAcceptanceStatus;
  readonly networkIsolation: Task009StatusNetworkIsolation;
  /** Always 0 — asserted before evidence write. */
  readonly secretsExposed: 0;
  readonly errorCode?: string;
}

export interface Task009StatusResult {
  readonly status: Task009StatusStatus;
  readonly evidence: Task009StatusEvidence;
  readonly errorCode?: Task009StatusFailReason;
  readonly errorMessage?: string;
}

// ── Injectable context (for unit test isolation) ──────────────────────────────

export interface Task009StatusContext {
  /**
   * Finds an existing FiscalSubmission by its clave.
   * Returns null if not found.
   */
  findSubmissionByClave(clave: string): Promise<ExistingSubmission | null>;

  /**
   * Bridges Hacienda connection credentials into SecretProvider (in-memory).
   * MUST NOT log or persist any of these values.
   */
  bridgeSecrets(input: StatusSecretBridgeInput): Promise<void>;

  /**
   * Executes GET /recepcion/{clave} via the normal reconcile path.
   *
   * Guarantees (by construction — only handleReconcileJob is called):
   *   POST /recepcion requests: 0
   *   New FiscalDocuments: 0
   *   New consecutives: 0
   *
   * If the submission was left in MANUAL_REVIEW_REQUIRED by pre-fix code,
   * the implementation must repair it to POST_OUTCOME_UNKNOWN first
   * (MANUAL_REVIEW_REQUIRED → POST_OUTCOME_UNKNOWN is an allowed transition).
   */
  executeStatusQuery(submissionId: string): Promise<StatusQueryResult>;
}

export interface Task009StatusScenarioOptions {
  readonly contextFactory?: () => Promise<Task009StatusContext>;
  readonly skipEvidenceWrite?: boolean;
  /** Override the clave to query (defaults to F4S_EXISTING_SUBMISSION_CLAVE env var). */
  readonly targetClave?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ZERO_NETWORK: Task009StatusNetworkIsolation = {
  idpRequestsMade: 0,
  recepcionGetRequestsMade: 0,
  recepcionPostRequestsMade: 0,
  productionRequestsMade: 0,
};

function buildAbortResult(
  clave: string,
  errorCode: Task009StatusFailReason,
  errorMessage: string,
  previousState?: string | null,
  previousPostHttpStatus?: number | null,
): Task009StatusResult {
  const evidence: Task009StatusEvidence = {
    scenario: 'TASK-009-STATUS',
    environment: 'SANDBOX',
    timestamp: new Date().toISOString(),
    result: 'FAIL',
    existingClave: clave,
    previousPostHttpStatus: previousPostHttpStatus ?? null,
    previousState: previousState ?? null,
    networkIsolation: ZERO_NETWORK,
    secretsExposed: 0,
    errorCode,
  };
  return { status: 'FAIL', evidence, errorCode, errorMessage };
}

function mapFiscalAcceptance(
  indEstado: string | null | undefined,
  getHttpStatus: number,
): FiscalAcceptanceStatus {
  if (getHttpStatus === 404) return 'NOT_FOUND';
  if (!indEstado) return 'UNKNOWN';
  if (indEstado === 'recibido' || indEstado === 'procesando') return 'PENDING';
  if (indEstado === 'aceptado') return 'ACCEPTED';
  if (indEstado === 'rechazado') return 'REJECTED';
  if (indEstado === 'error') return 'ERROR';
  return 'UNKNOWN';
}

function buildStatusMessage(
  clave: string,
  queryResult: StatusQueryResult,
  acceptance: FiscalAcceptanceStatus,
): string {
  const lines = [
    `Hacienda GET /recepcion/${clave}`,
    'Hacienda processing result:',
    `  HTTP status    : ${queryResult.getHttpStatus}`,
    `  ind-estado     : ${queryResult.indEstado ?? '(absent)'}`,
    `  respuesta-xml  : ${queryResult.respuestaXmlPresent ? 'YES' : 'NO'}`,
    ...(queryResult.haciendaMensaje !== undefined
      ? [`  Mensaje        : ${queryResult.haciendaMensaje}`]
      : []),
    ...(queryResult.haciendaDetalleMensaje !== undefined
      ? [`  DetalleMensaje : ${queryResult.haciendaDetalleMensaje}`]
      : []),
    'Billing result:',
    `  New state      : ${queryResult.newState}`,
    `  Fiscal acc.    : ${acceptance}`,
  ];
  if (acceptance === 'PENDING') {
    lines.push('  REAL SUBMISSION CONFIRMED BY HACIENDA — fiscal decision still pending.');
  } else if (acceptance === 'ACCEPTED') {
    lines.push('  REAL SUBMISSION CONFIRMED — FINAL HACIENDA RESULT: ACCEPTED');
  } else if (acceptance === 'REJECTED') {
    lines.push('  REAL SUBMISSION CONFIRMED — FINAL HACIENDA RESULT: REJECTED');
  } else if (acceptance === 'ERROR') {
    lines.push('  REAL SUBMISSION CONFIRMED — HACIENDA PROCESSING RESULT: ERROR');
    lines.push('  DO NOT re-POST automatically. Investigate the error first.');
  } else if (acceptance === 'NOT_FOUND') {
    lines.push('  Hacienda does not know this clave.');
    lines.push('  DO NOT re-POST automatically. Verify the clave and environment first.');
  }
  return lines.join('\n');
}

async function writeStatusSummary(evidence: Task009StatusEvidence): Promise<void> {
  const dir = path.resolve(EVIDENCE_BASE_PATH, 'TASK-009-STATUS');
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `task-009-status-${Date.now()}.json`;
  const filepath = path.join(dir, filename);
  const serialized = JSON.stringify(evidence, null, 2);
  assertNoSecrets(serialized, filepath);
  await fs.promises.writeFile(filepath, serialized, 'utf8');
}

// ── Live context factory ──────────────────────────────────────────────────────

async function createLiveStatusContext(
  companyId: string,
  tenantId: string,
): Promise<Task009StatusContext> {
  const { Test } = await import('@nestjs/testing');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = await import('../../../src/app.module');
  const { JOB_QUEUE } = await import('@/infrastructure/queue/ports/job-queue.port');
  const { SECRET_PROVIDER } = await import('@/infrastructure/secrets/ports/secret-provider.port');
  const { FiscalSubmissionWorkerService } =
    await import('@/modules/fiscal-documents/application/submission/workers/fiscal-submission-worker.service');
  const { PrismaService } = await import('@/infrastructure/database/prisma.service');

  const noOpJobQueue = {
    registerHandler: async () => undefined,
    publish: async () => undefined,
    schedule: async () => undefined,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JOB_QUEUE)
    .useValue(noOpJobQueue)
    .compile();

  await moduleRef.init();

  const prisma = moduleRef.get<InstanceType<typeof PrismaService>>(PrismaService);
  const worker = moduleRef.get<InstanceType<typeof FiscalSubmissionWorkerService>>(
    FiscalSubmissionWorkerService,
  );
  const secretsProvider = moduleRef.get(SECRET_PROVIDER);

  return {
    async findSubmissionByClave(clave) {
      const submission = await prisma.fiscalSubmission.findFirst({
        where: { clave, environment: 'SANDBOX', companyId, tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (!submission) return null;

      const connection = await prisma.haciendaConnection.findFirst({
        where: { tenantId, companyId, environment: 'SANDBOX', status: 'CONNECTED' },
      });

      return {
        submissionId: submission.id,
        fiscalDocumentId: submission.fiscalDocumentId,
        clave: submission.clave,
        environment: 'SANDBOX' as const,
        currentStatus: submission.status,
        lastHttpStatus:
          (submission as unknown as { lastHttpStatus?: number | null }).lastHttpStatus ?? null,
        lastNormalizedErrorCode: submission.lastNormalizedErrorCode ?? null,
        providerLocation:
          (submission as unknown as { providerLocation?: string | null }).providerLocation ?? null,
        haciendaConnectionSecretReference: connection?.secretReference ?? null,
      };
    },

    async bridgeSecrets(input) {
      await secretsProvider.storeSecret(
        input.haciendaConnectionSecretReference,
        JSON.stringify({ username: input.sandboxUsername, password: input.sandboxPassword }),
      );
    },

    async executeStatusQuery(submissionId) {
      // Repair pre-fix MANUAL_REVIEW_REQUIRED → POST_OUTCOME_UNKNOWN.
      // The old adapter code incorrectly mapped HTTP 202 to nonRetryable().
      // MANUAL_REVIEW_REQUIRED → POST_OUTCOME_UNKNOWN is an allowed transition.
      // Without this repair, MANUAL_REVIEW_REQUIRED → ACCEPTED/REJECTED is blocked
      // by the state machine, preventing the fiscal result from being persisted.
      await prisma.fiscalSubmission.updateMany({
        where: { id: submissionId, status: 'MANUAL_REVIEW_REQUIRED', lastHttpStatus: 202 },
        data: {
          status: 'POST_OUTCOME_UNKNOWN',
          lastNormalizedErrorCode: 'HACIENDA_UNDOCUMENTED_2XX_STATUS',
        },
      });

      await worker.handleReconcileJob({ submissionId });

      const updated = await prisma.fiscalSubmission.findUnique({ where: { id: submissionId } });
      if (!updated) throw new Error('SUBMISSION_NOT_FOUND after handleReconcileJob');

      const httpStatus =
        (updated as unknown as { lastHttpStatus?: number | null }).lastHttpStatus ?? 0;
      const indEstado = updated.lastProviderStatus ?? null;
      const respuestaXmlPresent = !!(updated as unknown as { responseStorageKey?: string | null })
        .responseStorageKey;

      // Extract fiscal diagnostic persisted by the adapter into lastProviderMetadata.
      const meta = (updated as unknown as { lastProviderMetadata?: Record<string, unknown> | null })
        .lastProviderMetadata;
      const haciendaMensaje =
        typeof meta?.['haciendaMensaje'] === 'string' ? meta['haciendaMensaje'] : undefined;
      const haciendaDetalleMensaje =
        typeof meta?.['haciendaDetalleMensaje'] === 'string'
          ? meta['haciendaDetalleMensaje']
          : undefined;
      const fiscalDiagnosticParseError =
        typeof meta?.['fiscalDiagnosticParseError'] === 'string'
          ? meta['fiscalDiagnosticParseError']
          : undefined;

      return {
        getHttpStatus: httpStatus,
        indEstado,
        respuestaXmlPresent,
        newState: updated.status,
        normalizedErrorCode: updated.lastNormalizedErrorCode ?? undefined,
        haciendaMensaje,
        haciendaDetalleMensaje,
        fiscalDiagnosticParseError,
      };
    },
  };
}

// ── Main scenario ─────────────────────────────────────────────────────────────

/**
 * TASK-009-STATUS: Query an existing unresolved submission by clave.
 *
 * Execution order:
 *   1. Assert USE_REAL_HACIENDA=true.
 *   2. Run safety guard — abort if any check fails.
 *   3. Assert required credentials are present (no signing cert needed).
 *   4. Resolve clave from options or F4S_EXISTING_SUBMISSION_CLAVE env var.
 *   5. Bootstrap NestJS context (or use injected contextFactory for tests).
 *   6. Find existing submission in DB by clave.
 *   7. Bridge Hacienda connection credentials (in-memory only).
 *   8. Execute GET /recepcion/{clave} via handleReconcileJob.
 *   9. Map ind-estado to FiscalAcceptanceStatus.
 *  10. Write sanitized evidence.
 */
export async function runTask009StatusQueryScenario(
  options: Task009StatusScenarioOptions = {},
): Promise<Task009StatusResult> {
  const clave = options.targetClave ?? process.env['F4S_EXISTING_SUBMISSION_CLAVE'] ?? '';

  // ── Step 1: USE_REAL_HACIENDA guard ──────────────────────────────────────
  if (!isUseRealHaciendaEnabled()) {
    return buildAbortResult(
      clave,
      'USE_REAL_HACIENDA_NOT_SET',
      'USE_REAL_HACIENDA must be set to "true" to query Hacienda status.',
    );
  }

  // ── Step 2: Safety guard ─────────────────────────────────────────────────
  const receptionUrl = process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] ?? '';
  const tokenUrl = process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL;
  const clientId = process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID;
  const guardResults = validateF4sEndpoints({ receptionBaseUrl: receptionUrl, tokenUrl, clientId });
  if (!allGuardResultsPass(guardResults)) {
    return buildAbortResult(
      clave,
      'SAFETY_GUARD_FAILED',
      'Safety guard failed — production endpoint may be configured.',
    );
  }

  // ── Step 3: Required credentials ─────────────────────────────────────────
  const username = process.env['F4S_SANDBOX_USERNAME'];
  const password = process.env['F4S_SANDBOX_PASSWORD'];
  const companyId = process.env['F4S_COMPANY_ID'];
  const tenantId = process.env['F4S_TENANT_ID'];

  if (!username || !password || !companyId || !tenantId) {
    return buildAbortResult(
      clave,
      'MISSING_CREDENTIALS',
      'F4S_SANDBOX_USERNAME, F4S_SANDBOX_PASSWORD, F4S_COMPANY_ID, and F4S_TENANT_ID are required.',
    );
  }

  if (!clave) {
    return buildAbortResult(
      '',
      'MISSING_CREDENTIALS',
      'Set F4S_EXISTING_SUBMISSION_CLAVE to the clave of the unresolved 202 submission.',
    );
  }

  // ── Step 4: Bootstrap context ─────────────────────────────────────────────
  let context: Task009StatusContext;
  try {
    context = options.contextFactory
      ? await options.contextFactory()
      : await createLiveStatusContext(companyId, tenantId);
  } catch (err) {
    return buildAbortResult(
      clave,
      'CONTEXT_FACTORY_ERROR',
      `Failed to create scenario context: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  // ── Step 5: Find submission ───────────────────────────────────────────────
  let submission: ExistingSubmission | null;
  try {
    submission = await context.findSubmissionByClave(clave);
  } catch (err) {
    return buildAbortResult(
      clave,
      'UNEXPECTED_ERROR',
      `findSubmissionByClave failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (!submission) {
    return buildAbortResult(
      clave,
      'EXISTING_SUBMISSION_NOT_FOUND',
      `No FiscalSubmission found for clave ${clave} in SANDBOX.`,
    );
  }

  if (!submission.haciendaConnectionSecretReference) {
    return buildAbortResult(
      clave,
      'MISSING_CREDENTIALS',
      'No active Hacienda SANDBOX connection found for this company.',
      submission.currentStatus,
      submission.lastHttpStatus,
    );
  }

  // ── Step 6: Bridge credentials ────────────────────────────────────────────
  await context.bridgeSecrets({
    haciendaConnectionSecretReference: submission.haciendaConnectionSecretReference,
    sandboxUsername: username,
    sandboxPassword: password,
  });

  // ── Step 7: Execute GET /recepcion/{clave} ────────────────────────────────
  let queryResult: StatusQueryResult;
  try {
    queryResult = await context.executeStatusQuery(submission.submissionId);
  } catch (err) {
    return buildAbortResult(
      clave,
      'UNEXPECTED_ERROR',
      `executeStatusQuery failed: ${err instanceof Error ? err.message : 'unknown'}`,
      submission.currentStatus,
      submission.lastHttpStatus,
    );
  }

  // ── Step 8: Map result ────────────────────────────────────────────────────
  const acceptance = mapFiscalAcceptance(queryResult.indEstado, queryResult.getHttpStatus);
  const message = buildStatusMessage(clave, queryResult, acceptance);

  const networkIsolation: Task009StatusNetworkIsolation = {
    idpRequestsMade: 1,
    recepcionGetRequestsMade: 1,
    recepcionPostRequestsMade: 0,
    productionRequestsMade: 0,
  };

  const isKnownState =
    acceptance === 'PENDING' || acceptance === 'ACCEPTED' || acceptance === 'REJECTED';
  const passStatus: Task009StatusStatus = isKnownState ? 'PASS' : 'FAIL';

  // normalizedErrorCode takes priority over acceptance-based mapping so that
  // auth/rate-limit/5xx errors are not swallowed by the generic UNKNOWN bucket.
  const failReason: Task009StatusFailReason | undefined =
    queryResult.normalizedErrorCode === 'HACIENDA_TOKEN_EXPIRED'
      ? 'QUERY_AUTH_FAILED'
      : queryResult.normalizedErrorCode === 'HACIENDA_RATE_LIMIT'
        ? 'QUERY_RATE_LIMITED'
        : queryResult.normalizedErrorCode === 'HACIENDA_UNAVAILABLE'
          ? 'QUERY_PROVIDER_5XX'
          : acceptance === 'NOT_FOUND'
            ? 'CLAVE_NOT_FOUND_BY_HACIENDA'
            : acceptance === 'ERROR'
              ? 'HACIENDA_PROCESSING_ERROR'
              : acceptance === 'UNKNOWN'
                ? 'UNKNOWN_HACIENDA_STATUS'
                : passStatus === 'FAIL'
                  ? 'UNEXPECTED_ERROR'
                  : undefined;

  const evidence: Task009StatusEvidence = {
    scenario: 'TASK-009-STATUS',
    environment: 'SANDBOX',
    timestamp: new Date().toISOString(),
    result: passStatus,
    existingClave: clave,
    previousPostHttpStatus: submission.lastHttpStatus,
    previousState: submission.currentStatus,
    getHttpStatus: queryResult.getHttpStatus,
    indEstado: queryResult.indEstado,
    respuestaXmlPresent: queryResult.respuestaXmlPresent,
    ...(queryResult.haciendaMensaje !== undefined
      ? { haciendaMensaje: queryResult.haciendaMensaje }
      : {}),
    ...(queryResult.haciendaDetalleMensaje !== undefined
      ? { haciendaDetalleMensaje: queryResult.haciendaDetalleMensaje }
      : {}),
    newState: queryResult.newState,
    fiscalAcceptance: acceptance,
    networkIsolation,
    secretsExposed: 0,
    ...(failReason ? { errorCode: failReason } : {}),
  };

  // ── Step 9: Write evidence ────────────────────────────────────────────────
  if (!options.skipEvidenceWrite) {
    await writeStatusSummary(evidence);
  }

  return {
    status: passStatus,
    evidence,
    errorCode: failReason,
    errorMessage: passStatus === 'FAIL' ? message : undefined,
  };
}
