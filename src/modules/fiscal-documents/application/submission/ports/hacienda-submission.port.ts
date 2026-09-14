import type { FiscalDocumentType, HaciendaEnvironment } from '../../../domain/fiscal.constants';
import type { FiscalSubmissionStatus } from '../../../domain/submission';

export interface HaciendaPartyIdentification {
  readonly type: string;
  readonly number: string;
}

export interface HaciendaPartyPayload {
  readonly identification: HaciendaPartyIdentification;
}

export interface HaciendaSubmitSignedDocumentInput {
  readonly environment: HaciendaEnvironment;
  readonly accessToken: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly issueDate: Date;
  readonly documentType: FiscalDocumentType;
  readonly issuer: HaciendaPartyPayload;
  readonly receiver?: HaciendaPartyPayload;
  readonly signedXml: Buffer;
  readonly callbackUrl?: string;
  readonly consecutivoReceptor?: string;
}

export interface HaciendaQueryStatusInput {
  readonly environment: HaciendaEnvironment;
  readonly accessToken: string;
  readonly clave: string;
}

export interface HaciendaRateLimitMetadata {
  readonly limit?: string;
  readonly remaining?: string;
  readonly reset?: string;
  readonly retryAfterSeconds?: number;
}

export interface HaciendaSubmissionArtifact {
  readonly content: Buffer;
  readonly contentType: string;
}

export type HaciendaSubmissionResultKind =
  | 'ACKNOWLEDGED'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RETRYABLE_FAILURE'
  | 'AMBIGUOUS_FAILURE'
  | 'NON_RETRYABLE_FAILURE';

export interface HaciendaSubmissionResult {
  readonly kind: HaciendaSubmissionResultKind;
  readonly nextStatus: FiscalSubmissionStatus;
  readonly providerStatus?: string;
  readonly providerLocation?: string;
  readonly providerReference?: string;
  readonly httpStatus?: number;
  readonly normalizedErrorCode?: string;
  readonly sanitizedErrorMessage?: string;
  readonly responseArtifact?: HaciendaSubmissionArtifact;
  readonly rateLimit?: HaciendaRateLimitMetadata;
  readonly providerMetadata?: Record<string, string | number | boolean | null>;
}

export interface HaciendaSubmissionPort {
  submitSignedDocument(input: HaciendaSubmitSignedDocumentInput): Promise<HaciendaSubmissionResult>;
  queryStatusByClave(input: HaciendaQueryStatusInput): Promise<HaciendaSubmissionResult>;
}

export const HACIENDA_SUBMISSION_PORT = Symbol('HaciendaSubmissionPort');
