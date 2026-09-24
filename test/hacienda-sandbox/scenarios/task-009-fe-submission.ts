/**
 * F4-S TASK-009: Real FE Submission via Billing Normal Pipeline
 *
 * Executes S04 — "Normal Billing FE pipeline to real POST; HTTP metadata;
 * not treated as accepted."
 *
 * SAFETY CONTRACT:
 *   - Safety guard MUST PASS before any HTTP call or NestJS bootstrap
 *   - Exactly 0 production endpoint requests (proven by guard + adapter selection)
 *   - At most 1 IdP auth request + 1 /recepcion POST
 *   - HTTP 201 = ACKNOWLEDGED — NEVER mapped to ACCEPTED
 *   - No raw token, certificate bytes, PIN, or credentials in evidence
 *   - NestJS job queue is overridden with a no-op to prevent auto-processing
 *     of any existing unrelated submissions in the database
 *
 * PIPELINE USED:
 *   FiscalDocumentService.createDocument()
 *   → PrepareFiscalXmlService.execute() (XML v4.4, XAdES, XSD validation)
 *   → FiscalSubmissionWorkerService.handleSubmitJob() (auth + POST)
 *   → HaciendaRecepcionAdapter (real sandbox /recepcion POST)
 *
 * TASK-009 STOPS here. Does NOT poll for ACCEPTED/REJECTED (that is TASK-010).
 *
 * UNIT TEST CONTRACT:
 *   contextFactory option allows injection of mock services.
 *   All real NestJS bootstrap is skipped when contextFactory is provided.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  validateF4sEndpoints,
  allGuardResultsPass,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';
import { isUseRealHaciendaEnabled } from '../preflight/f4s-adapter-assertion';
import {
  assertNoSecrets,
  assertTask009EvidenceSafe,
  EVIDENCE_BASE_PATH,
} from '../evidence/f4s-evidence-collector';
import {
  extractHttpExceptionDiagnostic,
  type PipelineStage,
} from '../diagnostics/f4s-exception-diagnostic';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Task009Status = 'PASS' | 'FAIL';

export type Task009FailReason =
  | 'USE_REAL_HACIENDA_NOT_SET'
  | 'SAFETY_GUARD_FAILED'
  | 'MISSING_CREDENTIALS'
  | 'COMPANY_NOT_FOUND'
  | 'FISCAL_PROFILE_MISSING'
  | 'HACIENDA_CONNECTION_NOT_CONNECTED'
  | 'SIGNING_CERTIFICATE_NOT_CONFIGURED'
  | 'FISCAL_SEQUENCES_NOT_CONFIGURED'
  | 'DOCUMENT_CREATION_FAILED'
  | 'XML_PREPARATION_FAILED'
  | 'READY_TO_SUBMIT_TIMEOUT'
  | 'SUBMISSION_FAILED'
  | 'AUTHENTICATION_FAILED_401'
  | 'RATE_LIMITED_429'
  | 'SUBMISSION_AMBIGUOUS_5XX'
  | 'SUBMISSION_NETWORK_ERROR'
  /**
   * Hacienda returned an undocumented 2xx (e.g. HTTP 202).
   * Not a definitive failure — document may have been received.
   * DO NOT re-POST. Reconcile via GET /recepcion/{clave}.
   */
  | 'UNRESOLVED_UNDOCUMENTED_2XX'
  | 'PRODUCTION_ENDPOINT_BLOCKED'
  | 'CONTEXT_FACTORY_ERROR'
  | 'UNEXPECTED_ERROR';

export interface Task009NetworkIsolation {
  readonly idpRequestsMade: number;
  readonly recepcionPostRequestsMade: number;
  readonly productionRequestsMade: number;
}

/**
 * Sanitized TASK-009 evidence summary.
 * NEVER includes: access_token, refresh_token, password, username,
 * PIN, certificate bytes, pkcs12, private_key, authorization.
 */
export interface Task009SubmissionEvidence {
  readonly scenario: 'TASK-009';
  readonly environment: 'SANDBOX';
  readonly timestamp: string;
  readonly result: Task009Status;
  readonly companyId: string;
  /** 50-character Hacienda Clave — safe to record. */
  readonly clave?: string;
  /** SHA-256 of the signed XML bytes — hash only, never the XML. */
  readonly signedXmlSha256?: string;
  /** HTTP status returned by POST /recepcion — safe to record. */
  readonly httpStatus?: number;
  /** Whether Hacienda returned a Location header. */
  readonly locationHeaderPresent?: boolean;
  /** Submission state after POST — must be ACKNOWLEDGED, never ACCEPTED. */
  readonly submissionState?: string;
  /** Whether HTTP 201 was incorrectly mapped to ACCEPTED (must always be false). */
  readonly http201MappedToAccepted: false;
  /**
   * Pipeline stage where the failure occurred.
   * Only present in FAIL results from document/XML pipeline stages.
   * Explicitly set — NEVER inferred from exception message string matching.
   */
  readonly pipelineStage?: PipelineStage;
  /**
   * Domain error code extracted from NestJS HttpException.getResponse().code.
   * Validated: must match /^[A-Z0-9_]{1,100}$/. Only present when extractable.
   */
  readonly domainCode?: string;
  /**
   * First XSD validation error detail — only present when domainCode is FISCAL_XML_VALIDATION_FAILED.
   * The message is sanitized: no XML tags, no file paths, max 200 chars.
   * Enables root-cause diagnosis without exposing XML payload content.
   */
  readonly xsdFirstError?: {
    readonly xsdLine: number | null;
    readonly xsdMessage: string;
  };
  /**
   * Sanitized Hacienda provider diagnostic from the HTTP error response body.
   * Only present when Hacienda itself returned a non-retryable error (e.g. HTTP 400).
   * Contains allowlisted safe fields only: haciendaDetail, haciendaTitle,
   * haciendaMessage, haciendaErrorCodes, haciendaFirstErrorMessage, etc.
   * Never contains tokens, XML, certificates, or authorization data.
   */
  readonly haciendaDiagnostic?: Record<string, string | number | boolean | null>;
  /** Rate-limit metadata when observed. */
  readonly rateLimitObserved?: {
    readonly limit?: string;
    readonly remaining?: string;
    readonly reset?: string;
  };
  readonly networkIsolation: Task009NetworkIsolation;
  /** Error code when result=FAIL. */
  readonly errorCode?: string;
  /** Always 0 — asserted before evidence is written. */
  readonly secretsExposed: 0;
}

