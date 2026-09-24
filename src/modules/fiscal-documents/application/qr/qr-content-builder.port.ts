/**
 * QrContentBuilderPort — F4 QR payload construction.
 *
 * HACIENDA REQUIREMENTS (VERIFIED CURRENT V4.4):
 * 1. Clave (50 digits) must be used for QR consultation — FE + TE XSD v4.4.
 * 2. QR must permit reading via compatible capture device — DGT-R-000-2024.
 *
 * QR PAYLOAD: BILLING ARCHITECTURAL DECISION (DEC-001, DEC-006)
 * Format: {HACIENDA_QR_URL_BASE}?Clave={clave}
 * URL base: operator-configured; no default hardcoded in production.
 *
 * Input validation: clave must match /^\d{50}$/; throws InvalidClaveError on violation.
 * Output: URL-based QR payload with Clave as sole parameter.
 * No secrets, tenantId, companyId, internal IDs, or presigned URLs in output.
 */

export interface QrContentBuilderPort {
  /**
   * Build QR-encoded content string from immutable fiscal Clave.
   *
   * @param clave - exactly 50 numeric digits (\d{50})
   * @returns URL string with Clave as sole query parameter
   * @throws InvalidClaveError if clave does not match \d{50}
   */
  buildQrContent(clave: string): string;
}

export const QR_CONTENT_BUILDER = Symbol('QrContentBuilderPort');
