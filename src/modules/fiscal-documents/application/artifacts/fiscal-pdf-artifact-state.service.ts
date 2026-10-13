import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  CURRENT_FISCAL_PDF_TEMPLATE_ID,
  HISTORICAL_MOCK_PDF_MARKER,
  classifyFiscalPdfVersion,
} from '../pdf/fiscal-pdf-version-policy';
import {
  ExpectedPdfIdentity,
  PDF_MAX_SIZE_BYTES_DEFAULT,
  PdfValidationError,
  VALID_PDF_VERIFIER,
  ValidPdfVerifier,
} from '../pdf/valid-pdf-verifier.port';

export type FiscalPdfArtifactState =
  | 'VALID_REAL_CURRENT'
  | 'VALID_REAL_OLDER_VERSION'
  | 'HISTORICAL_MOCK'
  | 'MISSING'
  | 'CORRUPT'
  | 'WRONG_VERSION'
  | 'HASH_MISMATCH';

export interface PersistedPdfArtifact {
  readonly id: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly templateId: string | null;
  readonly rendererVersion: string | null;
}

export interface FiscalPdfArtifactAssessment {
  readonly state: FiscalPdfArtifactState;
  readonly artifact: PersistedPdfArtifact | null;
  readonly bytes?: Buffer;
  readonly failureCode?: string;
}

export class FiscalPdfArtifactPolicyException extends Error {
  constructor(
    readonly state: Exclude<FiscalPdfArtifactState, 'VALID_REAL_CURRENT'>,
    readonly code:
      | 'LEGACY_PDF_UNAVAILABLE'
      | 'ARTIFACT_MISSING'
      | 'PDF_INVALID_STRUCTURE'
      | 'PDF_OVERSIZED'
      | 'ARTIFACT_WRONG_VERSION'
      | 'ARTIFACT_HASH_MISMATCH',
  ) {
    super(`Fiscal PDF artifact policy denied state ${state}.`);
    this.name = 'FiscalPdfArtifactPolicyException';
  }
}

@Injectable()
export class FiscalPdfArtifactStateService {
  private readonly logger = new Logger(FiscalPdfArtifactStateService.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(VALID_PDF_VERIFIER) private readonly verifier: ValidPdfVerifier,
  ) {}

  async assess(
    artifact: PersistedPdfArtifact | null | undefined,
    expected: ExpectedPdfIdentity,
  ): Promise<FiscalPdfArtifactAssessment> {
    if (!artifact) return { state: 'MISSING', artifact: null, failureCode: 'ARTIFACT_MISSING' };

    let bytes: Buffer;
    try {
      bytes = await this.storage.download(artifact.storageKey);
    } catch {
      this.log('missing', artifact);
      return { state: 'MISSING', artifact, failureCode: 'ARTIFACT_MISSING' };
    }

    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== artifact.sha256 || bytes.length !== artifact.sizeBytes) {
      this.log('hash-mismatch', artifact);
      return { state: 'HASH_MISMATCH', artifact, failureCode: 'ARTIFACT_HASH_MISMATCH' };
    }

    const containsMockMarker = bytes.includes(Buffer.from(HISTORICAL_MOCK_PDF_MARKER, 'utf8'));
    if (
      artifact.templateId === CURRENT_FISCAL_PDF_TEMPLATE_ID &&
      artifact.rendererVersion === '1.0.0' &&
      containsMockMarker
    ) {
      this.log('historical-mock', artifact);
      return { state: 'HISTORICAL_MOCK', artifact, failureCode: 'PDF_MOCK_DETECTED' };
    }

    try {
      await this.verifier.verify(bytes, expected, { maxSizeBytes: PDF_MAX_SIZE_BYTES_DEFAULT });
    } catch (error: unknown) {
      const failureCode = error instanceof PdfValidationError ? error.code : 'PDF_INVALID';
      this.log('corrupt', artifact, failureCode);
      return { state: 'CORRUPT', artifact, failureCode };
    }

    const state = classifyFiscalPdfVersion({
      templateId: artifact.templateId,
      rendererVersion: artifact.rendererVersion,
      structurallyValid: true,
      containsMockMarker,
    });
    if (state === 'WRONG_VERSION') this.log('wrong-version', artifact);
    return { state, artifact, bytes };
  }

  requireCurrent(assessment: FiscalPdfArtifactAssessment): Buffer {
    if (assessment.state === 'VALID_REAL_CURRENT' && assessment.bytes) return assessment.bytes;
    throw this.toPolicyException(assessment);
  }

  requireDownloadable(assessment: FiscalPdfArtifactAssessment): Buffer {
    if (
      (assessment.state === 'VALID_REAL_CURRENT' ||
        assessment.state === 'VALID_REAL_OLDER_VERSION') &&
      assessment.bytes
    ) {
      return assessment.bytes;
    }
    throw this.toPolicyException(assessment);
  }

  private toPolicyException(
    assessment: FiscalPdfArtifactAssessment,
  ): FiscalPdfArtifactPolicyException {
    switch (assessment.state) {
      case 'HISTORICAL_MOCK':
        return new FiscalPdfArtifactPolicyException(assessment.state, 'LEGACY_PDF_UNAVAILABLE');
      case 'MISSING':
        return new FiscalPdfArtifactPolicyException(assessment.state, 'ARTIFACT_MISSING');
      case 'HASH_MISMATCH':
        return new FiscalPdfArtifactPolicyException(assessment.state, 'ARTIFACT_HASH_MISMATCH');
      case 'CORRUPT':
        return new FiscalPdfArtifactPolicyException(
          assessment.state,
          assessment.failureCode === 'PDF_OVERSIZED' ? 'PDF_OVERSIZED' : 'PDF_INVALID_STRUCTURE',
        );
      case 'WRONG_VERSION':
      case 'VALID_REAL_OLDER_VERSION':
        return new FiscalPdfArtifactPolicyException(assessment.state, 'ARTIFACT_WRONG_VERSION');
      default:
        throw new Error(`Unhandled PDF artifact state ${assessment.state}.`);
    }
  }

  private log(event: string, artifact: PersistedPdfArtifact, failureCode?: string): void {
    this.logger.warn({
      msg: 'Fiscal PDF artifact state detected',
      event,
      artifactId: artifact.id,
      templateId: artifact.templateId,
      rendererVersion: artifact.rendererVersion,
      failureCode,
    });
  }
}