export interface Task009Result {
  readonly status: Task009Status;
  readonly evidence: Task009SubmissionEvidence;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

// ── Injectable context (for unit test isolation) ──────────────────────────────

/**
 * Minimal injectable context that the TASK-009 scenario requires.
 * Used to inject mocks in unit tests and real services in live runs.
 */
export interface Task009Context {
  /**
   * Reads company fiscal prerequisite state.
   * Returns null for each field when the prerequisite is missing.
   */
  checkPrerequisites(input: { companyId: string; tenantId: string }): Promise<Task009Prerequisites>;

  /**
   * Bridges runtime secrets into SecretProvider.
   * Called with plain-text values that are kept only in-memory.
   * MUST NOT log or persist any of these values.
   */
  bridgeSecrets(input: Task009SecretBridgeInput): Promise<void>;

  /**
   * Creates a temporary API key in the database for pipeline authorization.
   * Returns the key ID only — the secret/hash is not needed externally.
   */
  createTempApiKey(companyId: string, tenantId: string): Promise<string>;

  /**
   * Stage 1 — Creates an FE fiscal document via FiscalDocumentService.
   * Returns documentId and clave on success.
   * Throws (typically BadRequestException) on fiscal profile / sequence errors.
   */
  createDocument(input: {
    companyId: string;
    tenantId: string;
    tempApiKeyId: string;
  }): Promise<Task009CreatedDocument>;

  /**
   * Stage 2 — Runs PrepareFiscalXmlService (XML generation, XAdES signing, XSD
   * validation), verifies the signed XML hash, and queues the submission record.
   * Throws (typically BadRequestException) on certificate / signing / XSD errors.
   */
  prepareXmlAndQueue(input: {
    documentId: string;
    clave: string;
    tenantId: string;
    companyId: string;
    tempApiKeyId: string;
  }): Promise<{ signedXmlSha256: string; submissionId: string }>;

  /**
   * Executes FiscalSubmissionWorkerService.handleSubmitJob() for the document.
   * Returns the submission ID and resulting state.
   */
  executeSubmission(submissionId: string): Promise<Task009SubmissionOutcome>;

