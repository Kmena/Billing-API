/**
 * FiscalEvidenceResolverService — Resolves immutable signed XML and Hacienda response bytes.
 *
 * F4 — TASK-005
 * Resolves immutable artifact bytes from F2.3/F3 storage without byte duplication.
 * Verifies SHA-256 integrity before returning bytes.
 * Enforces tenant/company isolation on all operations.
 *
 * INVARIANT: Does NOT read mutable company/customer/product/CABYS/tax-rule data.
 * INVARIANT: SHA-256 verified before any byte is used for delivery or download.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import { DomainException } from '../../../shared/domain/domain-exception';

export class ArtifactNotFoundException extends DomainException {
  readonly code = 'ARTIFACT_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(documentId: string, artifactType: string) {
    super(`Artifact of type '${artifactType}' not found for fiscal document '${documentId}'.`);
  }
}

export class ArtifactIntegrityException extends DomainException {
  readonly code = 'ARTIFACT_INTEGRITY_FAILURE';
  readonly httpStatus = 422;
  constructor(documentId: string, artifactType: string) {
    super(
      `SHA-256 integrity verification failed for ${artifactType} artifact on document '${documentId}'. ` +
        'Delivery and download blocked. Operator investigation required.',
    );
  }
}

export interface FiscalEvidenceBytes {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly contentType: string;
  readonly storageKey: string;
}

@Injectable()
export class FiscalEvidenceResolverService {
  private readonly logger = new Logger(FiscalEvidenceResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * Resolve immutable signed XML bytes for a fiscal document.
   * Verifies SHA-256 before returning.
   * Enforces tenant/company isolation.
   */
  async resolveSignedXmlBytes(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
  ): Promise<FiscalEvidenceBytes> {
    const artifact = await this.prisma.fiscalXmlArtifact.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        signedXmlStorageKey: { not: null },
        signedXmlSha256: { not: null },
      },
    });

    if (!artifact?.signedXmlStorageKey || !artifact.signedXmlSha256) {
      throw new ArtifactNotFoundException(fiscalDocumentId, 'SIGNED_XML');
    }

    const bytes = await this.storage.download(artifact.signedXmlStorageKey);
    await this.verifyIntegrity(bytes, artifact.signedXmlSha256, fiscalDocumentId, 'SIGNED_XML');

    return {
      bytes,
      sha256: artifact.signedXmlSha256,
      contentType: 'application/xml',
      storageKey: artifact.signedXmlStorageKey,
    };
  }

  /**
   * Resolve immutable Hacienda response XML bytes for a fiscal document.
   * Verifies SHA-256 before returning.
   * Enforces tenant/company isolation.
   */
  async resolveHaciendaResponseBytes(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
  ): Promise<FiscalEvidenceBytes> {
    const submission = await this.prisma.fiscalSubmission.findFirst({
      where: {
        tenantId,
        companyId,
        fiscalDocumentId,
        responseStorageKey: { not: null },
        responseSha256: { not: null },
      },
    });

    if (!submission?.responseStorageKey || !submission.responseSha256) {
      throw new ArtifactNotFoundException(fiscalDocumentId, 'HACIENDA_RESPONSE_XML');
    }

    const bytes = await this.storage.download(submission.responseStorageKey);
    await this.verifyIntegrity(
      bytes,
      submission.responseSha256,
      fiscalDocumentId,
      'HACIENDA_RESPONSE_XML',
    );

    return {
      bytes,
      sha256: submission.responseSha256,
      contentType: submission.responseContentType ?? 'application/xml',
      storageKey: submission.responseStorageKey,
    };
  }

  /**
   * Verify SHA-256 integrity of artifact bytes.
   * Throws ArtifactIntegrityException on mismatch (does NOT silently serve corrupted evidence).
   */
  async verifyIntegrity(
    bytes: Buffer,
    expectedSha256: string,
    documentId: string,
    artifactType: string,
  ): Promise<void> {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedSha256) {
      this.logger.error({
        msg: 'Artifact SHA-256 integrity mismatch',
        documentId,
        artifactType,
        expectedLength: expectedSha256.length,
        actualLength: actual.length,
        // Do not log actual hash values or bytes
      });
      throw new ArtifactIntegrityException(documentId, artifactType);
    }
  }
}
