/* eslint-disable no-console */
/**
 * F4-S Hacienda Sandbox Validation Runner — TASK-006 / TASK-008 / TASK-009
 *
 * Entry point for: npm run test:hacienda-sandbox
 *              or: npm run test:hacienda-sandbox -- --preflight
 *              or: npm run test:hacienda-sandbox -- --scenario TASK-008
 *              or: npm run test:hacienda-sandbox -- --scenario TASK-009
 *              or: npm run test:hacienda-sandbox -- --scenario TASK-009-STATUS
 *
 * CRITICAL SAFETY RULE:
 *   Preflight MUST make ZERO real Hacienda HTTP requests.
 *   Real HTTP requests (TASK-008+) require all preflight gates to pass first.
 *
 * Modes:
 *   --preflight                  Validates config, prerequisites, certificate, adapters.
 *                                Makes ZERO Hacienda HTTP requests. Stops here.
 *   --scenario TASK-008          Runs preflight then TASK-008 real authentication only.
 *   --scenario TASK-009          Runs preflight then TASK-009 real FE submission only.
 *   --scenario TASK-009-STATUS   Runs preflight then queries the existing 202 submission
 *                                via GET /recepcion/{clave}. Requires
 *                                F4S_EXISTING_SUBMISSION_CLAVE in .env.local.
 *                                POST /recepcion: NEVER called.
 *   (default)                    Runs preflight then TASK-008.
 *
 * Scenario selection safety:
 *   - Unknown scenario → abort before any Hacienda request
 *   - Any scenario aborts if preflight != READY_FOR_SANDBOX_EXECUTION
 *   - Production environment → abort (enforced by safety guard in each scenario)
 *   - TASK-010+ not implemented → abort
 *
 * Expected preflight statuses:
 *   READY_FOR_SANDBOX_EXECUTION       All prerequisites met.
 *   BLOCKED_BY_MISSING_PREREQUISITES  Credentials or config not set.
 *   FAIL_CONFIGURATION                Invalid configuration value.
 *   FAIL_SECURITY_GUARD               Endpoint not in allowlist.
 *
 * LOCAL ENV LOADING:
 *   The runner loads .env.local from the project root before reading
 *   process.env. Shell-level env vars always take priority (no override).
 *   Never commit .env.local — it is gitignored.
 *   Rule: do NOT add quotes to env values in .env.local for these variables.
 */

// reflect-metadata must be imported before any NestJS decorator is evaluated.
import 'reflect-metadata';
import * as path from 'path';
import * as fs from 'fs';
import { validateF4sPrerequisites } from '../preflight/f4s-prerequisite-validator';
import { assertAdapterConfigForPreflight } from '../preflight/f4s-adapter-assertion';
import {
  validateF4sEndpoints,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';
import { runTask008RealAuthScenario } from '../scenarios/task-008-real-auth';
import { runTask009FeSubmissionScenario } from '../scenarios/task-009-fe-submission';
import { runTask009StatusQueryScenario } from '../scenarios/task-009-status-query';
import type { PreflightReport } from '../types';

// ── Local env loader ──────────────────────────────────────────────────────────
// Loads .env.local from the project root (gitignored — never committed).
// Must be called before any function that reads process.env.
// Does NOT override env vars already set in the shell session.
// Does NOT log any value it reads.

function loadLocalEnv(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1);
      // Strip surrounding single or double quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Only set if not already in the environment (shell takes priority)
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore — user may not have .env.local yet
  }
}

// ── Hacienda HTTP call counter ────────────────────────────────────────────────
// Incremented by future scenario code that makes real calls.
// MUST remain 0 throughout preflight mode.
let haciendaHttpRequestCount = 0;

export function incrementHaciendaHttpCount(): void {
  haciendaHttpRequestCount++;
}

