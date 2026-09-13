import { FiscalDocumentType, HaciendaEnvironment } from '../fiscal.constants';

export interface FiscalXmlDocumentSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly type: FiscalDocumentType;
  readonly status: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly issueDate: Date;
  readonly issuerSnapshot: Record<string, unknown>;
  readonly receiverSnapshot?: Record<string, unknown> | null;
  readonly currency: string;
  readonly exchangeRate?: { toString(): string } | string | null;
  readonly saleCondition: string;
  readonly paymentMethod: string;
  readonly lines: unknown;
  readonly totals: unknown;
}

export interface FiscalXmlGenerationResult {
  readonly documentType: FiscalDocumentType;
  readonly rootElement: 'FacturaElectronica' | 'TiqueteElectronico';
  readonly namespace: string;
  readonly schemaVersion: string;
  readonly xml: string;
}

export interface FiscalXmlValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface FiscalXmlValidationResult {
  readonly isValid: boolean;
  readonly schemaVersion: string;
  readonly errors: FiscalXmlValidationIssue[];
}

export interface FiscalSigningCertificateSecret {
  readonly pkcs12Base64?: string;
  readonly privateKeyPem?: string;
  readonly certificatePem?: string;
  readonly passphrase?: string;
}

export interface FiscalSigningCertificateContext {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly certificateType: string;
  readonly fingerprintSha256?: string | null;
  readonly serialNumber?: string | null;
  readonly subjectName?: string | null;
  readonly issuerName?: string | null;
  readonly validFrom?: Date | null;
  readonly validTo?: Date | null;
  readonly secret: FiscalSigningCertificateSecret;
}

export interface FiscalXmlProcessingResult {
  readonly fiscalDocumentId: string;
  readonly status: string;
  readonly artifactId: string;
  readonly schemaVersion: string;
  readonly unsignedXmlSha256?: string | null;
  readonly signedXmlSha256?: string | null;
  readonly signedAt?: Date | null;
  readonly signatureVerifiedAt?: Date | null;
  readonly certificateId?: string | null;
}
