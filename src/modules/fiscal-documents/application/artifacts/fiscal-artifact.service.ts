/**
 * FiscalArtifactService — F4 fiscal artifact listing and metadata.
 *
 * F4 — TASK-005
 * Lists artifact metadata for tenant/company-scoped fiscal documents.
 * Internal storage keys are NEVER exposed in API responses.
 * Provides signed artifact downloads after integrity verification.
 *
 * FR-017: Protected downloads — authenticated, tenant/company-scoped.
 * FR-020: SHA-256 integrity verified before streaming.
 * FR-027: Content-Disposition filenames follow official Hacienda convention.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  FiscalEvidenceResolverService,
  ArtifactNotFoundException,
} from './fiscal-evidence-resolver.service';
import { DomainException } from '../../../shared/domain/domain-exception';

export class FiscalArtifactAccessDeniedException extends DomainException {
  readonly code = 'FISCAL_ARTIFACT_ACCESS_DENIED';
  readonly httpStatus = 403;
  constructor() {
    super('Access to fiscal artifact denied — insufficient authorization.');
  }
}

export interface FiscalArtifactMetadata {
  readonly id: string;
  readonly fiscalDocumentId: string;
  readonly type: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly templateId: string | null;
  readonly rendererVersion: string | null;
  readonly createdAt: Date;
  /** External filename per Hacienda convention (FR-027). Never the internal storage key. */
  readonly externalFilename: string;
}

export interface ArtifactDownload {
  readonly bytes: Buffer;
  readonly contentType: string;
  /** External filename for Content-Disposition header (FR-027). */
  readonly externalFilename: string;
  readonly sizeBytes: number;
}

@Injectable()
export class FiscalArtifactService {
  private readonly logger = new Logger(FiscalArtifactService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly evidenceResolver: FiscalEvidenceResolverService,
  ) {}

  /**
   * List artifact metadata for a fiscal document.
   * Enforces tenant/company isolation. Never exposes internal storage keys.
   */
  async listArtifacts(
    tenantId: string,
    companyId: string,
    fiscalDocumentId: string,
  ): Promise<FiscalArtifactMetadata[]> {
    // Verify document ownership
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, tenantId, companyId },
    });
    if (!doc) {
      throw new ArtifactNotFoundException(fiscalDocumentId, 'document');
    }

    const artifacts = await this.prisma.fiscalArtifact.findMany({
      where: { tenantId, companyId, fiscalDocumentId, supersededAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return artifacts.map((a) => ({
      id: a.id,
      fiscalDocumentId: a.fiscalDocumentId,
      type: a.type,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      templateId: a.templateId,
      rendererVersion: a.rendererVersion,
      createdAt: a.createdAt,
      externalFilename: this.buildExternalFilename(doc.clave, a.type),
    }));
  }

  /**
   * Download artifact bytes after integrity verification.
   * Enforces tenant/company/artifact ownership isolation.
   * Returns external filename for Content-Disposition (FR-027).
   * Never exposes internal storage keys.
   */
  async downloadArtifact(
    tenantId: string,
    companyId: string,
    artifactId: string,
  ): Promise<ArtifactDownload> {
    const artifact = await this.prisma.fiscalArtifact.findFirst({
      where: { id: artifactId, tenantId, companyId, supersededAt: null },
      include: { fiscalDocument: { select: { clave: true } } },
    });

    if (!artifact) {
      throw new ArtifactNotFoundException(artifactId, 'artifact');
    }

    const bytes = await this.storage.download(artifact.storageKey);
    await this.evidenceResolver.verifyIntegrity(
      bytes,
      artifact.sha256,
      artifact.fiscalDocumentId,
      artifact.type,
    );

    const externalFilename = this.buildExternalFilename(
      artifact.fiscalDocument.clave,
      artifact.type,
    );

    this.logger.log({
      msg: 'Artifact download served',
      artifactId,
      type: artifact.type,
      sizeBytes: bytes.length,
      tenantId,
      companyId,
    });

    return {
      bytes,
      contentType: artifact.contentType,
      externalFilename,
      sizeBytes: bytes.length,
    };
  }

  /**
   * Build the official external filename for an artifact (FR-027).
   * NEVER returns the internal storage key.
   *
   * Convention:
   * - SIGNED_XML: {clave}.xml
   * - HACIENDA_RESPONSE_XML: {clave}_respuesta.xml
   * - PDF: {clave}.pdf
   */
  buildExternalFilename(clave: string, artifactType: string): string {
    switch (artifactType) {
      case 'SIGNED_XML':
        return `${clave}.xml`;
      case 'HACIENDA_RESPONSE_XML':
        return `${clave}_respuesta.xml`;
      case 'PDF':
        return `${clave}.pdf`;
      default:
        return `${clave}.bin`;
    }
  }

  /**
   * Build a safe Content-Disposition header value.
   * Prevents CRLF injection and path traversal.
   */
  buildContentDisposition(externalFilename: string): string {
    // Sanitize: remove CRLF injection, path separators, and path traversal sequences
    const safe = externalFilename
      .replace(/[\r\n\x00]/g, '') // CRLF/null injection
      .replace(/[\\/]/g, '_') // path separators
      .replace(/\.\./g, '_') // path traversal (..)
      .replace(/[^\w.\-_]/g, '_'); // any other unsafe chars
    return `attachment; filename="${safe}"`;
  }
}