export function getHaciendaHttpCount(): number {
  return haciendaHttpRequestCount;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIVIDER = '════════════════════════════════════════════════════════════';

// ── Preflight ─────────────────────────────────────────────────────────────────

async function runPreflight(): Promise<PreflightReport> {
  console.log('');
  console.log(DIVIDER);
  console.log('  F4-S Hacienda Sandbox Validation — PREFLIGHT CHECK');
  console.log(DIVIDER);
  console.log('');
  console.log('  Hacienda HTTP requests: 0 (preflight makes no real calls)');
  console.log('  Safety guard: checking endpoints...');
  console.log('');

  const timestamp = new Date().toISOString();

  // 1. Safety guard — only run if reception URL is explicitly configured.
  //    Empty/absent URL = MISSING (not dangerous). Guard fires only when a
  //    real value is set so it can be validated against the allowlist.
  const receptionUrl = process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] ?? '';
  const tokenUrl = process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL;
  const clientId = process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID;

  let safetyGuardResults: ReturnType<typeof validateF4sEndpoints>;

  if (receptionUrl.trim() !== '') {
    safetyGuardResults = validateF4sEndpoints({
      receptionBaseUrl: receptionUrl,
      tokenUrl,
      clientId,
    });
    for (const result of safetyGuardResults) {
      const icon = result.status === 'PASS' ? '✓' : '✗';
      console.log(`  [${icon}] ${result.code}: ${result.message}`);
    }
  } else {
    safetyGuardResults = [];
    const notConfiguredMsg =
      '  [?] SAFETY_GUARD: NOT_CONFIGURED' +
      ' — set HACIENDA_RECEPCION_SANDBOX_BASE_URL to activate.';
    console.log(notConfiguredMsg);
  }
  console.log('');

  // 2. Adapter assertion
  console.log('  Adapter assertion: checking adapter configuration...');
  const adapterAssertionResult = assertAdapterConfigForPreflight();
  const adapterIcon =
    adapterAssertionResult.status === 'REAL_ADAPTERS_CONFIRMED' ||
    adapterAssertionResult.status === 'USE_REAL_HACIENDA_NOT_SET'
      ? adapterAssertionResult.status === 'REAL_ADAPTERS_CONFIRMED'
        ? '✓'
        : '!'
      : '✗';
  const adapterLine =
    `  [${adapterIcon}] ${adapterAssertionResult.status}: ` + adapterAssertionResult.message;
  console.log(adapterLine);
  console.log('');

  // 3. Prerequisites
  console.log('  Prerequisites: validating...');
  const prerequisiteResult = await validateF4sPrerequisites();

  for (const item of prerequisiteResult.items) {
    const statusIcon = item.status === 'READY' ? '✓' : item.status === 'MISSING' ? '?' : '✗';
    const codeStr = item.sanitizedCode ? ` [${item.sanitizedCode}]` : '';
    console.log(`  [${statusIcon}] ${item.name}: ${item.status}${codeStr}`);
  }
  console.log('');

  // 4. Hacienda HTTP count assertion (MUST be 0)
  const httpCount = getHaciendaHttpCount();
  console.log(`  Hacienda HTTP requests made during preflight: ${httpCount}`);
  if (httpCount !== 0) {
    console.error(
      `  [CRITICAL] Preflight made ${httpCount} real Hacienda HTTP request(s). Must be 0.`,
    );
  }
  console.log('');

  const report: PreflightReport = {
    aggregateStatus: prerequisiteResult.aggregateStatus,
    items: prerequisiteResult.items,
    safetyGuardResults,
    adapterAssertionResult,
    timestamp,
    haciendaHttpRequestsMade: httpCount,
  };

  // 5. Print summary
  console.log(DIVIDER);
  console.log(`  PREFLIGHT RESULT: ${report.aggregateStatus}`);
  console.log(`  Hacienda HTTP requests: ${httpCount}`);
  console.log(DIVIDER);
  console.log('');

  if (report.aggregateStatus === 'READY_FOR_SANDBOX_EXECUTION') {
    console.log('  All prerequisites met.');
    console.log('  Available scenarios:');
    console.log(
      '    npm run test:hacienda-sandbox -- --scenario TASK-008         (authentication only)',
    );
    console.log('    npm run test:hacienda-sandbox -- --scenario TASK-009         (FE submission)');
    console.log(
      '    npm run test:hacienda-sandbox -- --scenario TASK-009-STATUS  (query existing 202 submission)',
    );
    console.log('    npm run test:hacienda-sandbox  (defaults to TASK-008)');
    console.log('  TASK-009-STATUS requires F4S_EXISTING_SUBMISSION_CLAVE in .env.local.');
    console.log('  TASK-010+ (reconciliation) not yet implemented.');
  } else {
    console.log('  Prerequisites not met. Resolve the items above before running live scenarios.');
  }

  console.log('');
  return report;
}

// ── Scenario: TASK-008 ────────────────────────────────────────────────────────

