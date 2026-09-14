export interface FiscalSubmissionResponse {
  readonly documentId: string;
  readonly submissionId: string;
  readonly clave: string;
  readonly environment: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly reconciliationAttemptCount: number;
  readonly nextAttemptAt?: Date | null;
  readonly acceptedAt?: Date | null;
  readonly rejectedAt?: Date | null;
  readonly lastNormalizedErrorCode?: string | null;
  readonly lastSanitizedErrorMessage?: string | null;
  readonly lastProviderStatus?: string | null;
  readonly responseSha256?: string | null;
  readonly responseContentType?: string | null;
  readonly responseReceivedAt?: Date | null;
}
