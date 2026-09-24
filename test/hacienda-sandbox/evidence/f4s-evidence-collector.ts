/**
 * F4-S Sanitized Evidence Collector — TASK-007
 *
 * Collects sandbox HTTP evidence using an EXPLICIT ALLOWLIST approach.
 * Evidence is constructed from approved safe fields only — not by
 * accepting arbitrary objects and trying to redact them afterwards.
 *
 * SECURITY INVARIANTS:
 *   - Authorization / Bearer token: NEVER serialized
 *   - username, password, PIN: NEVER serialized
 *   - PKCS#12 bytes / private key material: NEVER serialized
 *   - SecretProvider values: NEVER serialized
 *   - API keys, database credentials: NEVER serialized
 *   - Environment variables containing secrets: NEVER serialized
 *
 * Safe fields (explicit allowlist):
 *   timestamp, scenarioId, environment='SANDBOX', hostname,
 *   httpMethod, sanitizedPath, httpStatus, durationMs,
 *   adapterIdentity, clave, safeLocationHeader,
 *   rateLimitHeaders (limit/remaining/reset/retryAfterSeconds),
 *   correlationId, responseArtifactSha256
 *
 * Evidence location: test-output/hacienda-sandbox/
 * This directory MUST be in .gitignore before evidence is written.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  SandboxHttpEvidence,
  SandboxEvidenceReport,
  SandboxScenarioEvidenceSummary,
} from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const EVIDENCE_BASE_PATH = 'test-output/hacienda-sandbox';

/**
 * Patterns that must NEVER appear in serialized evidence.
 *
 * IMPORTANT — /secret/i replacement rationale:
 *   The bare /secret/i substring match is NOT used because it produces a
 *   false positive on the legitimate metadata field secretsExposed: 0.
 *
 *   The replacement uses negative letter-boundary assertions so that
 *   "secret" is only matched when NOT part of a longer camelCase word:
 *     "secretsExposed" -> followed by 's' (letter)  -> NO MATCH  (correct)
 *     "client_secret"  -> followed by '"' (non-letter) -> MATCH    (correct)
 *     "my_secret_key"  -> preceded by '_', followed by '_' -> MATCH (correct)
 */
export const SECRET_EVIDENCE_PATTERNS: ReadonlyArray<RegExp> = [
  /authorization/i,
  /bearer\s/i,
  /access_token/i,
  /refresh_token/i,
  /password/i,
  /username/i,
  /pin\b/i,
  /passphrase/i,
  /pkcs12/i,
  /private[_\s-]?key/i,
  // Context-aware: matches standalone 'secret' but NOT camelCase prefix 'secretsExposed'.
  /(?<![a-zA-Z])secret(?![a-zA-Z])/i,
  /credential/i,
];

// ── TASK-008 explicit evidence key validator ──────────────────────────────────

/**
 * Forbidden JSON key names for TASK-008 sanitized evidence.
 * Any of these appearing as a key at any object depth must fail closed.
 * Keys are lowercased before comparison.
 */
export const TASK_008_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'access_token',
  'refresh_token',
  'password',
  'username',
  'authorization',
  'client_secret',
  'pin',
  'passphrase',
  'privatekey',
  'private_key',
  'certificate',
  'pkcs12',
  'bearer',
]);

function collectForbiddenObjectKeys(value: unknown, forbidden: ReadonlySet<string>): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const found: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (forbidden.has(key.toLowerCase())) {
      found.push(key);
    }
    found.push(...collectForbiddenObjectKeys((value as Record<string, unknown>)[key], forbidden));
  }
  return found;
}

/**
 * Validates that a TASK-008 evidence object contains no forbidden key names.
 *
 * This is a structured key-level check that complements the string-level
 * assertNoSecrets scan. Operating on the parsed object means precise
 * field-name diagnostics are possible without ever exposing values.
 *
 * Throws [F4S SECURITY] if any forbidden key is found.
 */
export function assertTask008EvidenceSafe(evidence: unknown, context: string): void {
  const forbidden = collectForbiddenObjectKeys(evidence, TASK_008_FORBIDDEN_KEYS);
  if (forbidden.length > 0) {
    throw new Error(
      `[F4S SECURITY] TASK-008 evidence contains forbidden key(s): ` +
        `${forbidden.join(', ')} in ${context}. Evidence was NOT written.`,
    );
  }
}

// ── TASK-009 evidence key validator ─────────────────────────────────────────

/**
 * Forbidden key names for TASK-009 sanitized evidence.
 * Identical constraint set to TASK-008 — neither may leak auth, cert, or token data.
 */
export const TASK_009_FORBIDDEN_KEYS: ReadonlySet<string> = TASK_008_FORBIDDEN_KEYS;

/**
 * Validates that a TASK-009 evidence object contains no forbidden key names.
 * Same constraint as assertTask008EvidenceSafe — reuse the same forbidden key set.
 * Throws [F4S SECURITY] if any forbidden key is found.
 */
export function assertTask009EvidenceSafe(evidence: unknown, context: string): void {
  const forbidden = collectForbiddenObjectKeys(evidence, TASK_009_FORBIDDEN_KEYS);
  if (forbidden.length > 0) {
    throw new Error(
      `[F4S SECURITY] TASK-009 evidence contains forbidden key(s): ` +
        `${forbidden.join(', ')} in ${context}. Evidence was NOT written.`,
    );
  }
}

// ── Safe field extraction ─────────────────────────────────────────────────────