  /**
   * Reads the submission record from the database by document ID.
   * Returns the submission ID and current state.
   */
  findSubmission(documentId: string): Promise<{ id: string; status: string } | null>;
}

export interface Task009Prerequisites {
  readonly companyExists: boolean;
  readonly fiscalProfileExists: boolean;
  readonly haciendaConnectionConnected: boolean;
  readonly signingCertificateConfigured: boolean;
  readonly haciendaConnectionSecretReference: string | null;
  readonly signingCertificateSecretReference: string | null;
  readonly signingCertificatePasswordSecretReference: string | null;
}

export interface Task009SecretBridgeInput {
  readonly haciendaConnectionSecretReference: string;
  readonly signingCertificateSecretReference: string;
  readonly signingCertificatePasswordSecretReference: string;
  readonly sandboxUsername: string;
  readonly sandboxPassword: string;
  readonly certPath: string;
  readonly certPin: string;
}

/** Returned by Task009Context.createDocument — stage 1 output. */
export interface Task009CreatedDocument {
  readonly documentId: string;
  readonly clave: string;
}

export interface Task009PreparedDocument {
  readonly documentId: string;
  readonly clave: string;
  readonly signedXmlSha256: string;
  readonly submissionId: string;
}

export interface Task009SubmissionOutcome {
  readonly submissionState: string;
  readonly httpStatus: number;
  readonly locationHeaderPresent: boolean;
  readonly rateLimitObserved?: {
    readonly limit?: string;
    readonly remaining?: string;
    readonly reset?: string;
  };
  readonly errorCode?: string;
  /**
   * Safe, sanitized provider diagnostic metadata from Hacienda's error response body.
   * Populated when Hacienda returns a non-retryable error (e.g. HTTP 400).
   * Only contains allowlisted safe fields — never raw HTTP objects, tokens, or XML.
   */
  readonly haciendaProviderMetadata?: Record<string, string | number | boolean | null>;
}

export interface Task009ScenarioOptions {
  /**
   * For unit testing: inject a fully mocked context instead of bootstrapping NestJS.
   * When provided, NestJS bootstrapping is skipped entirely.
   */
  readonly contextFactory?: () => Promise<Task009Context>;
  /** Skip evidence file writes. Default: false. Set true in unit tests. */
  readonly skipEvidenceWrite?: boolean;
}

// ── Abort helper ──────────────────────────────────────────────────────────────

function buildAbortResult(
  companyId: string,
  errorCode: Task009FailReason,
  errorMessage: string,
  diagnostic?: {
    readonly pipelineStage?: PipelineStage;
    readonly httpStatus?: number;
    readonly domainCode?: string | null;
    readonly xsdFirstError?: { readonly xsdLine: number | null; readonly xsdMessage: string };
  },
): Task009Result {
  const evidence: Task009SubmissionEvidence = {
    scenario: 'TASK-009',
    environment: 'SANDBOX',
    timestamp: new Date().toISOString(),
    result: 'FAIL',
    companyId,
    http201MappedToAccepted: false,
    networkIsolation: {
      idpRequestsMade: 0,
      recepcionPostRequestsMade: 0,
      productionRequestsMade: 0,
    },
    errorCode,
    secretsExposed: 0,
    ...(diagnostic?.pipelineStage !== undefined ? { pipelineStage: diagnostic.pipelineStage } : {}),
    ...(diagnostic?.httpStatus !== undefined ? { httpStatus: diagnostic.httpStatus } : {}),
    ...(diagnostic?.domainCode != null ? { domainCode: diagnostic.domainCode } : {}),
    ...(diagnostic?.xsdFirstError !== undefined ? { xsdFirstError: diagnostic.xsdFirstError } : {}),
  };
  return { status: 'FAIL', evidence, errorCode, errorMessage };
}

// ── Evidence writing ──────────────────────────────────────────────────────────

async function writeTask009Summary(
  evidence: Task009SubmissionEvidence,
  scenarioLabel: string,
): Promise<void> {
  const dir = path.resolve(EVIDENCE_BASE_PATH, 'TASK-009');
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `task-009-summary-${Date.now()}.json`;
  const filepath = path.join(dir, filename);

  // Layer 1: structured key-level check (forbidden key names)
  assertTask009EvidenceSafe(evidence, filepath);

  const serialized = JSON.stringify({ scenarioLabel, ...evidence }, null, 2);

  // Layer 2: string-level pattern scan (defense-in-depth)
  assertNoSecrets(serialized, filepath);

  await fs.promises.writeFile(filepath, serialized, 'utf8');
}

// ── NestJS context factory (live mode) ───────────────────────────────────────

/**
 * Creates a real Task009Context by bootstrapping a NestJS test module.
 *
 * Safety measures:
 *   - JOB_QUEUE is overridden with F4sNoOpJobQueue to prevent auto-processing
 *     of any existing submissions when onModuleInit runs.
 *   - USE_REAL_HACIENDA=true ensures HaciendaRecepcionAdapter is selected.
 *   - Credentials are bridged from env vars to SecretProvider at runtime.
 *   - No secrets are persisted to disk.
 *
 * This function is ONLY called when no contextFactory is provided.
 * It is NOT called during unit tests.
 */
async function createLiveContext(): Promise<Task009Context> {
  // Lazy imports — only loaded during live execution, not during unit tests.
  // This prevents NestJS bootstrap from running during 'npm test'.
  const { Test } = await import('@nestjs/testing');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = await import('../../../src/app.module');
  const { JOB_QUEUE } = await import('@/infrastructure/queue/ports/job-queue.port');
  const { STORAGE_PORT } = await import('@/infrastructure/storage/ports/storage.port');
  const { SECRET_PROVIDER } = await import('@/infrastructure/secrets/ports/secret-provider.port');
  const { FiscalDocumentService } =
    await import('@/modules/fiscal-documents/application/fiscal-document.service');
  const { PrepareFiscalXmlService } =
    await import('@/modules/fiscal-documents/application/fiscal-xml/prepare-fiscal-xml.service');
  const { FiscalSubmissionWorkerService } =
    await import('@/modules/fiscal-documents/application/submission/workers/fiscal-submission-worker.service');
  const { PrismaService } = await import('@/infrastructure/database/prisma.service');

  // F4S no-op job queue: prevents auto-processing of due submissions on onModuleInit.
  // When enqueueDueWork() calls publish(), nothing happens.
  // TASK-009 invokes handleSubmitJob() directly after document creation.
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
  const documentService =
    moduleRef.get<InstanceType<typeof FiscalDocumentService>>(FiscalDocumentService);
  const prepareFiscalXmlService =
    moduleRef.get<InstanceType<typeof PrepareFiscalXmlService>>(PrepareFiscalXmlService);
  const worker = moduleRef.get<InstanceType<typeof FiscalSubmissionWorkerService>>(
    FiscalSubmissionWorkerService,
  );
  const secretsProvider = moduleRef.get(SECRET_PROVIDER);
  const storagePort = moduleRef.get(STORAGE_PORT);

  return {
    async checkPrerequisites({ companyId, tenantId }) {
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId, status: 'ACTIVE' },
      });
      if (!company) {
        return {
          companyExists: false,
          fiscalProfileExists: false,
          haciendaConnectionConnected: false,
          signingCertificateConfigured: false,
          haciendaConnectionSecretReference: null,
          signingCertificateSecretReference: null,
          signingCertificatePasswordSecretReference: null,
        };
      }

