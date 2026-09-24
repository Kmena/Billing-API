/**
 * F4-S Production Safety Guard — TASK-004
 *
 * Hard safety guard that prevents any real Hacienda HTTP request unless
 * the configured endpoints are exactly the approved sandbox allowlist.
 *
 * There is NO bypass flag, NO --force, NO ALLOW_UNSAFE escape hatch.
 *
 * Allowlist (after TASK-001 official research):
 *   Reception: https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1
 *              (PRIMARY_RUNTIME_CANDIDATE — OPERATOR_OBSERVED_CURRENT_HACIENDA_UI_CONFIGURATION)
 *   Token:     https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token
 *              (VERIFIED_CURRENT_OFFICIAL_CONTRACT)
 *   Client ID: api-stag
 *              (VERIFIED_CURRENT_OFFICIAL_CONTRACT)
 *
 * ALWAYS DENIED:
 *   - Any URL on hostname api.comprobanteselectronicos.go.cr (production AND old sandbox URL)
 *   - Production client ID: api-prod
 *   - Production realm path: /auth/realms/rut/
 *   - Any non-HTTPS URL
 *   - Any URL with userinfo (@user:pass syntax)
 *   - Any URL with an explicit non-default port
 *   - Any hostname not in the allowlist
 *   - Hostname suffix/subdomain attacks (e.g. api.comprobanteselectronicos.go.cr.attacker.com)
 */

import type { SafetyGuardResult } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** The ONLY allowed sandbox reception base URL for F4-S. */
export const F4S_ALLOWED_RECEPTION_URL =
  'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';

/** The ONLY allowed sandbox token endpoint for F4-S. */
export const F4S_ALLOWED_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';

/** The ONLY allowed sandbox client ID for F4-S. */
export const F4S_ALLOWED_CLIENT_ID = 'api-stag';

/** Production hostname — always denied, regardless of path. */
const PRODUCTION_RECEPTION_HOSTNAME = 'api.comprobanteselectronicos.go.cr';

/** Production client ID — always denied. */
const PRODUCTION_CLIENT_ID = 'api-prod';

/** Substring that identifies the production IDP realm — always denied. */
const PRODUCTION_REALM_PATH_SEGMENT = '/auth/realms/rut/';

// ── Core URL validation helper ────────────────────────────────────────────────

interface ParsedUrlCheck {
  readonly ok: boolean;
  readonly failCode?: string;
  readonly failMessage?: string;
  readonly parsed?: URL;
}

/**
 * Detects whether the raw URL string contains an explicit port specification,
 * including cases where the port is the scheme default (e.g. :443 for HTTPS).
 *
 * Background: Node.js URL parser normalises port 443 away for HTTPS, so
 * `new URL('https://host:443/path').port === ''` even though ':443' is explicit.
 * We must detect that case by inspecting the raw authority segment.
 *
 * Returns the explicit port string if found, or null if no explicit port.
 */
function detectExplicitPortInRawUrl(rawUrl: string, parsed: URL): string | null {
  // Non-default port: the URL parser keeps it in parsed.port
  if (parsed.port !== '') return parsed.port;

  // Default-port normalisation: check whether the original string carries an
  // explicit port that matches the scheme default (443 for https, 80 for http).
  const defaultPort =
    parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : null;
  if (defaultPort === null) return null;

  // Extract the authority (host + optional port) from the raw URL.
  // rawUrl format: scheme://[userinfo@]host[:port][/path]
  const afterScheme = rawUrl.slice(parsed.protocol.length + 2); // skip "https://"
  const slashIdx = afterScheme.indexOf('/');
  const authority = slashIdx >= 0 ? afterScheme.slice(0, slashIdx) : afterScheme;

  // Remove userinfo if present.
  const atIdx = authority.lastIndexOf('@');
  const hostWithPort = atIdx >= 0 ? authority.slice(atIdx + 1) : authority;

  // Non-IPv6 hostname: explicit default port appears as trailing ":defaultPort".
  if (!hostWithPort.startsWith('[') && hostWithPort.endsWith(`:${defaultPort}`)) {
    return defaultPort;
  }

  // IPv6 hostname: explicit default port appears as "]:<defaultPort>" suffix.
  if (hostWithPort.startsWith('[')) {
    const closeBracket = hostWithPort.indexOf(']');
    if (closeBracket >= 0 && hostWithPort.slice(closeBracket + 1) === `:${defaultPort}`) {
      return defaultPort;
    }
  }

  return null;
}