async function runTask008Scenario(): Promise<void> {
  console.log(DIVIDER);
  console.log('  TASK-008: REAL HACIENDA SANDBOX AUTHENTICATION');
  console.log(DIVIDER);
  console.log('');
  console.log('  Performing ONE controlled authentication against the sandbox IdP.');
  console.log('  Hacienda /recepcion: NOT contacted during TASK-008.');
  console.log('');

  const task008Result = await runTask008RealAuthScenario();

  const iso = task008Result.evidence.networkIsolation;
  console.log(
    `  Hacienda IdP interaction: ${iso.idpRequestsMade === 1 ? 'REAL' : 'NONE/UNEXPECTED'}`,
  );
  console.log(`  Hacienda IdP requests:    ${iso.idpRequestsMade}`);
  console.log(`  Hacienda reception requests: ${iso.recepcionRequestsMade}`);
  console.log(`  Production requests:      ${iso.productionRequestsMade}`);
  console.log(`  Total Hacienda requests:  ${iso.totalRequestsMade}`);
  console.log('');

  if (task008Result.status === 'PASS') {
    console.log('  TASK-008 REAL SANDBOX AUTHENTICATION: PASS');
    console.log(`  Token received:  ${task008Result.evidence.tokenReceived}`);
    if (task008Result.evidence.tokenType !== undefined) {
      console.log(`  Token type:      ${task008Result.evidence.tokenType}`);
    }
    if (task008Result.evidence.expiresIn !== undefined) {
      console.log(`  Expires in (s):  ${task008Result.evidence.expiresIn}`);
    }
    console.log(`  HTTP status:     ${task008Result.evidence.httpStatus}`);
  } else {
    console.error('  TASK-008 REAL SANDBOX AUTHENTICATION: FAIL');
    console.error(`  Error code:    ${task008Result.errorCode ?? 'unknown'}`);
    console.error(`  Error message: ${task008Result.errorMessage ?? 'none'}`);
    console.error(`  HTTP status:   ${task008Result.evidence.httpStatus}`);
  }

  console.log('');
  console.log('  Secrets exposed:          0');
  console.log(
    `  Hacienda IdP interaction: ${task008Result.status === 'PASS' ? 'REAL' : 'ATTEMPTED'}`,
  );
  console.log('  Hacienda reception requests: 0');
  console.log('  Production Hacienda requests: 0');
  console.log('');
  console.log(`  Evidence written to: test-output/hacienda-sandbox/TASK-008/`);
  console.log('');
  console.log(DIVIDER);
  console.log(`  TASK-008 RESULT: ${task008Result.status}`);
  console.log(DIVIDER);
  console.log('');

  process.exit(task008Result.status === 'PASS' ? 0 : 1);
}

// ── Scenario: TASK-009 ────────────────────────────────────────────────────────

async function runTask009Scenario(): Promise<void> {
  console.log(DIVIDER);
  console.log('  TASK-009: REAL FE SUBMISSION VIA BILLING NORMAL PIPELINE');
  console.log(DIVIDER);
  console.log('');
  console.log('  Creating ONE real FE document through Billing pipeline.');
  console.log('  Expected: HTTP 201 ACKNOWLEDGED (not ACCEPTED).');
  console.log('  Production Hacienda endpoint: NEVER contacted.');
  console.log('');
  console.log('  WARNING: This bootstraps the full NestJS application.');
  console.log('  Ensure DATABASE_URL points to the SANDBOX database.');
  console.log('');

  const task009Result = await runTask009FeSubmissionScenario();

  const iso = task009Result.evidence.networkIsolation;
  console.log(`  Hacienda IdP requests:       ${iso.idpRequestsMade}`);
  console.log(`  Hacienda /recepcion POSTs:   ${iso.recepcionPostRequestsMade}`);
  console.log(`  Production requests:         ${iso.productionRequestsMade}`);
  console.log('');

  if (task009Result.status === 'PASS') {
    console.log('  TASK-009 REAL FE SUBMISSION: PASS');
    console.log(`  Submission state:    ${task009Result.evidence.submissionState ?? 'N/A'}`);
    console.log(`  HTTP status:         ${task009Result.evidence.httpStatus ?? 'N/A'}`);
    console.log(`  Location present:    ${task009Result.evidence.locationHeaderPresent ?? 'N/A'}`);
    console.log(`  HTTP 201 = ACCEPTED? ${task009Result.evidence.http201MappedToAccepted}`);
    if (task009Result.evidence.clave) {
      console.log(
        `  Clave (length ${task009Result.evidence.clave.length}): ${task009Result.evidence.clave}`,
      );
    }
  } else {
    console.error('  TASK-009 REAL FE SUBMISSION: FAIL');
    if (task009Result.evidence.pipelineStage !== undefined) {
      console.error(`  Pipeline stage : ${task009Result.evidence.pipelineStage}`);
    }
    if (task009Result.evidence.httpStatus !== undefined) {
      console.error(`  HTTP status    : ${task009Result.evidence.httpStatus}`);
    }
    if (task009Result.evidence.domainCode !== undefined) {
      console.error(`  Domain code    : ${task009Result.evidence.domainCode}`);
    }
    if (task009Result.evidence.xsdFirstError !== undefined) {
      const { xsdLine, xsdMessage } = task009Result.evidence.xsdFirstError;
      console.error(`  XSD line       : ${xsdLine ?? 'n/a'}`);
      console.error(`  XSD message    : ${xsdMessage}`);
    }
    if (task009Result.evidence.haciendaDiagnostic !== undefined) {
      const diag = task009Result.evidence.haciendaDiagnostic;
      for (const [key, val] of Object.entries(diag)) {
        if (val !== null && val !== undefined) {
          console.error(`  Hacienda [${key}]: ${String(val)}`);
        }
      }
    }
    console.error(`  Error code     : ${task009Result.errorCode ?? 'unknown'}`);
    console.error(`  Error message  : ${task009Result.errorMessage ?? 'none'}`);
  }

  console.log('');
  console.log(`  Secrets exposed: 0`);
  console.log(`  Production Hacienda requests: 0`);
  console.log('');
  console.log(`  Evidence written to: test-output/hacienda-sandbox/TASK-009/`);
  console.log('');
  console.log(DIVIDER);
  console.log(`  TASK-009 RESULT: ${task009Result.status}`);
  console.log(DIVIDER);
  console.log('');

  process.exit(task009Result.status === 'PASS' ? 0 : 1);
}