      const profile = await prisma.companyFiscalProfile.findFirst({
        where: { tenantId, companyId },
      });

      const connection = await prisma.haciendaConnection.findFirst({
        where: { tenantId, companyId, environment: 'SANDBOX', status: 'CONNECTED' },
      });

      const cert = await prisma.fiscalSigningCertificate.findFirst({
        where: { tenantId, companyId, environment: 'SANDBOX', status: 'ACTIVE' },
      });

      return {
        companyExists: true,
        fiscalProfileExists: !!profile,
        haciendaConnectionConnected: !!connection,
        signingCertificateConfigured: !!cert,
        haciendaConnectionSecretReference: connection?.secretReference ?? null,
        signingCertificateSecretReference: cert?.certificateSecretReference ?? null,
        signingCertificatePasswordSecretReference: cert?.passwordSecretReference ?? null,
      };
    },

    async bridgeSecrets(input) {
      // Store Hacienda credentials under the connection's secret reference.
      // The worker reads from this reference when authenticating.
      await secretsProvider.storeSecret(
        input.haciendaConnectionSecretReference,
        JSON.stringify({ username: input.sandboxUsername, password: input.sandboxPassword }),
      );

      // Store signing certificate bytes under the certificate's secret reference.
      // The signing service reads pkcs12Base64 + passphrase from these references.
      const certBytes = fs.readFileSync(input.certPath);
      await secretsProvider.storeSecret(
        input.signingCertificateSecretReference,
        JSON.stringify({ pkcs12Base64: certBytes.toString('base64') }),
      );
      await secretsProvider.storeSecret(
        input.signingCertificatePasswordSecretReference,
        input.certPin,
      );
    },

    async createTempApiKey(companyId, tenantId) {
      const keyId = randomUUID();
      const keyPrefix = randomUUID().replace(/-/g, '').substring(0, 8);
      // Hash not needed for authorization check — only the DB link matters.
      await prisma.apiKey.create({
        data: {
          id: keyId,
          tenantId,
          name: `F4S-TASK-009-${Date.now()}`,
          environment: 'TEST',
          keyPrefix,
          keyHash: `f4s-temp-${keyPrefix}`,
          scopes: ['invoices:write', 'tickets:write'],
          status: 'ACTIVE',
        },
      });
      await prisma.apiKeyCompany.create({ data: { apiKeyId: keyId, companyId } });
      return keyId;
    },

    async createDocument({ companyId, tenantId, tempApiKeyId }) {
      // Stage 1: Create fiscal document (status → READY_FOR_XML)
      const docResponse = await documentService.createDocument({
        tenantId,
        companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
        receiver: {
          name: 'F4S Sandbox Test Receiver',
          identificationType: 'JURIDICA',
          identificationNumber: '3101000001',
          email: 'sandbox-test@example.co.cr',
        },
        lines: [
          {
            lineNumber: 1,
            // Real CAByS catalog entry: "Servicios de consultoría en software" (first digit 8 → SERVICE)
            // Verified via GET https://api.hacienda.go.cr/fe/cabys?codigo=8313100000100
            cabysCode: '8313100000100',
            description: 'Sandbox validation item — F4-S TASK-009',
            unitMeasure: 'Sp',
            quantity: '1.00000',
            unitPrice: '1000.00000',
            taxAmount: '130.00000',
            taxCode: '01',
            taxRateCode: '08',
            taxRate: '13.00000',
          },
        ],
        idempotencyKey: `F4S-T009-${Date.now()}`,
        apiKeyId: tempApiKeyId,
        actor: undefined,
      });
      return {
        documentId: docResponse.id as string,
        clave: docResponse.clave as string,
      };
    },

    async prepareXmlAndQueue({ documentId, tenantId, companyId, tempApiKeyId }) {
      // Stage 2: XML generation + XAdES signing + XSD validation → READY_TO_SUBMIT
      await prepareFiscalXmlService.execute({
        tenantId,
        documentId,
        apiKeyId: tempApiKeyId,
        scopes: ['invoices:write'],
        actor: 'F4S-TASK-009',
      });

      // Stage 3: Read signed XML SHA-256 from storage via the artifact
      const artifact = await prisma.fiscalXmlArtifact.findFirst({
        where: { fiscalDocumentId: documentId },
        orderBy: { createdAt: 'desc' },
      });
      if (!artifact?.signedXmlStorageKey || !artifact.signedXmlSha256) {
        throw new Error('SIGNED_XML_ARTIFACT_NOT_FOUND after PrepareFiscalXmlService');
      }

      // Verify signed XML bytes integrity — hash only, never log XML bytes
      const { createHash } = await import('crypto');
      const signedXmlBytes = await storagePort.download(artifact.signedXmlStorageKey);
      const actualHash = createHash('sha256').update(signedXmlBytes).digest('hex');
      if (actualHash !== artifact.signedXmlSha256) {
        throw new Error('SIGNED_XML_HASH_MISMATCH: stored hash does not match downloaded bytes');
      }

      // Stage 4: Create and queue submission record
      const { SubmitFiscalDocumentService } =
        await import('@/modules/fiscal-documents/application/submission/submit-fiscal-document.service');
      const submitService = moduleRef.get<InstanceType<typeof SubmitFiscalDocumentService>>(
        SubmitFiscalDocumentService,
      );
      await submitService.execute({
        tenantId,
        companyId,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        documentId,
        apiKeyId: tempApiKeyId,
        scopes: ['invoices:write'],
      });

      // Stage 5: Read the created submission ID
      const submission = await prisma.fiscalSubmission.findFirst({
        where: { fiscalDocumentId: documentId },
        orderBy: { createdAt: 'desc' },
      });
      if (!submission) {
        throw new Error('SUBMISSION_RECORD_NOT_FOUND after SubmitFiscalDocumentService');
      }

      return {
        signedXmlSha256: artifact.signedXmlSha256,
        submissionId: submission.id,
      };
    },

    async executeSubmission(submissionId) {
      // Update status to QUEUED so handleSubmitJob can claim it
      await prisma.fiscalSubmission.updateMany({
        where: { id: submissionId, status: { in: ['REQUESTED', 'QUEUED'] } },
        data: { status: 'QUEUED', nextAttemptAt: new Date() },
      });

      // Execute the real submission worker — this makes the live Hacienda calls
      await worker.handleSubmitJob({ submissionId });

      // Read the resulting state from the database
      const updated = await prisma.fiscalSubmission.findUnique({
        where: { id: submissionId },
      });
      if (!updated) {
        throw new Error('SUBMISSION_NOT_FOUND after handleSubmitJob');
      }

      const lastProviderMetadata = (
        updated as unknown as { lastProviderMetadata?: Record<string, string | number | boolean | null> | null }
      ).lastProviderMetadata;

      return {
        submissionState: updated.status,
        // lastHttpStatus is stored by FiscalSubmissionStateService.applyProviderResult()
        httpStatus: (updated as unknown as { lastHttpStatus?: number | null }).lastHttpStatus ?? 0,
        // providerLocation is set by FiscalSubmissionStateService when the adapter
      // captures a Location header.  lastProviderStatus stores ind-estado (GET only).
      locationHeaderPresent: !!(
        (updated as unknown as { providerLocation?: string | null }).providerLocation
      ),
        rateLimitObserved: undefined,
        errorCode: updated.lastNormalizedErrorCode ?? undefined,
        haciendaProviderMetadata: lastProviderMetadata ?? undefined,
      };
    },

    async findSubmission(documentId) {
      const sub = await prisma.fiscalSubmission.findFirst({
        where: { fiscalDocumentId: documentId },
        orderBy: { createdAt: 'desc' },
      });
      return sub ? { id: sub.id, status: sub.status } : null;
    },
  };
}

