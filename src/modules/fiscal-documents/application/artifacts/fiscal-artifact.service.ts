import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  FiscalEvidenceResolverService,
  ArtifactIntegrityException,
  ArtifactNotFoundException,
} from './fiscal-evidence-resolver.service';
import { DomainException } from '../../../shared/domain/domain-exception';
import {
  FiscalPdfArtifactPolicyException,
  FiscalPdfArtifactStateService,
  FiscalPdfArtifactState,
} from './fiscal-pdf-artifact-state.service';
import { VALID_PDF_VERIFIER, ValidPdfVerifier } from '../pdf/valid-pdf-verifier.port';

type RequestedDocumentType = 'INVOICE' | 'TICKET';
type RequestedEnvironment = 'PRODUCTION' | 'SANDBOX';

export class FiscalArtifactAccessDeniedException extends DomainException {
  readonly code = 'FISCAL_ARTIFACT_ACCESS_DENIED';
  readonly httpStatus = 403;
  constructor() {
    super('Access to fiscal artifact denied.');
  }
}

export class FiscalArtifactPolicyDeniedException extends DomainException {
  readonly httpStatus: number;
  constructor(
    readonly code: string,
    state: FiscalPdfArtifactState,
  ) {
    super(`Fiscal PDF artifact is unavailable for this operation: ${state}.`);
    this.httpStatus =
      code === 'ARTIFACT_MISSING'
        ? 404
        : code === 'PDF_OVERSIZED'
          ? 413
          : code === 'PDF_INVALID_STRUCTURE' || code === 'ARTIFACT_HASH_MISMATCH'
            ? 422
            : 409;
  }
}

export interface ArtifactAccessContext {
  readonly tenantId: string;
  readonly companyId: string;
  readonly apiKeyId: string;
  readonly scopes: readonly string[];
}

export interface ArtifactDocumentContext {
  readonly fiscalDocumentId: string;
  readonly environment: RequestedEnvironment;
  readonly documentType: RequestedDocumentType;
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
  readonly externalFilename: string;
  readonly artifactState?: FiscalPdfArtifactState;
  readonly legacyInvalid?: boolean;
}

