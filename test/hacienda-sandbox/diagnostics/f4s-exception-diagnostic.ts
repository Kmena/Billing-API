/**
 * F4-S Safe Exception Diagnostic Helper
 *
 * Extracts safe, structured diagnostic information from NestJS HttpException
 * instances thrown during the TASK-009 local pipeline.
 *
 * SAFETY RULES — these fields are NEVER included in the output:
 *   - Stack traces
 *   - Authorization headers / Bearer tokens
 *   - Passwords, PINs, passphrases
 *   - Certificate bytes, PKCS#12 material, private keys
 *   - XML payload content
 *   - DATABASE_URL or any connection string
 *   - Arbitrary getResponse() fields (allowlist only)
 *
 * The domainCode field is validated against /^[A-Z0-9_]{1,100}$/ so that
 * only safe, all-caps domain error codes can pass through.
 */

// ── Pipeline stage types ──────────────────────────────────────────────────────

/**
 * Explicit pipeline stage identifiers.
 * Used to classify where in the TASK-009 pipeline a failure occurred
 * WITHOUT relying on exception message string matching.
 */
export type PipelineStage =
  | 'DOCUMENT_CREATION'
  | 'XML_PREPARATION'
  | 'XSD_VALIDATION'
  | 'SIGNING'
  | 'ARTIFACT_LOOKUP'
  | 'SUBMISSION_CREATE';

// ── Diagnostic output type ────────────────────────────────────────────────────

/**
 * Sanitized details of the first XSD validation error.
 * Only populated when domainCode === 'FISCAL_XML_VALIDATION_FAILED'.
 *
 * All values have already passed through sanitizeXsdMessage():
 *   - XML tags stripped (replaced with [xml])
 *   - File paths stripped (replaced with [path])
 *   - Truncated to MAX_XSD_MESSAGE_LENGTH characters
 */
export interface XsdFirstError {
  /**
   * Line number reported by the XSD validator, or null when unavailable.
   * This is an integer line reference — never contains secrets.
   */
  readonly xsdLine: number | null;
  /**
   * Sanitized error message from the XSD validator.
   * XML content replaced with [xml], paths with [path], max 200 chars.
   */
  readonly xsdMessage: string;
}

/**
 * Safe diagnostic extracted from an HttpException.
 * Contains ONLY fields that are safe to log and persist as evidence.
 */
export interface HttpExceptionDiagnostic {
  /**
   * Exception class name, e.g. 'BadRequestException', 'NotFoundException'.
   * Validated: must match /^[A-Za-z][A-Za-z0-9]*$/.
   */
  readonly exceptionType: string;
  /** HTTP status code, e.g. 400, 404, 409. */
  readonly httpStatus: number;
  /**
   * Domain error code from exception.getResponse().code.
   * Validated: must match /^[A-Z0-9_]{1,100}$/.
   * Null when absent, non-string, or fails validation.
   *
   * Examples: 'COMPANY_FISCAL_PROFILE_INCOMPLETE', 'FISCAL_ISSUANCE_POINT_REQUIRED'
   */
  readonly domainCode: string | null;
  /**
   * First XSD validation error, only present when domainCode is FISCAL_XML_VALIDATION_FAILED.
   * Sanitized: no XML snippets, no file paths, max 200 chars per message.
   */
  readonly xsdFirstError?: XsdFirstError;
}

// ── Duck-type guard ───────────────────────────────────────────────────────────

/**
 * Duck-type guard for NestJS HttpException shape.
 * Does NOT require importing HttpException from @nestjs/common.
 * Matches any object with getStatus() and getResponse() methods.
 */
export function isHttpExceptionShape(
  err: unknown,
): err is { getStatus(): number; getResponse(): unknown } {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e['getStatus'] === 'function' && typeof e['getResponse'] === 'function';
}

// ── Validators ────────────────────────────────────────────────────────────────

/**
 * Validates a domain code candidate.
 * Domain codes in this system are all-caps identifiers:
 *   COMPANY_FISCAL_PROFILE_INCOMPLETE, FISCAL_ISSUANCE_POINT_REQUIRED, etc.
 *
 * Rejects anything that doesn't match to prevent accidental secret exposure
 * (e.g. a URL, base64 blob, or interpolated user data cannot pass this check).
 */