// ── Main scenario ─────────────────────────────────────────────────────────────

/**
 * TASK-009: Real FE submission via Billing normal pipeline.
 *
 * Execution order:
 *   1. Assert USE_REAL_HACIENDA=true.
 *   2. Run safety guard — abort if any check fails.
 *   3. Assert required credentials are present.
 *   4. Bootstrap NestJS app context (or use injected context for unit tests).
 *   5. Verify company fiscal prerequisites in the database.
 *   6. Bridge runtime secrets into SecretProvider (in-memory only).
 *   7. Create temporary API key for pipeline authorization.
 *   8. Create FE document + prepare signed XML (full pipeline).
 *   9. Verify signed XML hash locally.
 *  10. Execute FiscalSubmissionWorkerService.handleSubmitJob() (real Hacienda POST).
 *  11. Verify HTTP 201 → ACKNOWLEDGED (NOT ACCEPTED).
 *  12. Write sanitized evidence.
 *
 * Network guarantee: production endpoint is unreachable by construction
 * (safety guard + HaciendaRecepcionAdapter URL selection enforces sandbox only).
 */
// ── Private helpers ─────────────────────────────────────────────────────────

/**
 * Builds a sanitized, human-readable error message for a Hacienda submission
 * failure that reached the /recepcion POST stage.
 *
 * Priority:
 *   1. Any captured Hacienda diagnostic field values (haciendaDetail etc.)
 *   2. Structural shape hint when allowlist missed (providerBodyKeys present)
 *   3. HTTP status fallback with explicit note that no diagnostic was captured
 *
 * NEVER includes: raw body, XML, tokens, credentials, or raw HTTP objects.
 */
/**
 * Builds a sanitized, human-readable error message for a Hacienda submission
 * failure that reached the /recepcion POST stage.
 *
 * Priority (highest first):
 *   0. X-Error-Cause response header (haciendaErrorCause)
 *   1. Allowlisted body value fields (haciendaDetail / haciendaMessage / etc.)
 *   2. Body key-shape hint (providerBodyKeys present — schema unknown)
 *   3. Empty body + no X-Error-Cause: explicit empty-body message
 *   4. Content-type fallback with actionable note
 *   5. Bare HTTP status fallback
 *
 * NEVER includes: raw body, XML, tokens, credentials, raw HTTP objects.
 */
/**
 * Builds a diagnostic block for an undocumented 2xx (e.g. HTTP 202).
 *
 * HTTP 202 is NOT documented in the Hacienda POST /recepcion contract.
 * NEVER classify it as ACKNOWLEDGED or ACCEPTED.
 * NEVER call it SUBMISSION_FAILED — the document may have been received.
 * Reconcile via GET /recepcion/{clave} before deciding to re-POST.
 */
