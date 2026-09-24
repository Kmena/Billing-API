/**
 * F4-S Prerequisite Validator — TASK-003
 *
 * Validates all F4-S prerequisites WITHOUT making any real Hacienda HTTP requests.
 *
 * SECURITY RULES:
 *   - Never log or return: username, password, PIN, certificate bytes, private key.
 *   - All results use sanitized status codes only.
 *   - Certificate validation uses node-forge but returns only sanitized status.
 *
 * Required environment variables for F4-S execution:
 *   USE_REAL_HACIENDA=true
 *   HACIENDA_RECEPCION_SANDBOX_BASE_URL=https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1
 *   HACIENDA_IDP_SANDBOX_URL=https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token
 *   HACIENDA_IDP_CLIENT_ID_SANDBOX=api-stag
 *   F4S_SANDBOX_USERNAME=<set at runtime — NEVER commit>
 *   F4S_SANDBOX_PASSWORD=<set at runtime — NEVER commit>
 *   F4S_SANDBOX_CERT_PATH=<path to .p12 in .secrets/ — NEVER commit>
 *   F4S_SANDBOX_CERT_PIN=<PIN — NEVER commit>
 *   F4S_COMPANY_ID=<UUID of the sandbox company>
 *   F4S_TENANT_ID=<UUID of the sandbox tenant>
 *   DATABASE_URL=<configured>
 *   STORAGE_TYPE=<configured>
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PrerequisiteItem, PreflightAggregateStatus } from '../types';
import {
  validateF4sEndpoints,
  F4S_ALLOWED_RECEPTION_URL,
  F4S_ALLOWED_TOKEN_URL,
  F4S_ALLOWED_CLIENT_ID,
} from '../guards/f4s-safety-guard';
import {
  loadAndValidatePkcs12,
  certificateLoadResultToPrerequisiteItem,
  type CertificateLoadResult,
} from './f4s-certificate-loader';

// ── Default evidence path ─────────────────────────────────────────────────────

const DEFAULT_EVIDENCE_PATH = 'test-output/hacienda-sandbox';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrerequisiteValidatorOptions {
  /**
   * Injectable certificate loader for testing.
   * Defaults to the real node-forge loader.
   * Tests inject a mock to avoid crypto operations.
   */
  readonly certificateLoader?: (
    certPath: string | undefined,
    pin: string | undefined,
  ) => Promise<CertificateLoadResult>;
}