export function validateDomainCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/^[A-Z0-9_]{1,100}$/.test(raw)) return raw;
  return null;
}

/** Validates an exception class name — must be a plain CamelCase identifier. */
function validateExceptionType(raw: unknown): string {
  if (typeof raw !== 'string') return 'HttpException';
  if (/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(raw)) return raw;
  return 'HttpException';
}

// ── XSD message sanitizer ────────────────────────────────────────────────────

const MAX_XSD_MESSAGE_LENGTH = 200;

/**
 * Sanitizes a raw XSD validator error message for safe inclusion in evidence.
 *
 * Removes:
 *   - XML tags: <...> → [xml]
 *   - Windows paths: C:\... → [path]
 *   - Unix absolute paths: /foo/... → [path]
 *   - Truncates to MAX_XSD_MESSAGE_LENGTH characters
 *
 * The resulting string is safe to store in evidence JSON and won't trigger
 * assertNoSecrets for normal XSD validation messages.
 */
export function sanitizeXsdMessage(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '[xml]')        // strip XML element/attribute content
    .replace(/[A-Za-z]:\\[^\s]*/g, '[path]') // Windows paths
    .replace(/\/[^\s]+/g, '[path]')     // Unix absolute paths
    .trim()
    .slice(0, MAX_XSD_MESSAGE_LENGTH);
}

// ── Core extractor ────────────────────────────────────────────────────────────

/**
 * Extracts safe diagnostic information from an exception.
 *
 * Returns null for plain Error objects, strings, or any value that does not
 * have the NestJS HttpException shape (getStatus + getResponse methods).
 *
 * Fields read from getResponse():
 *   - code   (string, validated as domain code pattern — always)
 *   - errors (array, only when code === 'FISCAL_XML_VALIDATION_FAILED';
 *             only errors[0].message and errors[0].line are read;
 *             message is sanitized via sanitizeXsdMessage before use)
 *
 * The following getResponse() fields are EXPLICITLY IGNORED:
 *   - message   — may contain interpolated user/domain data
 *   - error     — redundant with exceptionType
 *   - statusCode — redundant with httpStatus
 *   - any other field
 */
export function extractHttpExceptionDiagnostic(err: unknown): HttpExceptionDiagnostic | null {
  if (!isHttpExceptionShape(err)) return null;

  // Extract HTTP status — reject if not a finite number
  let httpStatus: number;
  try {
    const raw = err.getStatus();
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    httpStatus = raw;
  } catch {
    return null;
  }

  // Extract domain code from response.code and optional XSD error details
  let domainCode: string | null = null;
  let xsdFirstError: XsdFirstError | undefined;
  try {
    const response = err.getResponse();
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      // Only read .code — validates to domain code pattern
      domainCode = validateDomainCode(resp['code']);

      // For XSD validation failures: extract the first sanitized error detail.
      // errors[0].message has already been sanitized by the Python validator and
      // the TypeScript adapter. We apply one more pass here for defence-in-depth.
      if (domainCode === 'FISCAL_XML_VALIDATION_FAILED') {
        const errors = resp['errors'];
        if (Array.isArray(errors) && errors.length > 0) {
          const first = errors[0] as Record<string, unknown>;
          const rawMessage = typeof first['message'] === 'string' ? first['message'] : null;
          const rawLine = typeof first['line'] === 'number' ? first['line'] : null;
          if (rawMessage !== null) {
            const xsdMessage = sanitizeXsdMessage(rawMessage);
            if (xsdMessage.length > 0) {
              xsdFirstError = { xsdLine: rawLine, xsdMessage };
            }
          }
        }
      }
    }
    // If response is a plain string: do NOT use it (may contain user/domain data)
  } catch {
    // getResponse() threw — no domain code available
  }

  // Extract exception class name
  const exceptionType = validateExceptionType(
    (err as { constructor?: { name?: unknown } }).constructor?.name,
  );

  return {
    exceptionType,
    httpStatus,
    domainCode,
    ...(xsdFirstError !== undefined ? { xsdFirstError } : {}),
  };
}
