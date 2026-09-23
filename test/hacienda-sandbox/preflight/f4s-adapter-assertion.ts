/**
 * F4-S Adapter Assertion — TASK-005
 *
 * Asserts that the runtime Hacienda adapters are the REAL adapters
 * (HaciendaOidcAuthAdapter and HaciendaRecepcionAdapter), not mock adapters.
 *
 * Rules:
 *   - MockHaciendaAuthAdapter → reject with MOCK_AUTH_ADAPTER_DETECTED
 *   - MockHaciendaSubmissionAdapter → reject with MOCK_SUBMISSION_ADAPTER_DETECTED
 *   - Real adapters → REAL_ADAPTERS_CONFIRMED
 *   - USE_REAL_HACIENDA ≠ 'true' → USE_REAL_HACIENDA_NOT_SET
 *
 * Normal CI uses mock adapters and never sets USE_REAL_HACIENDA=true,
 * so the live runner assertion never fires in normal CI.
 */

import type { AdapterAssertionResult } from '../types';

// Names of mock adapters — used for constructor name detection.
// These must match the actual class names in the repository.
const MOCK_AUTH_ADAPTER_NAMES = new Set(['MockHaciendaAuthAdapter']);
const MOCK_SUBMISSION_ADAPTER_NAMES = new Set(['MockHaciendaSubmissionAdapter']);

// Names of real adapters
const REAL_AUTH_ADAPTER_NAMES = new Set(['HaciendaOidcAuthAdapter']);
const REAL_SUBMISSION_ADAPTER_NAMES = new Set(['HaciendaRecepcionAdapter']);

/**
 * Checks USE_REAL_HACIENDA environment variable.
 * Returns false if it is not set to 'true'.
 */
export function isUseRealHaciendaEnabled(): boolean {
  return process.env['USE_REAL_HACIENDA'] === 'true';
}

/**
 * Returns the constructor name of any object, for adapter identity detection.
 * Falls back to 'unknown' if the constructor name cannot be determined.
 */
export function getAdapterIdentity(adapter: unknown): string {
  if (!adapter || typeof adapter !== 'object') return 'unknown';
  const ctor = Object.getPrototypeOf(adapter)?.constructor;
  return typeof ctor?.name === 'string' && ctor.name ? ctor.name : 'unknown';
}

/**
 * Asserts that the supplied adapter instances are the real Hacienda adapters.
 * Used by the F4-S live runner before any real HTTP call.
 *
 * @param authAdapter The injected HaciendaAuthPort implementation.
 * @param submissionAdapter The injected HaciendaSubmissionPort implementation.
 */
export function assertRealAdapters(
  authAdapter: unknown,
  submissionAdapter: unknown,
): AdapterAssertionResult {
  // Check USE_REAL_HACIENDA first
  if (!isUseRealHaciendaEnabled()) {
    return {
      status: 'USE_REAL_HACIENDA_NOT_SET',
      authAdapterIdentity: getAdapterIdentity(authAdapter),
      submissionAdapterIdentity: getAdapterIdentity(submissionAdapter),
      message:
        'USE_REAL_HACIENDA is not set to true. ' +
        'Real Hacienda requests require this flag to be explicitly enabled.',
    };
  }

  const authIdentity = getAdapterIdentity(authAdapter);
  const submissionIdentity = getAdapterIdentity(submissionAdapter);

  // Reject mock auth adapters
  if (MOCK_AUTH_ADAPTER_NAMES.has(authIdentity)) {
    return {
      status: 'MOCK_ADAPTER_DETECTED',
      authAdapterIdentity: authIdentity,
      submissionAdapterIdentity: submissionIdentity,
      message: `MockHaciendaAuthAdapter detected. Live F4-S requires HaciendaOidcAuthAdapter.`,
    };
  }

  // Reject mock submission adapters
  if (MOCK_SUBMISSION_ADAPTER_NAMES.has(submissionIdentity)) {
    return {
      status: 'MOCK_ADAPTER_DETECTED',
      authAdapterIdentity: authIdentity,
      submissionAdapterIdentity: submissionIdentity,
      message:
        'MockHaciendaSubmissionAdapter detected. Live F4-S requires HaciendaRecepcionAdapter.',
    };
  }

  // Verify real adapter identity
  if (!REAL_AUTH_ADAPTER_NAMES.has(authIdentity)) {
    return {
      status: 'ADAPTER_IDENTITY_UNKNOWN',
      authAdapterIdentity: authIdentity,
      submissionAdapterIdentity: submissionIdentity,
      message: `Auth adapter identity '${authIdentity}' is not a recognized real adapter.`,
    };
  }

  if (!REAL_SUBMISSION_ADAPTER_NAMES.has(submissionIdentity)) {
    return {
      status: 'ADAPTER_IDENTITY_UNKNOWN',
      authAdapterIdentity: authIdentity,
      submissionAdapterIdentity: submissionIdentity,
      message: `Submission adapter identity '${submissionIdentity}' is not a recognized real adapter.`,
    };
  }

  return {
    status: 'REAL_ADAPTERS_CONFIRMED',
    authAdapterIdentity: authIdentity,
    submissionAdapterIdentity: submissionIdentity,
    message: 'Both HaciendaOidcAuthAdapter and HaciendaRecepcionAdapter confirmed.',
  };
}

/**
 * Config-level adapter assertion for preflight (before adapter instances exist).
 * Checks env vars only — no actual adapter instances needed.
 */
export function assertAdapterConfigForPreflight(): AdapterAssertionResult {
  if (!isUseRealHaciendaEnabled()) {
    return {
      status: 'USE_REAL_HACIENDA_NOT_SET',
      authAdapterIdentity: 'not-instantiated',
      submissionAdapterIdentity: 'not-instantiated',
      message:
        'Preflight: USE_REAL_HACIENDA is not set to true. ' +
        'Set USE_REAL_HACIENDA=true to enable real adapter mode.',
    };
  }

  // In preflight mode, adapters are not yet instantiated.
  // We only verify the flag is set and rely on the live runner to check instances.
  return {
    status: 'REAL_ADAPTERS_CONFIRMED',
    authAdapterIdentity: 'pending-instantiation',
    submissionAdapterIdentity: 'pending-instantiation',
    message:
      'USE_REAL_HACIENDA=true confirmed. Adapter instance check deferred to live runner startup.',
  };
}