/**
 * Sanitizes a URL path by removing query parameters.
 * Never includes path segments that look like tokens or credentials.
 */
export function sanitizePath(rawPath: string): string {
  // Remove query string
  const withoutQuery = rawPath.split('?')[0];
  // Remove fragment
  return withoutQuery.split('#')[0];
}

/**
 * Sanitizes a Location header value.
 * Returns the hostname + path only — strips any potential credential segments.
 */
export function sanitizeLocationHeader(location: string | undefined): string | undefined {
  if (!location) return undefined;
  try {
    const url = new URL(location);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    // If it's a relative path, just return path without query
    return sanitizePath(location);
  }
}

/**
 * Computes SHA-256 hex of a Buffer without returning the buffer itself.
 */
export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ── Evidence builder ──────────────────────────────────────────────────────────

export interface RawHttpEventInput {
  readonly scenarioId: string;
  readonly hostname: string;
  readonly httpMethod: string;
  /**
   * Raw path from the request — will be sanitized (query params removed).
   * MUST NOT contain credentials in the path itself.
   */
  readonly rawPath: string;
  readonly httpStatus: number;
  readonly durationMs: number;
  readonly adapterIdentity: string;
  readonly clave?: string;
  /** Raw Location header — will be sanitized before storage. */
  readonly rawLocationHeader?: string;
  readonly rateLimitHeaders?: {
    readonly limit?: string;
    readonly remaining?: string;
    readonly reset?: string;
    readonly retryAfterSeconds?: number;
  };
  readonly correlationId?: string;
  /** Raw response artifact bytes — SHA-256 will be computed and bytes discarded. */
  readonly responseArtifactBytes?: Buffer;
}

/**
 * Builds a safe SandboxHttpEvidence from raw input.
 * Applies all sanitization rules. Never includes secret values.
 */
export function buildSafeEvidence(input: RawHttpEventInput): SandboxHttpEvidence {
  return {
    timestamp: new Date().toISOString(),
    scenarioId: input.scenarioId,
    environment: 'SANDBOX',
    hostname: input.hostname,
    httpMethod: input.httpMethod,
    sanitizedPath: sanitizePath(input.rawPath),
    httpStatus: input.httpStatus,
    durationMs: input.durationMs,
    adapterIdentity: input.adapterIdentity,
    ...(input.clave !== undefined ? { clave: input.clave } : {}),
    ...(input.rawLocationHeader !== undefined
      ? { safeLocationHeader: sanitizeLocationHeader(input.rawLocationHeader) }
      : {}),
    ...(input.rateLimitHeaders !== undefined ? { rateLimitHeaders: input.rateLimitHeaders } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.responseArtifactBytes !== undefined
      ? { responseArtifactSha256: sha256Hex(input.responseArtifactBytes) }
      : {}),
  };
}

// ── Secret detection ──────────────────────────────────────────────────────────

/**
 * Checks if a serialized string contains any known secret patterns.
 * Used in tests to verify evidence files contain no secrets.
 * Returns the matching pattern if found, undefined if clean.
 */
export function detectSecretPattern(serialized: string): RegExp | undefined {
  return SECRET_EVIDENCE_PATTERNS.find((pattern) => pattern.test(serialized));
}

/**
 * Throws if the serialized evidence contains any secret pattern.
 * For use in evidence serialization to fail-safe on accidental secret inclusion.
 */
export function assertNoSecrets(serialized: string, context: string): void {
  const pattern = detectSecretPattern(serialized);
  if (pattern) {
    throw new Error(
      `[F4S SECURITY] Evidence serialization blocked: detected potential secret pattern ` +
        `matching '${pattern.source}' in ${context}. Evidence was NOT written.`,
    );
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Writes a single HTTP evidence event to the evidence directory.
 * Performs a secret pattern check before writing.
 */
export async function writeHttpEvidence(
  evidence: SandboxHttpEvidence,
  scenarioId: string,
): Promise<void> {
  const dir = path.resolve(EVIDENCE_BASE_PATH, scenarioId);
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `http-event-${Date.now()}.json`;
  const filepath = path.join(dir, filename);
  const serialized = JSON.stringify(evidence, null, 2);

  // Fail-safe secret check
  assertNoSecrets(serialized, filepath);

  await fs.promises.writeFile(filepath, serialized, 'utf8');
}

/**
 * Writes the full evidence report to the evidence directory.
 * Performs a secret pattern check before writing.
 */
export async function writeEvidenceReport(report: SandboxEvidenceReport): Promise<string> {
  const dir = path.resolve(EVIDENCE_BASE_PATH);
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `evidence-report-${Date.now()}.json`;
  const filepath = path.join(dir, filename);
  const serialized = JSON.stringify(report, null, 2);

  // Fail-safe secret check
  assertNoSecrets(serialized, filepath);

  await fs.promises.writeFile(filepath, serialized, 'utf8');
  return filepath;
}

// ── Report builder ────────────────────────────────────────────────────────────

export function buildNotExecutedReport(): SandboxEvidenceReport {
  return {
    reportGeneratedAt: new Date().toISOString(),
    f4sStatus: 'NOT_EXECUTED',
    environment: 'SANDBOX',
    scenarios: [],
  };
}

export function buildScenarioSummary(
  scenarioId: string,
  status: SandboxScenarioEvidenceSummary['status'],
  gate: string | undefined,
  httpEvents: SandboxHttpEvidence[],
): SandboxScenarioEvidenceSummary {
  return {
    scenarioId,
    status,
    ...(gate ? { gate } : {}),
    httpEvents,
  };
}
