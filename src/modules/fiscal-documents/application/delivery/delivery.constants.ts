/** pg-boss job name for delivery worker. */
export const DELIVERY_JOB_NAME = 'fiscal-document-delivery';

/** Stable contract label for the immutable accepted fiscal package. */
export const ACCEPTED_FISCAL_PACKAGE_VERSION = 'accepted-fiscal-package-v1';

/** Default cooldown before a delivered accepted package may be requested again. */
export const DEFAULT_ACCEPTED_PACKAGE_RESEND_COOLDOWN_SECONDS = 900;

/** pg-boss job name for PDF generation worker. */
export const PDF_GENERATION_JOB_NAME = 'fiscal-pdf-generation';

/** Default maximum delivery retry count (~24h horizon at exponential backoff). */
export const DEFAULT_MAX_DELIVERY_RETRIES = 8;

/** Template ID for MVP PDF. */
export const BILLING_DEFAULT_V1_TEMPLATE_ID = 'BILLING_DEFAULT_V1';

/** Renderer version for MVP PDF. */
export const BILLING_DEFAULT_V1_RENDERER_VERSION = '2.0.0';
