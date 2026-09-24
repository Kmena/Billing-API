/** pg-boss job name for delivery worker. */
export const DELIVERY_JOB_NAME = 'fiscal-document-delivery';

/** pg-boss job name for PDF generation worker. */
export const PDF_GENERATION_JOB_NAME = 'fiscal-pdf-generation';

/** Default maximum delivery retry count (~24h horizon at exponential backoff). */
export const DEFAULT_MAX_DELIVERY_RETRIES = 8;

/** Template ID for MVP PDF. */
export const BILLING_DEFAULT_V1_TEMPLATE_ID = 'BILLING_DEFAULT_V1';

/** Renderer version for MVP PDF. */
export const BILLING_DEFAULT_V1_RENDERER_VERSION = '1.0.0';
