/**
 * F4-S Hacienda Sandbox Validation — Shared Types
 *
 * IMPORTANT: No real secret values may appear in any of these types
 * or in any serialized instance of them.
 */

// ── Safety Guard ─────────────────────────────────────────────────────────────

export type SafetyGuardStatus = 'PASS' | 'FAIL_SECURITY_GUARD';

export interface SafetyGuardResult {
  readonly status: SafetyGuardStatus;
  /** Sanitized code — never contains secret values. */
  readonly code: string;
  /** Human-readable message — never contains secret values. */
  readonly message: string;
}

// ── Prerequisite Validation ───────────────────────────────────────────────────

export type PrerequisiteItemStatus = 'READY' | 'MISSING' | 'INVALID' | 'NOT_CONFIGURED';

export interface PrerequisiteItem {
  readonly name: string;
  readonly status: PrerequisiteItemStatus;
  /** Sanitized code — never contains the actual secret value. */
  readonly sanitizedCode?: string;
}

export type PreflightAggregateStatus =
  | 'READY_FOR_SANDBOX_EXECUTION'
  | 'BLOCKED_BY_MISSING_PREREQUISITES'
  | 'FAIL_CONFIGURATION'
  | 'FAIL_SECURITY_GUARD';

export interface PreflightReport {
  readonly aggregateStatus: PreflightAggregateStatus;
  readonly items: ReadonlyArray<PrerequisiteItem>;
  /** Safety guard results — separate from prerequisite items. */
  readonly safetyGuardResults: ReadonlyArray<SafetyGuardResult>;
  /** Adapter assertion result. */
  readonly adapterAssertionResult: AdapterAssertionResult;
  /** Timestamp — safe to log. */
  readonly timestamp: string;
  /** Hacienda HTTP requests made during preflight — MUST be 0. */
  readonly haciendaHttpRequestsMade: number;
}

// ── Adapter Assertion ─────────────────────────────────────────────────────────

export type AdapterAssertionStatus =
  | 'REAL_ADAPTERS_CONFIRMED'
  | 'MOCK_ADAPTER_DETECTED'
  | 'USE_REAL_HACIENDA_NOT_SET'
  | 'ADAPTER_IDENTITY_UNKNOWN';

export interface AdapterAssertionResult {
  readonly status: AdapterAssertionStatus;
  readonly authAdapterIdentity: string;
  readonly submissionAdapterIdentity: string;
  readonly message: string;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

/**
 * Safe fields that may appear in sandbox evidence.
 * NEVER include: Authorization, Bearer token, username, password, PIN,
 * PKCS#12 bytes, private key, SecretProvider values.
 */
export interface SandboxHttpEvidence {
  readonly timestamp: string;
  readonly scenarioId: string;
  /** Always 'SANDBOX' — confirms environment separation. */
  readonly environment: 'SANDBOX';
  /** Sanitized hostname only — no credentials, no query params. */
  readonly hostname: string;
  readonly httpMethod: string;
  /** Path sanitized — no query params containing credentials. */
  readonly sanitizedPath: string;
  readonly httpStatus: number;
  readonly durationMs: number;
  readonly adapterIdentity: string;
  readonly clave?: string;
  /** Sanitized Location header value — safe to log. */
  readonly safeLocationHeader?: string;
  /** Rate-limit headers — safe to log. */
  readonly rateLimitHeaders?: {
    readonly limit?: string;
    readonly remaining?: string;
    readonly reset?: string;
    readonly retryAfterSeconds?: number;
  };
  readonly correlationId?: string;
  /** SHA-256 of response artifact — never the artifact itself. */
  readonly responseArtifactSha256?: string;
}

export interface SandboxEvidenceReport {
  readonly reportGeneratedAt: string;
  readonly f4sStatus: 'NOT_EXECUTED' | 'IN_PROGRESS' | 'COMPLETE';
  readonly environment: 'SANDBOX';
  readonly scenarios: ReadonlyArray<SandboxScenarioEvidenceSummary>;
}

export interface SandboxScenarioEvidenceSummary {
  readonly scenarioId: string;
  readonly status: 'NOT_EXECUTED' | 'PASS' | 'FAIL' | 'BLOCKED' | 'EXTERNAL_LIMITATION';
  readonly gate?: string;
  readonly httpEvents: ReadonlyArray<SandboxHttpEvidence>;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface F4sRunnerConfig {
  /** Whether to run in preflight-only mode (no real Hacienda requests). */
  readonly preflightOnly: boolean;
}