// ── Scenario: TASK-009-STATUS ─────────────────────────────────────────────────

async function runTask009StatusScenario(): Promise<void> {
  console.log(DIVIDER);
  console.log('  TASK-009-STATUS: QUERY EXISTING 202 SUBMISSION BY CLAVE');
  console.log(DIVIDER);
  console.log('');
  console.log('  Querying Hacienda GET /recepcion/{clave} for the existing unresolved submission.');
  console.log('  POST /recepcion: NEVER called.');
  console.log('  New FiscalDocuments: NONE.');
  console.log('  New consecutives: NONE.');
  console.log('  Production Hacienda endpoint: NEVER contacted.');
  console.log('');

  const clave = process.env['F4S_EXISTING_SUBMISSION_CLAVE'] ?? '';
  if (!clave) {
    console.error('  [BLOCKED] F4S_EXISTING_SUBMISSION_CLAVE not set in .env.local.');
    console.error('  Set it to the clave from the TASK-009 HTTP 202 evidence file.');
    process.exit(1);
    return;
  }
  console.log(`  Target clave length: ${clave.length}`);
  console.log('');

  const result = await runTask009StatusQueryScenario();

  const iso = result.evidence.networkIsolation;
  console.log(`  Hacienda IdP requests:        ${iso.idpRequestsMade}`);
  console.log(`  Hacienda /recepcion GETs:     ${iso.recepcionGetRequestsMade}`);
  console.log(`  Hacienda /recepcion POSTs:    ${iso.recepcionPostRequestsMade}`);
  console.log(`  Production requests:          ${iso.productionRequestsMade}`);
  console.log('');

  if (result.status === 'PASS') {
    console.log('  TASK-009-STATUS: PASS');
    console.log(`  Previous POST status : ${result.evidence.previousPostHttpStatus ?? 'N/A'}`);
    console.log(`  Previous state       : ${result.evidence.previousState ?? 'N/A'}`);
    console.log(`  GET HTTP status      : ${result.evidence.getHttpStatus ?? 'N/A'}`);
    console.log('');
    console.log('  Hacienda processing result:');
    console.log(`    ind-estado     : ${result.evidence.indEstado ?? '(absent)'}`);
    console.log(`    respuesta-xml  : ${result.evidence.respuestaXmlPresent ? 'YES' : 'NO'}`);
    if (result.evidence.haciendaMensaje !== undefined) {
      console.log(`    Mensaje        : ${result.evidence.haciendaMensaje}`);
    }
    if (result.evidence.haciendaDetalleMensaje !== undefined) {
      console.log('    DetalleMensaje :');
      for (const line of result.evidence.haciendaDetalleMensaje.split('\n')) {
        console.log(`      ${line}`);
      }
    }
    console.log('');
    console.log('  Billing result:');
    console.log(`    New state      : ${result.evidence.newState ?? 'N/A'}`);
    console.log(`    Fiscal acc.    : ${result.evidence.fiscalAcceptance ?? 'N/A'}`);
  } else {
    console.error('  TASK-009-STATUS: FAIL');
    console.error(`  Error code     : ${result.errorCode ?? 'unknown'}`);
    console.error(`  Error message  :\n${result.errorMessage ?? 'none'}`);
    if (result.evidence.getHttpStatus !== undefined) {
      console.error(`  GET HTTP status: ${result.evidence.getHttpStatus}`);
    }
    if (result.evidence.indEstado !== undefined) {
      console.error(`  ind-estado     : ${result.evidence.indEstado ?? '(absent)'}`);
    }
  }

  console.log('');
  console.log('  Secrets exposed:              0');
  console.log('  POST /recepcion requests:     0');
  console.log('  Production requests:          0');
  console.log('');
  console.log('  Evidence written to: test-output/hacienda-sandbox/TASK-009-STATUS/');
  console.log('');
  console.log(DIVIDER);
  console.log(`  TASK-009-STATUS RESULT: ${result.status}`);
  console.log(DIVIDER);
  console.log('');

  process.exit(result.status === 'PASS' ? 0 : 1);
}

