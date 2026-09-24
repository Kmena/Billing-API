/**
 * Hacienda POST /recepcion HTTP status classification table.
 *
 * Official reference:
 *   https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html
 *
 * DOCUMENTED statuses in the published Hacienda POST /recepcion contract:
 *   201 — successful receipt (validation pending)
 *   400 — validation error (X-Error-Cause / validation-exception headers)
 *   401 — unauthorized
 *
 * ALL OTHER STATUS CODES ARE UNDOCUMENTED for POST /recepcion.
 *
 * CRITICAL: Do NOT invent Hacienda-specific semantics for undocumented codes.
 * HTTP 202 may generally mean "Accepted" in generic HTTP, but Hacienda has
 * NOT documented its meaning for POST /recepcion — do NOT label HTTP 202
 * as "document accepted" without authoritative proof.
 */

export type RecepcionStatusClassification =
  /** HTTP 201: in official Hacienda POST /recepcion contract. */
  | 'DOCUMENTED_SUCCESSFUL_RECEIPT'
  /** HTTP 400: in official Hacienda POST /recepcion contract. */
  | 'DOCUMENTED_VALIDATION_ERROR'
  /** HTTP 401: in official Hacienda POST /recepcion contract. */
  | 'DOCUMENTED_AUTH_ERROR'
  /** 2xx other than 201: NOT in Hacienda POST /recepcion contract. */
  | 'UNDOCUMENTED_2XX'
  /** 4xx other than 400/401: NOT in Hacienda POST /recepcion contract. */
  | 'UNDOCUMENTED_4XX'
  /** 429: standard rate-limit. */
  | 'RATE_LIMIT'
  /** 5xx: POST outcome ambiguous — reconcile via GET /recepcion/{clave}. */
  | 'AMBIGUOUS_SERVER_ERROR';

export interface RecepcionStatusInfo {
  /** Classification category. */
  readonly classification: RecepcionStatusClassification;
  /** Whether this status is explicitly in the Hacienda POST /recepcion contract. */
  readonly inContract: boolean;
  /** Human-readable meaning for diagnostics. */
  readonly meaning: string;
  /** Recommended Billing system action. */
  readonly billingAction: string;
}

// ── Lookup table ──────────────────────────────────────────────────────────────

const TABLE: Readonly<Record<number, RecepcionStatusInfo>> = {
  200: {
    classification: 'UNDOCUMENTED_2XX',
    inContract: false,
    meaning: 'HTTP OK — not documented for POST /recepcion',
    billingAction: 'UNRESOLVED_PROVIDER_RESPONSE',
  },
  201: {
    classification: 'DOCUMENTED_SUCCESSFUL_RECEIPT',
    inContract: true,
    meaning: 'Comprobante recibido; validación pendiente',
    billingAction: 'ACKNOWLEDGED',
  },
  202: {
    classification: 'UNDOCUMENTED_2XX',
    inContract: false,
    meaning: 'Not documented for POST /recepcion in the Hacienda API contract',
    billingAction: 'UNRESOLVED_PROVIDER_RESPONSE',
  },
  204: {
    classification: 'UNDOCUMENTED_2XX',
    inContract: false,
    meaning: 'No Content — not documented for POST /recepcion',
    billingAction: 'UNRESOLVED_PROVIDER_RESPONSE',
  },
  400: {
    classification: 'DOCUMENTED_VALIDATION_ERROR',
    inContract: true,
    meaning: 'Error de validación — X-Error-Cause / validation-exception contain the reason',
    billingAction: 'NON_RETRYABLE_FAILURE',
  },
  401: {
    classification: 'DOCUMENTED_AUTH_ERROR',
    inContract: true,
    meaning: 'No autorizado — access token rejected or expired',
    billingAction: 'RETRYABLE_FAILURE',
  },
  403: {
    classification: 'UNDOCUMENTED_4XX',
    inContract: false,
    meaning: 'Forbidden — not documented for POST /recepcion',
    billingAction: 'NON_RETRYABLE_FAILURE',
  },
  404: {
    classification: 'UNDOCUMENTED_4XX',
    inContract: false,
    meaning: 'Not Found — not documented for POST /recepcion',
    billingAction: 'NON_RETRYABLE_FAILURE',
  },
  409: {
    classification: 'UNDOCUMENTED_4XX',
    inContract: false,
    meaning: 'Conflict — not documented for POST /recepcion',
    billingAction: 'NON_RETRYABLE_FAILURE',
  },
  429: {
    classification: 'RATE_LIMIT',
    inContract: false,
    meaning: 'Rate limit exceeded',
    billingAction: 'RETRYABLE_FAILURE',
  },
  500: {
    classification: 'AMBIGUOUS_SERVER_ERROR',
    inContract: false,
    meaning: 'Internal Server Error — POST outcome ambiguous; reconcile via GET /recepcion/{clave}',
    billingAction: 'POST_OUTCOME_UNKNOWN',
  },
  502: {
    classification: 'AMBIGUOUS_SERVER_ERROR',
    inContract: false,
    meaning: 'Bad Gateway — POST outcome ambiguous',
    billingAction: 'POST_OUTCOME_UNKNOWN',
  },
  503: {
    classification: 'AMBIGUOUS_SERVER_ERROR',
    inContract: false,
    meaning: 'Service Unavailable — POST outcome ambiguous',
    billingAction: 'POST_OUTCOME_UNKNOWN',
  },
  504: {
    classification: 'AMBIGUOUS_SERVER_ERROR',
    inContract: false,
    meaning: 'Gateway Timeout — POST outcome ambiguous',
    billingAction: 'POST_OUTCOME_UNKNOWN',
  },
};

/**
 * Returns the classification entry for a given HTTP status.
 * Falls back to range-based classification for unlisted codes.
 */
export function classifyRecepcionStatus(status: number): RecepcionStatusInfo {
  const entry = TABLE[status];
  if (entry) return entry;

  if (status >= 200 && status < 300) {
    return {
      classification: 'UNDOCUMENTED_2XX',
      inContract: false,
      meaning: `HTTP ${status} — not documented for POST /recepcion`,
      billingAction: 'UNRESOLVED_PROVIDER_RESPONSE',
    };
  }
  if (status >= 400 && status < 500) {
    return {
      classification: 'UNDOCUMENTED_4XX',
      inContract: false,
      meaning: `HTTP ${status} — not documented for POST /recepcion`,
      billingAction: 'NON_RETRYABLE_FAILURE',
    };
  }
  if (status >= 500) {
    return {
      classification: 'AMBIGUOUS_SERVER_ERROR',
      inContract: false,
      meaning: `HTTP ${status} — POST outcome ambiguous`,
      billingAction: 'POST_OUTCOME_UNKNOWN',
    };
  }
  return {
    classification: 'UNDOCUMENTED_4XX',
    inContract: false,
    meaning: `HTTP ${status} — unexpected for POST /recepcion`,
    billingAction: 'NON_RETRYABLE_FAILURE',
  };
}