function parseAndBasicCheck(rawUrl: string): ParsedUrlCheck {
  // Reject empty/blank
  if (!rawUrl || !rawUrl.trim()) {
    return { ok: false, failCode: 'EMPTY_URL', failMessage: 'URL is empty or blank.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, failCode: 'INVALID_URL_FORMAT', failMessage: 'URL cannot be parsed.' };
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      failCode: 'INSECURE_PROTOCOL',
      failMessage: `Protocol must be https: — got ${parsed.protocol}`,
    };
  }

  // No userinfo (prevents https://user:pass@host tricks)
  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      failCode: 'USERINFO_IN_URL',
      failMessage: 'URL must not contain userinfo (user:pass@host).',
    };
  }

  // No explicit port — including explicit default ports (e.g. :443 for HTTPS).
  // Node.js URL normalises :443 away, so we inspect the raw authority string.
  const explicitPort = detectExplicitPortInRawUrl(rawUrl, parsed);
  if (explicitPort !== null) {
    return {
      ok: false,
      failCode: 'UNEXPECTED_PORT',
      failMessage: `URL must not specify an explicit port — got :${explicitPort}`,
    };
  }

  // Hostname must not be empty
  if (!parsed.hostname) {
    return { ok: false, failCode: 'MISSING_HOSTNAME', failMessage: 'URL has no hostname.' };
  }

  return { ok: true, parsed };
}

// ── Production hostname check ─────────────────────────────────────────────────

/**
 * Returns FAIL if the hostname is the production reception hostname.
 * This blocks both the production URL and the old sandbox URL since they
 * share the same hostname (api.comprobanteselectronicos.go.cr).
 */
function isProductionReceptionHostname(hostname: string): boolean {
  return hostname === PRODUCTION_RECEPTION_HOSTNAME;
}

/**
 * Detects hostname suffix attacks:
 * e.g. api.comprobanteselectronicos.go.cr.attacker.com
 * or api-sandbox.comprobanteselectronicos.go.cr.evil.com
 */
function isHostnameSuffixAttack(hostname: string, legitimateHostname: string): boolean {
  // The legitimate hostname must be the exact hostname, not a suffix of a longer one.
  // Attack pattern: hostname ends with .legitimateHostname or contains legitimateHostname as substring
  if (hostname === legitimateHostname) return false;
  return hostname.endsWith(`.${legitimateHostname}`) || hostname.includes(legitimateHostname);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface F4sEndpointConfig {
  readonly receptionBaseUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
}

/**
 * Validates the sandbox reception base URL.
 * ONLY https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1 is allowed.
 */
export function validateReceptionUrl(receptionBaseUrl: string): SafetyGuardResult {
  const check = parseAndBasicCheck(receptionBaseUrl);
  if (!check.ok) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: check.failCode!,
      message: check.failMessage!,
    };
  }

  const { parsed } = check;
  const hostname = parsed!.hostname;
  const pathname = parsed!.pathname.replace(/\/$/, ''); // normalize trailing slash

  // Block production hostname (covers both production URL and old sandbox URL)
  if (isProductionReceptionHostname(hostname)) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'PRODUCTION_HOST_DETECTED',
      message:
        `Hostname ${hostname} is the production reception host. ` +
        'This blocks both the production URL and the old published sandbox URL. ' +
        'F4-S requires api-sandbox.comprobanteselectronicos.go.cr.',
    };
  }

  // Block production realm in any URL position
  if (receptionBaseUrl.includes(PRODUCTION_REALM_PATH_SEGMENT)) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'PRODUCTION_REALM_DETECTED',
      message: 'URL contains the production IDP realm path segment.',
    };
  }

  // Detect suffix attacks against the production hostname
  if (isHostnameSuffixAttack(hostname, PRODUCTION_RECEPTION_HOSTNAME)) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'HOSTNAME_SUFFIX_ATTACK',
      message: `Hostname ${hostname} appears to spoof ${PRODUCTION_RECEPTION_HOSTNAME}.`,
    };
  }

  // Detect suffix attacks against the sandbox hostname
  const allowedSandboxHostname = 'api-sandbox.comprobanteselectronicos.go.cr';
  if (isHostnameSuffixAttack(hostname, allowedSandboxHostname)) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'HOSTNAME_SUFFIX_ATTACK',
      message: `Hostname ${hostname} appears to spoof ${allowedSandboxHostname}.`,
    };
  }

  // Must be exactly the allowed sandbox hostname
  if (hostname !== allowedSandboxHostname) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'UNKNOWN_RECEPTION_HOST',
      message: `Hostname ${hostname} is not in the F4-S sandbox allowlist.`,
    };
  }

  // Must be exactly /recepcion/v1
  if (pathname !== '/recepcion/v1') {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'INVALID_RECEPTION_PATH',
      message: `Reception path must be /recepcion/v1 — got ${pathname}`,
    };
  }

  return {
    status: 'PASS',
    code: 'RECEPTION_URL_APPROVED',
    message: `Reception URL is the approved F4-S sandbox endpoint (PRIMARY_RUNTIME_CANDIDATE).`,
  };
}

