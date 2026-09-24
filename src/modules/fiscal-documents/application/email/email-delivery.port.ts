/**
 * EmailDeliveryPort — Vendor-independent email delivery abstraction.
 *
 * Application/domain code depends only on this port.
 * No vendor SDK or SMTP implementation may leak beyond the adapter boundary.
 * No credentials may appear in the port payload.
 * Email attachment bytes are loaded server-side from verified artifact references.
 *
 * Official filename convention (FR-027):
 * Attachment filenames must follow the Hacienda Anexos v4.4 convention:
 * - Signed XML: {clave}.xml
 * - Hacienda response XML: {clave}_respuesta.xml
 * - PDF: {clave}.pdf
 */

export interface EmailAttachment {
  /** External filename — must follow official Hacienda convention (FR-027). */
  readonly filename: string;
  /** Verified artifact bytes (SHA-256 verified before attachment). */
  readonly content: Buffer;
  /** MIME type of the attachment. */
  readonly contentType: string;
}

export interface SendEmailCommand {
  /** Recipient email address. Validated and sanitized before send. */
  readonly to: string;
  /** Email subject. */
  readonly subject: string;
  /** Plain text body. */
  readonly text: string;
  /** Optional HTML body. Must not contain arbitrary tenant HTML. */
  readonly html?: string;
  /** Attachments with verified content and official filenames. */
  readonly attachments: ReadonlyArray<EmailAttachment>;
}

export type EmailDeliveryOutcome =
  'DELIVERED' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE' | 'RATE_LIMITED' | 'UNKNOWN';

export interface SendEmailResult {
  readonly outcome: EmailDeliveryOutcome;
  /**
   * Provider-assigned message ID if available.
   * Must be sanitized before persistence — must not contain credentials or sensitive data.
   */
  readonly providerMessageId?: string;
  /**
   * Sanitized error code for persistence and audit.
   * Never the raw provider error or stack trace.
   */
  readonly sanitizedErrorCode?: string;
  /**
   * Sanitized error message for operator diagnosis.
   * Never raw credentials or internal stack traces.
   */
  readonly sanitizedErrorMessage?: string;
  /** Retry-After hint in seconds (for rate limiting). */
  readonly retryAfterSeconds?: number;
}

export interface EmailDeliveryPort {
  /**
   * Send an email with attachments.
   *
   * @param command - Sanitized email command with verified artifact bytes.
   * @returns Normalized provider result.
   *
   * Implementations must:
   * - Never log credentials, tokens, or attachment bytes.
   * - Sanitize provider error information before returning.
   * - Handle network errors as TRANSIENT_FAILURE.
   * - Handle hard bounces as PERMANENT_FAILURE.
   * - Return UNKNOWN for unrecognized responses (do not mark as DELIVERED without confirmation).
   */
  sendEmail(command: SendEmailCommand): Promise<SendEmailResult>;
}

export const EMAIL_DELIVERY_PORT = Symbol('EmailDeliveryPort');