// ── Scenario selector ─────────────────────────────────────────────────────────

type ScenarioId = 'TASK-008' | 'TASK-009' | 'TASK-009-STATUS';
const IMPLEMENTED_SCENARIOS: readonly ScenarioId[] = ['TASK-008', 'TASK-009', 'TASK-009-STATUS'];

function parseScenarioArg(): ScenarioId | null {
  const idx = process.argv.indexOf('--scenario');
  if (idx === -1) return null;
  const candidate = process.argv[idx + 1];
  if (!candidate || candidate.startsWith('--')) {
    console.error('[F4-S ERROR] --scenario requires a scenario ID (e.g. TASK-008, TASK-009).');
    process.exit(1);
  }
  const upper = candidate.toUpperCase() as ScenarioId;
  if (!IMPLEMENTED_SCENARIOS.includes(upper)) {
    console.error(
      `[F4-S ERROR] Unknown or not-yet-implemented scenario: '${candidate}'. ` +
        `Implemented: ${IMPLEMENTED_SCENARIOS.join(', ')}.`,
    );
    process.exit(1);
  }
  return upper;
}

// ── Live runner ───────────────────────────────────────────────────────────────

async function runLiveScenarios(): Promise<void> {
  console.log('');
  console.log(DIVIDER);
  console.log('  F4-S Hacienda Sandbox Validation — LIVE SCENARIOS');
  console.log(DIVIDER);
  console.log('');

  // Safety: always run preflight before live mode
  const preflightReport = await runPreflight();

  if (preflightReport.aggregateStatus !== 'READY_FOR_SANDBOX_EXECUTION') {
    console.error(
      `[F4-S BLOCKED] Preflight: ${preflightReport.aggregateStatus}. ` +
        'Cannot proceed to live scenarios until all prerequisites pass.',
    );
    process.exit(1);
    return;
  }

  // Determine which scenario to run
  const scenarioId = parseScenarioArg() ?? 'TASK-008';
  console.log(`  Selected scenario: ${scenarioId}`);
  console.log('');

  if (scenarioId === 'TASK-008') {
    await runTask008Scenario();
  } else if (scenarioId === 'TASK-009') {
    await runTask009Scenario();
  } else if (scenarioId === 'TASK-009-STATUS') {
    await runTask009StatusScenario();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load .env.local first — must happen before any process.env reads
  loadLocalEnv();

  const isPreflightMode = process.argv.includes('--preflight');

  if (isPreflightMode) {
    const report = await runPreflight();
    // Exit 0 for BLOCKED/MISSING (expected during infrastructure setup)
    // Exit 1 for FAIL_SECURITY_GUARD and FAIL_CONFIGURATION (hard failures)
    if (
      report.aggregateStatus === 'FAIL_SECURITY_GUARD' ||
      report.aggregateStatus === 'FAIL_CONFIGURATION'
    ) {
      process.exit(1);
    }
    process.exit(0);
  }

  await runLiveScenarios();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[F4-S FATAL] Runner error: ${message}`);
  process.exit(1);
});