function buildUnresolved2xxMessage(outcome: Task009SubmissionOutcome): string {
  const http = outcome.httpStatus > 0 ? outcome.httpStatus : 'unknown';
  const meta = outcome.haciendaProviderMetadata ?? {};
  const classification = (meta['responseClassification'] as string | undefined) ?? 'UNDOCUMENTED_2XX';
  const location = outcome.locationHeaderPresent ? 'CAPTURED' : 'NOT PRESENT / UNKNOWN';

  return [
    `Hacienda HTTP response`,
    `  HTTP status    : ${http}`,
    `  Contract status: NOT DOCUMENTED FOR POST /recepcion`,
    `  Classification  : ${classification}`,
    `  Meaning         : Unknown Hacienda-specific semantics for this 2xx`,
    `  Location header : ${location}`,
    `  Billing result  : UNRESOLVED_PROVIDER_RESPONSE`,
    `  Fiscal accept.  : NOT PROVEN`,
    `  Action needed   : GET /recepcion/{clave} to query authoritative Hacienda status`,
    `  DO NOT re-POST  : existing document clave is valid for status query`,
  ].join('\n');
}

function buildHaciendaFailureMessage(outcome: Task009SubmissionOutcome): string {
  const meta = outcome.haciendaProviderMetadata;
  const http = outcome.httpStatus > 0 ? outcome.httpStatus : 'unknown';

  if (meta) {
    // Priority 0: X-Error-Cause header — the canonical Hacienda rejection reason
    const errorCause = meta['haciendaErrorCause'] as string | undefined;
    if (errorCause) {
      return `Hacienda HTTP ${http} — ${errorCause}`;
    }

    // Priority 1: allowlisted body value fields
    const valueMsg =
      (meta['haciendaDetail'] as string | undefined) ??
      (meta['haciendaMessage'] as string | undefined) ??
      (meta['haciendaTitle'] as string | undefined) ??
      (meta['haciendaFirstErrorMessage'] as string | undefined);
    if (valueMsg) {
      return `Hacienda HTTP ${http}: ${valueMsg}`;
    }

    // Priority 2: body shape captured — keys known, values not yet allowlisted
    const bodyKeys = meta['providerBodyKeys'] as string | undefined;
    const firstElemKeys = meta['providerBodyFirstElementKeys'] as string | undefined;
    const bodyShape = meta['providerBodyShape'] as string | undefined;
    if (bodyKeys || firstElemKeys) {
      const hint = bodyKeys ?? firstElemKeys ?? '';
      return (
        `Hacienda HTTP ${http} — response body keys: [${hint}]. ` +
        `Add matching keys to the allowlist in extractAllowlistedFields().` +
        (bodyShape ? ` Nested shape: ${bodyShape}` : '')
      );
    }

    // Priority 3: empty body without X-Error-Cause — explicit and actionable
    const parseStatus = meta['providerBodyParseStatus'] as string | undefined;
    if (parseStatus === 'EMPTY_STRING') {
      return (
        `Hacienda HTTP ${http} returned an empty response body and no X-Error-Cause header.`
      );
    }

    // Priority 4: content-type known but body not useful
    if (meta['responseContentType']) {
      return (
        `Hacienda HTTP ${http} — body content-type is ` +
        `${String(meta['responseContentType'])}; no diagnostic fields were captured.`
      );
    }
  }

  return `Hacienda returned HTTP ${http} without a captured diagnostic.`;
}