export interface ArtifactDownload {
  readonly bytes: Buffer;
  readonly contentType: string;
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
    @Inject(VALID_PDF_VERIFIER) private readonly pdfVerifier: ValidPdfVerifier,
    private readonly artifactState?: FiscalPdfArtifactStateService,
  ) {}

  async listArtifacts(
    access: ArtifactAccessContext,
    request: ArtifactDocumentContext,
  ): Promise<FiscalArtifactMetadata[]> {
    await this.assertCompanyAccess(access, request.documentType);
    const document = await this.resolveDocument(access, request);
    const artifacts = await this.prisma.fiscalArtifact.findMany({
      where: {
        tenantId: access.tenantId,
        companyId: access.companyId,
        fiscalDocumentId: request.fiscalDocumentId,
        supersededAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      artifacts.map(async (artifact) => {
        this.assertArtifactMetadata(artifact);
        const assessment =
          artifact.type === 'PDF'
            ? await this.requireArtifactState().assess(artifact, {
                documentType: document.type,
                clave: document.clave,
                consecutive: document.consecutive,
              })
            : undefined;
        return {
          id: artifact.id,
          fiscalDocumentId: artifact.fiscalDocumentId,
          type: artifact.type,
          contentType: artifact.contentType,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          templateId: artifact.templateId,
          rendererVersion: artifact.rendererVersion,
          createdAt: artifact.createdAt,
          externalFilename: this.buildExternalFilename(document.clave, artifact.type),
          ...(assessment ? { artifactState: assessment.state } : {}),
          ...(assessment?.state === 'HISTORICAL_MOCK' ? { legacyInvalid: true } : {}),
        };
      }),
    );
  }

  async downloadArtifact(
    access: ArtifactAccessContext,
    request: ArtifactDocumentContext & Readonly<{ artifactId: string }>,
  ): Promise<ArtifactDownload> {
    await this.assertCompanyAccess(access, request.documentType);
    const document = await this.resolveDocument(access, request);
    const artifact = await this.prisma.fiscalArtifact.findFirst({
      where: {
        id: request.artifactId,
        tenantId: access.tenantId,
        companyId: access.companyId,
        fiscalDocumentId: request.fiscalDocumentId,
        supersededAt: null,
      },
    });
    if (!artifact) throw new ArtifactNotFoundException(request.artifactId, 'artifact');
    this.assertArtifactMetadata(artifact);

    let bytes: Buffer;
    if (artifact.type === 'PDF') {
      try {
        bytes = this.requireArtifactState().requireDownloadable(
          await this.requireArtifactState().assess(artifact, {
            documentType: document.type,
            clave: document.clave,
            consecutive: document.consecutive,
          }),
        );
      } catch (error: unknown) {
        if (error instanceof FiscalPdfArtifactPolicyException) {
          throw new FiscalArtifactPolicyDeniedException(error.code, error.state);
        }
        throw error;
      }
    } else {
      bytes = await this.storage.download(artifact.storageKey);
      await this.evidenceResolver.verifyIntegrity(
        bytes,
        artifact.sha256,
        artifact.fiscalDocumentId,
        artifact.type,
      );
      if (bytes.length !== artifact.sizeBytes) {
        throw new ArtifactIntegrityException(artifact.fiscalDocumentId, artifact.type);
      }
    }

    const externalFilename = this.buildExternalFilename(document.clave, artifact.type);
    this.logger.log({
      msg: 'Artifact download served',
      artifactId: artifact.id,
      type: artifact.type,
      sizeBytes: bytes.length,
      tenantId: access.tenantId,
      companyId: access.companyId,
    });
    return {
      bytes,
      contentType: artifact.contentType,
      externalFilename,
      sizeBytes: bytes.length,
    };
  }

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

  buildContentDisposition(externalFilename: string): string {
    const safe = externalFilename
      .replace(/[\r\n\x00]/g, '')
      .replace(/[\\/]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/[^\w.\-_]/g, '_');
    return `attachment; filename="${safe}"`;
  }

  private async assertCompanyAccess(
    access: ArtifactAccessContext,
    documentType: RequestedDocumentType,
  ): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: access.companyId, tenantId: access.tenantId },
      select: { id: true },
    });
    if (!company) throw new ArtifactNotFoundException(access.companyId, 'company');

    const binding = await this.prisma.apiKeyCompany.findUnique({
      where: {
        apiKeyId_companyId: {
          apiKeyId: access.apiKeyId,
          companyId: access.companyId,
        },
      },
    });
    if (!binding) throw new FiscalArtifactAccessDeniedException();

    const requiredScope = documentType === 'INVOICE' ? 'invoices:read' : 'tickets:read';
    if (!access.scopes.includes(requiredScope)) throw new FiscalArtifactAccessDeniedException();
  }

  private async resolveDocument(
    access: ArtifactAccessContext,
    request: ArtifactDocumentContext,
  ): Promise<{ clave: string; consecutive: string; type: RequestedDocumentType }> {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: request.fiscalDocumentId,
        tenantId: access.tenantId,
        companyId: access.companyId,
        environment: request.environment,
        type: request.documentType,
      },
      select: { clave: true, consecutive: true, type: true },
    });
    if (!document) throw new ArtifactNotFoundException(request.fiscalDocumentId, 'document');
    return document as { clave: string; consecutive: string; type: RequestedDocumentType };
  }

  private assertArtifactMetadata(artifact: {
    type: string;
    contentType: string;
    templateId: string | null;
    rendererVersion: string | null;
  }): void {
    if (artifact.type === 'PDF') {
      if (
        artifact.contentType !== 'application/pdf' ||
        !artifact.templateId ||
        !artifact.rendererVersion
      ) {
        throw new ArtifactNotFoundException('', 'artifact');
      }
      return;
    }
    if (
      (artifact.type !== 'SIGNED_XML' && artifact.type !== 'HACIENDA_RESPONSE_XML') ||
      !['application/xml', 'text/xml'].includes(artifact.contentType) ||
      artifact.templateId !== null ||
      artifact.rendererVersion !== null
    ) {
      throw new ArtifactNotFoundException('', 'artifact');
    }
  }

  private requireArtifactState(): FiscalPdfArtifactStateService {
    return this.artifactState ?? new FiscalPdfArtifactStateService(this.storage, this.pdfVerifier);
  }
}
