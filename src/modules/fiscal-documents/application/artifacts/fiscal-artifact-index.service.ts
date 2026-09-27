import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  ArtifactIntegrityException,
  ArtifactNotFoundException,
} from './fiscal-evidence-resolver.service';

interface IndexedArtifactResult {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly wasCreated: boolean;
}

interface ArtifactIndexInput {
  readonly tenantId: string;
  readonly companyId: string;
  readonly fiscalDocumentId: string;
}

@Injectable()
export class FiscalArtifactIndexService {
  private readonly logger = new Logger(FiscalArtifactIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async ensureSignedXmlArtifact(input: ArtifactIndexInput): Promise<IndexedArtifactResult> {
    const existing = await this.findExisting(input, 'SIGNED_XML');
    if (existing) return { ...existing, wasCreated: false };

    const source = await this.prisma.fiscalXmlArtifact.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalDocumentId: input.fiscalDocumentId,
        signedXmlStorageKey: { not: null },
        signedXmlSha256: { not: null },
      },
    });

    if (!source?.signedXmlStorageKey || !source.signedXmlSha256) {
      throw new ArtifactNotFoundException(input.fiscalDocumentId, 'SIGNED_XML');
    }

    return this.createVerifiedIndex({
      ...input,
      type: 'SIGNED_XML',
      storageKey: source.signedXmlStorageKey,
      expectedSha256: source.signedXmlSha256,
      contentType: 'application/xml',
    });
  }

  async ensureHaciendaResponseArtifact(input: ArtifactIndexInput): Promise<IndexedArtifactResult> {
    const existing = await this.findExisting(input, 'HACIENDA_RESPONSE_XML');
    if (existing) return { ...existing, wasCreated: false };

    const submission = await this.prisma.fiscalSubmission.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalDocumentId: input.fiscalDocumentId,
        responseStorageKey: { not: null },
        responseSha256: { not: null },
      },
    });

    if (!submission?.responseStorageKey || !submission.responseSha256) {
      throw new ArtifactNotFoundException(input.fiscalDocumentId, 'HACIENDA_RESPONSE_XML');
    }

    return this.createVerifiedIndex({
      ...input,
      type: 'HACIENDA_RESPONSE_XML',
      storageKey: submission.responseStorageKey,
      expectedSha256: submission.responseSha256,
      contentType: submission.responseContentType ?? 'application/xml',
    });
  }

  private async findExisting(
    input: ArtifactIndexInput,
    type: 'SIGNED_XML' | 'HACIENDA_RESPONSE_XML',
  ): Promise<Omit<IndexedArtifactResult, 'wasCreated'> | null> {
    const existing = await this.prisma.fiscalArtifact.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalDocumentId: input.fiscalDocumentId,
        type,
        supersededAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!existing) return null;
    return {
      artifactId: existing.id,
      storageKey: existing.storageKey,
      sha256: existing.sha256,
      sizeBytes: existing.sizeBytes,
    };
  }

  private async createVerifiedIndex(
    input: ArtifactIndexInput & {
      readonly type: 'SIGNED_XML' | 'HACIENDA_RESPONSE_XML';
      readonly storageKey: string;
      readonly expectedSha256: string;
      readonly contentType: string;
    },
  ): Promise<IndexedArtifactResult> {
    const bytes = await this.storage.download(input.storageKey);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== input.expectedSha256) {
      throw new ArtifactIntegrityException(input.fiscalDocumentId, input.type);
    }

    const artifactId = randomUUID();
    try {
      await this.prisma.fiscalArtifact.create({
        data: {
          id: artifactId,
          tenantId: input.tenantId,
          companyId: input.companyId,
          fiscalDocumentId: input.fiscalDocumentId,
          type: input.type,
          storageKey: input.storageKey,
          sha256: input.expectedSha256,
          contentType: input.contentType,
          sizeBytes: bytes.length,
        },
      });

      this.logger.log({
        msg: 'Fiscal XML artifact indexed for official artifact API',
        artifactId,
        fiscalDocumentId: input.fiscalDocumentId,
        type: input.type,
        sizeBytes: bytes.length,
      });

      return {
        artifactId,
        storageKey: input.storageKey,
        sha256: input.expectedSha256,
        sizeBytes: bytes.length,
        wasCreated: true,
      };
    } catch (error: unknown) {
      const winner = await this.findExisting(input, input.type);
      if (winner) return { ...winner, wasCreated: false };
      throw error;
    }
  }
}
