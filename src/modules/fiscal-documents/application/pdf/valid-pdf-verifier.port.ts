export const PDF_MAX_SIZE_BYTES_DEFAULT = 10 * 1024 * 1024;

export type PdfValidationFailureCode = 'PDF_INVALID' | 'PDF_OVERSIZED' | 'PDF_MOCK_DETECTED';

export interface ExpectedPdfIdentity {
  readonly documentType: 'INVOICE' | 'TICKET';
  readonly clave: string;
  readonly consecutive: string;
}

export interface PdfValidationLimits {
  readonly maxSizeBytes: number;
}

export interface VerifiedPdf {
  readonly pageCount: number;
  readonly sizeBytes: number;
  readonly normalizedText: string;
  readonly parser: 'pdfjs-dist';
}

export class PdfValidationError extends Error {
  constructor(
    readonly code: PdfValidationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfValidationError';
  }
}

export interface ValidPdfVerifier {
  verify(
    bytes: Buffer,
    expected: ExpectedPdfIdentity,
    limits?: PdfValidationLimits,
  ): Promise<VerifiedPdf>;
}

export const VALID_PDF_VERIFIER = Symbol('ValidPdfVerifier');