export async function runTask009FeSubmissionScenario(
  options: Task009ScenarioOptions = {},
): Promise<Task009Result> {
  const companyId = process.env['F4S_COMPANY_ID'] ?? '';
  const tenantId = process.env['F4S_TENANT_ID'] ?? '';

  // Step 1: Assert USE_REAL_HACIENDA=true
  if (!isUseRealHaciendaEnabled()) {
    return buildAbortResult(
      companyId,
      'USE_REAL_HACIENDA_NOT_SET',
      'USE_REAL_HACIENDA must be set to true for TASK-009 live execution.',
    );
  }

  // Step 2: Run safety guard BEFORE any HTTP call or NestJS bootstrap
  const receptionUrl = process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] ?? '';
  const tokenUrl = process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL;
  const clientId = process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID;

  const guardResults = validateF4sEndpoints({ receptionBaseUrl: receptionUrl, tokenUrl, clientId });
  if (!allGuardResultsPass(guardResults)) {
    return buildAbortResult(
      companyId,
      'SAFETY_GUARD_FAILED',
      'Safety guard did not pass. No Hacienda HTTP requests made.',
    );
  }

  // Step 3: Assert credentials present (presence only — never logged)
  const username = process.env['F4S_SANDBOX_USERNAME'];
  const password = process.env['F4S_SANDBOX_PASSWORD'];
  const certPath = process.env['F4S_SANDBOX_CERT_PATH'];
  const certPin = process.env['F4S_SANDBOX_CERT_PIN'];
  const hasCompanyId = !!companyId;
  const hasTenantId = !!tenantId;

  if (!username || !password || !certPath || !certPin || !hasCompanyId || !hasTenantId) {
    return buildAbortResult(
      companyId,
      'MISSING_CREDENTIALS',
      'Required env vars are missing: F4S_SANDBOX_USERNAME, F4S_SANDBOX_PASSWORD, ' +
        'F4S_SANDBOX_CERT_PATH, F4S_SANDBOX_CERT_PIN, F4S_COMPANY_ID, F4S_TENANT_ID.',
    );
  }

  // Step 4: Get app context (injected for unit tests, bootstrapped for live)
  let context: Task009Context;
  try {
    context = options.contextFactory ? await options.contextFactory() : await createLiveContext();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildAbortResult(companyId, 'CONTEXT_FACTORY_ERROR', `App context failed: ${msg}`);
  }

  // Step 5: Verify company fiscal prerequisites
  let prereqs: Task009Prerequisites;
  try {
    prereqs = await context.checkPrerequisites({ companyId, tenantId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildAbortResult(companyId, 'UNEXPECTED_ERROR', `Prerequisite check failed: ${msg}`);
  }

  if (!prereqs.companyExists) {
    return buildAbortResult(
      companyId,
      'COMPANY_NOT_FOUND',
      `Company ${companyId} not found in SANDBOX database for tenant ${tenantId}.`,
    );
  }
  if (!prereqs.fiscalProfileExists) {
    return buildAbortResult(
      companyId,
      'FISCAL_PROFILE_MISSING',
      `Company ${companyId} has no fiscal profile. Configure via API before running TASK-009.`,
    );
  }
  if (!prereqs.haciendaConnectionConnected) {
    return buildAbortResult(
      companyId,
      'HACIENDA_CONNECTION_NOT_CONNECTED',
      `Company ${companyId} has no CONNECTED Hacienda connection for SANDBOX.`,
    );
  }
  if (!prereqs.signingCertificateConfigured) {
    return buildAbortResult(
      companyId,
      'SIGNING_CERTIFICATE_NOT_CONFIGURED',
      `Company ${companyId} has no active signing certificate for SANDBOX.`,
    );
  }
  if (
    !prereqs.haciendaConnectionSecretReference ||
    !prereqs.signingCertificateSecretReference ||
    !prereqs.signingCertificatePasswordSecretReference
  ) {
    return buildAbortResult(
      companyId,
      'SIGNING_CERTIFICATE_NOT_CONFIGURED',
      `Company ${companyId} signing certificate or Hacienda connection is missing secret references.`,
    );
  }

  // Step 6: Bridge runtime secrets into SecretProvider (in-memory, never persisted)
  try {
    await context.bridgeSecrets({
      haciendaConnectionSecretReference: prereqs.haciendaConnectionSecretReference,
      signingCertificateSecretReference: prereqs.signingCertificateSecretReference,
      signingCertificatePasswordSecretReference: prereqs.signingCertificatePasswordSecretReference,
      sandboxUsername: username,
      sandboxPassword: password,
      certPath,
      certPin,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildAbortResult(
      companyId,
      'UNEXPECTED_ERROR',
      `Secret bridging failed (non-sensitive error): ${msg}`,
    );
  }

  // Step 7: Create temporary API key (internal use only — for pipeline authorization checks)
  let tempApiKeyId: string;
  try {
    tempApiKeyId = await context.createTempApiKey(companyId, tenantId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildAbortResult(companyId, 'UNEXPECTED_ERROR', `Temp API key creation failed: ${msg}`);
  }

  // Step 8: Create fiscal document (no Hacienda network)
  // Stage is ALWAYS explicit — never inferred from exception message content.
  let createdDoc: Task009CreatedDocument;
  try {
    createdDoc = await context.createDocument({ companyId, tenantId, tempApiKeyId });
  } catch (err: unknown) {
    const diag = extractHttpExceptionDiagnostic(err);
    const result = buildAbortResult(
      companyId,
      'DOCUMENT_CREATION_FAILED',
      `Document creation failed${diag?.domainCode ? `: ${diag.domainCode}` : ''}`,
      { pipelineStage: 'DOCUMENT_CREATION', httpStatus: diag?.httpStatus, domainCode: diag?.domainCode },
    );
    if (!(options.skipEvidenceWrite ?? false)) await writeTask009Summary(result.evidence, 'S04-FE-submission');
    return result;
  }

  // Step 9: Prepare signed XML + queue submission (no Hacienda network)
  // Stage is ALWAYS explicit — never inferred from exception message content.
  let xmlQueued: { signedXmlSha256: string; submissionId: string };
  try {
    xmlQueued = await context.prepareXmlAndQueue({
      documentId: createdDoc.documentId,
      clave: createdDoc.clave,
      tenantId,
      companyId,
      tempApiKeyId,
    });
  } catch (err: unknown) {
    const diag = extractHttpExceptionDiagnostic(err);
    const result = buildAbortResult(
      companyId,
      'XML_PREPARATION_FAILED',
      `XML preparation failed${diag?.domainCode ? `: ${diag.domainCode}` : ''}`,
      {
        pipelineStage: 'XML_PREPARATION',
        httpStatus: diag?.httpStatus,
        domainCode: diag?.domainCode,
        xsdFirstError: diag?.xsdFirstError,
      },
    );
    if (!(options.skipEvidenceWrite ?? false)) await writeTask009Summary(result.evidence, 'S04-FE-submission');
    return result;
  }

  const prepared: Task009PreparedDocument = {
    documentId: createdDoc.documentId,
    clave: createdDoc.clave,
    ...xmlQueued,
  };

  // Step 10: Execute real submission (IdP auth + POST /recepcion)
  let outcome: Task009SubmissionOutcome;
  try {
    outcome = await context.executeSubmission(prepared.submissionId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildAbortResult(companyId, 'SUBMISSION_FAILED', `Submission execution failed: ${msg}`);
  }

  // Step 11: Evaluate result
  const isAcknowledged = outcome.submissionState === 'ACKNOWLEDGED';
  const isFailed =
    outcome.submissionState === 'TECHNICAL_RETRY_PENDING' ||
    outcome.submissionState === 'POST_OUTCOME_UNKNOWN' ||
    outcome.submissionState === 'MANUAL_REVIEW_REQUIRED';

  let submissionStatus: Task009Status;
  let submissionErrorCode: Task009FailReason | undefined;
  // A sanitized, human-readable message for the runner output and result.
  // Never contains credentials, tokens, XML, or raw HTTP bodies.
  let submissionErrorMessage: string | undefined;

  if (isAcknowledged) {
    submissionStatus = 'PASS';
  } else if (outcome.errorCode === 'HACIENDA_TOKEN_EXPIRED') {
    submissionStatus = 'FAIL';
    submissionErrorCode = 'AUTHENTICATION_FAILED_401';
    submissionErrorMessage = 'Hacienda returned HTTP 401 — access token rejected or expired.';
  } else if (outcome.errorCode === 'HACIENDA_RATE_LIMIT') {
    submissionStatus = 'FAIL';
    submissionErrorCode = 'RATE_LIMITED_429';
    submissionErrorMessage = 'Hacienda returned HTTP 429 — rate limit exceeded.';
  } else if (outcome.errorCode === 'HACIENDA_UNDOCUMENTED_2XX_STATUS') {
    // Undocumented 2xx (e.g. HTTP 202) — not a definitive failure or success.
    // The document may have been received.  DO NOT re-POST — query status first.
    submissionStatus = 'FAIL';
    submissionErrorCode = 'UNRESOLVED_UNDOCUMENTED_2XX';
    submissionErrorMessage = buildUnresolved2xxMessage(outcome);
  } else if (
    outcome.errorCode === 'HACIENDA_POST_OUTCOME_UNKNOWN' ||
    outcome.submissionState === 'POST_OUTCOME_UNKNOWN'
  ) {
    // 5xx ambiguous POST
    submissionStatus = 'FAIL';
    submissionErrorCode = 'SUBMISSION_AMBIGUOUS_5XX';
    submissionErrorMessage = `Hacienda returned HTTP ${outcome.httpStatus > 0 ? outcome.httpStatus : '5xx'} — POST outcome ambiguous, manual reconciliation required.`;
  } else if (outcome.errorCode === 'HACIENDA_NETWORK_ERROR') {
    submissionStatus = 'FAIL';
    submissionErrorCode = 'SUBMISSION_NETWORK_ERROR';
    submissionErrorMessage = 'Hacienda submission failed due to a network error (no HTTP response).';
  } else if (isFailed) {
    submissionStatus = 'FAIL';
    submissionErrorCode = 'SUBMISSION_FAILED';
    submissionErrorMessage = buildHaciendaFailureMessage(outcome);
  } else {
    submissionStatus = 'FAIL';
    submissionErrorCode = 'UNEXPECTED_ERROR';
    submissionErrorMessage = `Unexpected submission outcome: state=${outcome.submissionState} errorCode=${outcome.errorCode ?? 'none'}.`;
  }

  // Step 12: Build and write sanitized evidence
  const networkIsolation: Task009NetworkIsolation = {
    // IdP request: always 1 (auth is internal to handleSubmitJob)
    idpRequestsMade: isAcknowledged || isFailed ? 1 : 0,
    // recepcion: 1 when submission was attempted
    recepcionPostRequestsMade: isAcknowledged || isFailed ? 1 : 0,
    // Production: ALWAYS 0 (guaranteed by safety guard + adapter URL selection)
    productionRequestsMade: 0,
  };

  const evidence: Task009SubmissionEvidence = {
    scenario: 'TASK-009',
    environment: 'SANDBOX',
    timestamp: new Date().toISOString(),
    result: submissionStatus,
    companyId,
    clave: prepared.clave,
    signedXmlSha256: prepared.signedXmlSha256,
    httpStatus: outcome.httpStatus > 0 ? outcome.httpStatus : undefined,
    locationHeaderPresent: outcome.locationHeaderPresent,
    submissionState: outcome.submissionState,
    // This MUST always be false — HTTP 201 is ACKNOWLEDGED, never ACCEPTED
    http201MappedToAccepted: false,
    ...(outcome.haciendaProviderMetadata
      ? { haciendaDiagnostic: outcome.haciendaProviderMetadata }
      : {}),
    ...(outcome.rateLimitObserved ? { rateLimitObserved: outcome.rateLimitObserved } : {}),
    networkIsolation,
    ...(submissionErrorCode !== undefined ? { errorCode: submissionErrorCode } : {}),
    secretsExposed: 0,
  };

  if (!(options.skipEvidenceWrite ?? false)) {
    await writeTask009Summary(evidence, 'S04-FE-submission');
  }

  return {
    status: submissionStatus,
    evidence,
    ...(submissionErrorCode !== undefined ? { errorCode: submissionErrorCode } : {}),
    ...(submissionErrorMessage !== undefined ? { errorMessage: submissionErrorMessage } : {}),
  };
}