/**
 * Validates the sandbox token endpoint URL.
 * ONLY https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/... is allowed.
 */
export function validateTokenUrl(tokenUrl: string): SafetyGuardResult {
  const check = parseAndBasicCheck(tokenUrl);
  if (!check.ok) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: check.failCode!,
      message: check.failMessage!,
    };
  }

  const { parsed } = check;
  const hostname = parsed!.hostname;
  const pathname = parsed!.pathname;

  // Suffix attack check FIRST — gives a more informative error than UNKNOWN_TOKEN_HOST
  // for hostnames like idp.comprobanteselectronicos.go.cr.attacker.com
  if (isHostnameSuffixAttack(hostname, 'idp.comprobanteselectronicos.go.cr')) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'HOSTNAME_SUFFIX_ATTACK',
      message: `Hostname ${hostname} appears to spoof the Hacienda IDP.`,
    };
  }

  // Must be exactly the IDP hostname
  if (hostname !== 'idp.comprobanteselectronicos.go.cr') {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'UNKNOWN_TOKEN_HOST',
      message: `Token hostname ${hostname} is not the approved Hacienda IDP.`,
    };
  }

  // Must NOT contain production realm
  if (pathname.includes('/realms/rut/') || pathname.startsWith('/auth/realms/rut/')) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'PRODUCTION_REALM_IN_TOKEN_URL',
      message: 'Token URL contains the production realm (/realms/rut/). Use /realms/rut-stag/.',
    };
  }

  // Must contain sandbox realm
  if (!pathname.includes('/realms/rut-stag/')) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'MISSING_SANDBOX_REALM',
      message: 'Token URL must use the sandbox realm (/realms/rut-stag/).',
    };
  }

  // Must match allowlisted path exactly
  const allowedPath = '/auth/realms/rut-stag/protocol/openid-connect/token';
  if (pathname !== allowedPath) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'INVALID_TOKEN_PATH',
      message: `Token path must be ${allowedPath} — got ${pathname}`,
    };
  }

  return {
    status: 'PASS',
    code: 'TOKEN_URL_APPROVED',
    message:
      'Token URL is the approved F4-S sandbox endpoint (VERIFIED_CURRENT_OFFICIAL_CONTRACT).',
  };
}

/**
 * Validates the sandbox client ID.
 * ONLY 'api-stag' is allowed.
 */
export function validateClientId(clientId: string): SafetyGuardResult {
  if (!clientId || !clientId.trim()) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'MISSING_CLIENT_ID',
      message: 'Client ID is empty.',
    };
  }

  if (clientId === PRODUCTION_CLIENT_ID) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'PRODUCTION_CLIENT_ID_DETECTED',
      message: `Client ID 'api-prod' is the production client and is always denied for F4-S.`,
    };
  }

  if (clientId !== F4S_ALLOWED_CLIENT_ID) {
    return {
      status: 'FAIL_SECURITY_GUARD',
      code: 'UNKNOWN_CLIENT_ID',
      message: `Client ID '${clientId}' is not the approved F4-S sandbox client ('api-stag').`,
    };
  }

  return {
    status: 'PASS',
    code: 'CLIENT_ID_APPROVED',
    message:
      `Client ID 'api-stag' is the approved F4-S sandbox client` +
      ` (VERIFIED_CURRENT_OFFICIAL_CONTRACT).`,
  };
}

/**
 * Validates the full F4-S endpoint configuration in one call.
 * ALL three checks must PASS before any real Hacienda HTTP request is permitted.
 */
export function validateF4sEndpoints(config: F4sEndpointConfig): SafetyGuardResult[] {
  const results: SafetyGuardResult[] = [
    validateReceptionUrl(config.receptionBaseUrl),
    validateTokenUrl(config.tokenUrl),
    validateClientId(config.clientId),
  ];

  // Extra: mixed sandbox/production detection
  const receptionCheck = results[0];
  const tokenCheck = results[1];
  const clientCheck = results[2];

  if (
    receptionCheck.status === 'PASS' &&
    (tokenCheck.code === 'PRODUCTION_REALM_IN_TOKEN_URL' ||
      clientCheck.code === 'PRODUCTION_CLIENT_ID_DETECTED')
  ) {
    results.push({
      status: 'FAIL_SECURITY_GUARD',
      code: 'MIXED_SANDBOX_PRODUCTION_CONFIG',
      message: 'Sandbox reception URL is combined with a production token URL or client ID.',
    });
  }

  return results;
}

/**
 * Returns true if ALL guard results pass.
 * Use this as the gate before any Hacienda HTTP call.
 */
export function allGuardResultsPass(results: SafetyGuardResult[]): boolean {
  return results.every((r) => r.status === 'PASS');
}
