export const SUBMIT_FISCAL_DOCUMENT_JOB = 'fiscal-documents.submit-to-hacienda';
export const RECONCILE_FISCAL_SUBMISSION_JOB = 'fiscal-documents.reconcile-hacienda-status';

export interface FiscalSubmissionJobPayload {
  readonly submissionId: string;
}