export interface PrerequisiteValidationResult {
  readonly aggregateStatus: PreflightAggregateStatus;
  readonly items: PrerequisiteItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envItem(name: string, envKey: string, expectedValue?: string): PrerequisiteItem {
  const value = process.env[envKey];
  if (!value || !value.trim()) {
    return { name, status: 'MISSING', sanitizedCode: `ENV_${envKey}_NOT_SET` };
  }
  if (expectedValue !== undefined && value.trim() !== expectedValue) {
    return {
      name,
      status: 'INVALID',
      sanitizedCode: `ENV_${envKey}_WRONG_VALUE`,
    };
  }
  return { name, status: 'READY' };
}

function secretPresenceItem(name: string, envKey: string): PrerequisiteItem {
  // Only check presence — NEVER log the value.
  const value = process.env[envKey];
  if (!value || !value.trim()) {
    return { name, status: 'MISSING', sanitizedCode: `SECRET_${envKey}_NOT_SET` };
  }
  return { name, status: 'READY' };
}

async function evidencePathItem(evidencePath: string): Promise<PrerequisiteItem> {
  const absPath = path.resolve(evidencePath);
  try {
    await fs.promises.mkdir(absPath, { recursive: true });
    // Test writability with a temp file
    const testFile = path.join(absPath, '.f4s-write-test');
    await fs.promises.writeFile(testFile, '');
    await fs.promises.unlink(testFile);
    return { name: 'evidencePath', status: 'READY' };
  } catch {
    return {
      name: 'evidencePath',
      status: 'INVALID',
      sanitizedCode: 'EVIDENCE_PATH_NOT_WRITABLE',
    };
  }
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validates all F4-S prerequisites.
 * Makes ZERO real Hacienda HTTP requests.
 */
export async function validateF4sPrerequisites(
  options: PrerequisiteValidatorOptions = {},
): Promise<PrerequisiteValidationResult> {
  const loader = options.certificateLoader ?? loadAndValidatePkcs12;
  const items: PrerequisiteItem[] = [];

  // 1. USE_REAL_HACIENDA must be true
  items.push(envItem('useRealHacienda', 'USE_REAL_HACIENDA', 'true'));

  // 2. Sandbox reception URL must be the PRIMARY_RUNTIME_CANDIDATE
  items.push(
    envItem(
      'sandboxReceptionUrl',
      'HACIENDA_RECEPCION_SANDBOX_BASE_URL',
      F4S_ALLOWED_RECEPTION_URL,
    ),
  );

  // 3. Token URL must be verified sandbox value
  items.push(envItem('sandboxTokenUrl', 'HACIENDA_IDP_SANDBOX_URL', F4S_ALLOWED_TOKEN_URL));

  // 4. Client ID must be api-stag
  items.push(envItem('sandboxClientId', 'HACIENDA_IDP_CLIENT_ID_SANDBOX', F4S_ALLOWED_CLIENT_ID));

  // 5. Credentials — presence check ONLY
  items.push(secretPresenceItem('sandboxUsername', 'F4S_SANDBOX_USERNAME'));
  items.push(secretPresenceItem('sandboxPassword', 'F4S_SANDBOX_PASSWORD'));

  // 6. Certificate path presence
  const certPath = process.env['F4S_SANDBOX_CERT_PATH'];
  const certPin = process.env['F4S_SANDBOX_CERT_PIN'];

  // 7. Certificate validation (uses injected loader for testability)
  const certResult = await loader(certPath, certPin);
  items.push(certificateLoadResultToPrerequisiteItem(certResult, 'signingCertificate'));

  // 8. Issuer profile
  items.push(secretPresenceItem('companyId', 'F4S_COMPANY_ID'));
  items.push(secretPresenceItem('tenantId', 'F4S_TENANT_ID'));

  // 9. Database
  items.push(envItem('databaseUrl', 'DATABASE_URL'));

  // 10. Storage
  items.push(envItem('storageType', 'STORAGE_TYPE'));

  // 11. Evidence path writable
  const evidencePath = process.env['F4S_EVIDENCE_PATH'] ?? DEFAULT_EVIDENCE_PATH;
  items.push(await evidencePathItem(evidencePath));

  // 12. Safety guard alignment — only run guard when URLs are actually configured.
  // If the reception URL env var is missing, the guard cannot be run (nothing to validate).
  // In that case, the 'sandboxReceptionUrl' item is already MISSING and aggregate is BLOCKED.
  // FAIL_SECURITY_GUARD is only appropriate when the operator has set a DANGEROUS value.
  const receptionUrl = process.env['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] ?? '';
  const tokenUrl = process.env['HACIENDA_IDP_SANDBOX_URL'] ?? F4S_ALLOWED_TOKEN_URL;
  const clientId = process.env['HACIENDA_IDP_CLIENT_ID_SANDBOX'] ?? F4S_ALLOWED_CLIENT_ID;

  let guardFailed = false;

  if (receptionUrl.trim() !== '') {
    // Only validate the guard if a URL is actually configured — empty URL = MISSING, not DANGEROUS
    const guardResults = validateF4sEndpoints({
      receptionBaseUrl: receptionUrl,
      tokenUrl,
      clientId,
    });
    guardFailed = guardResults.some((r) => r.status === 'FAIL_SECURITY_GUARD');

    if (guardFailed) {
      items.push({
        name: 'safetyGuard',
        status: 'INVALID',
        sanitizedCode: 'SAFETY_GUARD_FAILED',
      });
    } else {
      items.push({ name: 'safetyGuard', status: 'READY' });
    }
  } else {
    // URL not yet configured — guard cannot run; sandboxReceptionUrl item is already MISSING
    items.push({ name: 'safetyGuard', status: 'NOT_CONFIGURED' });
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────

  const aggregateStatus = computeAggregateStatus(items, guardFailed);

  return { aggregateStatus, items };
}

function computeAggregateStatus(
  items: PrerequisiteItem[],
  guardFailed: boolean,
): PreflightAggregateStatus {
  // Safety guard failure is only applicable when a dangerous value was explicitly configured.
  // Missing values (MISSING / NOT_CONFIGURED) fall through to BLOCKED_BY_MISSING_PREREQUISITES.
  if (guardFailed) return 'FAIL_SECURITY_GUARD';

  const hasFail = items.some((i) => i.status === 'INVALID');
  // NOT_CONFIGURED means the URL is not set yet — treat as a blocking prerequisite, not a failure
  const hasMissing = items.some((i) => i.status === 'MISSING' || i.status === 'NOT_CONFIGURED');

  if (hasFail) return 'FAIL_CONFIGURATION';
  if (hasMissing) return 'BLOCKED_BY_MISSING_PREREQUISITES';

  const allReady = items.every((i) => i.status === 'READY');
  if (allReady) return 'READY_FOR_SANDBOX_EXECUTION';

  return 'BLOCKED_BY_MISSING_PREREQUISITES';
}
