import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile, realpath, stat } from 'fs/promises';
import { resolve, sep } from 'path';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';

type ArchiveArtifact = {
  type: 'SIGNED_XML' | 'PDF' | 'HACIENDA_RESPONSE_XML';
  filename: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
};

type ArchiveDocument = {
  sourceId: string;
  documentId: string;
  tenantId: string;
  companyId: string;
  environment: 'SANDBOX';
  type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  status: string;
  clave: string;
  consecutive: string;
  sourceFiscalDocumentId: string | null;
  artifacts: ArchiveArtifact[];
};

/** Immutable, source-qualified archive mounted read-only into the lab Billing process. */
@Injectable()
export class Spec10HistoricalArchiveService {
  private root(): string {
    if (process.env.NODE_ENV !== 'test' || !process.env.SPEC10_ARCHIVE_ROOT)
      throw new NotFoundException({ code: 'HISTORICAL_ARCHIVE_NOT_MOUNTED' });
    return resolve(process.env.SPEC10_ARCHIVE_ROOT);
  }

  private safePath(root: string, ...parts: string[]): string {
    if (parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(part) || part === '..'))
      throw new NotFoundException({ code: 'HISTORICAL_DOCUMENT_NOT_FOUND' });
    const path = resolve(root, ...parts);
    if (!path.startsWith(`${root}${sep}`))
      throw new NotFoundException({ code: 'HISTORICAL_DOCUMENT_NOT_FOUND' });
    return path;
  }

  private async noSymlinkEscape(root: string, path: string): Promise<void> {
    const physicalRoot = await realpath(root);
    const physicalPath = await realpath(path);
    if (!physicalPath.startsWith(`${physicalRoot}${sep}`))
      throw new NotFoundException({ code: 'HISTORICAL_DOCUMENT_NOT_FOUND' });
  }

  private async document(principal: ConsumerV2Principal, sourceId: string, documentId: string) {
    const root = this.root();
    const manifestPath = this.safePath(root, sourceId, documentId, 'manifest.json');
    let document: ArchiveDocument;
    try {
      await this.noSymlinkEscape(root, manifestPath);
      if ((await stat(manifestPath)).size > 1024 * 1024)
        throw new Error('ARCHIVE_MANIFEST_OVERSIZED');
      document = JSON.parse(await readFile(manifestPath, 'utf8')) as ArchiveDocument;
    } catch {
      throw new NotFoundException({ code: 'HISTORICAL_DOCUMENT_NOT_FOUND' });
    }
    if (
      document.sourceId !== sourceId ||
      document.documentId !== documentId ||
      document.tenantId !== principal.tenantId ||
      document.companyId !== principal.companyId ||
      document.environment !== principal.environment ||
      !Array.isArray(document.artifacts)
    ) {
      throw new NotFoundException({ code: 'HISTORICAL_DOCUMENT_NOT_FOUND' });
    }
    return { root, document };
  }

  async get(principal: ConsumerV2Principal, sourceId: string, documentId: string) {
    const { document } = await this.document(principal, sourceId, documentId);
    return {
      sourceId: document.sourceId,
      documentId: document.documentId,
      environment: document.environment,
      type: document.type,
      status: document.status,
      clave: document.clave,
      consecutive: document.consecutive,
      sourceFiscalDocumentId: document.sourceFiscalDocumentId,
      artifacts: document.artifacts.map((artifact) => ({
        type: artifact.type,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        contentType: artifact.contentType,
      })),
    };
  }

  async artifact(
    principal: ConsumerV2Principal,
    sourceId: string,
    documentId: string,
    type: ArchiveArtifact['type'],
  ) {
    const { root, document } = await this.document(principal, sourceId, documentId);
    const artifact = document.artifacts.find((entry) => entry.type === type);
    if (!artifact || !/^[a-f0-9]{64}$/i.test(artifact.sha256) || artifact.sizeBytes < 1)
      throw new NotFoundException({ code: 'HISTORICAL_ARTIFACT_NOT_FOUND' });
    const path = this.safePath(root, sourceId, documentId, artifact.filename);
    let bytes: Buffer;
    try {
      await this.noSymlinkEscape(root, path);
      const file = await stat(path);
      if (file.size > 25 * 1024 * 1024 || file.size !== artifact.sizeBytes)
        throw new UnprocessableEntityException({ code: 'HISTORICAL_ARTIFACT_INTEGRITY_FAILED' });
      bytes = await readFile(path);
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw new UnprocessableEntityException({ code: 'HISTORICAL_ARTIFACT_UNAVAILABLE' });
    }
    if (
      bytes.length !== artifact.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.sha256.toLowerCase()
    ) {
      throw new UnprocessableEntityException({ code: 'HISTORICAL_ARTIFACT_INTEGRITY_FAILED' });
    }
    return { bytes, contentType: artifact.contentType, sha256: artifact.sha256 };
  }
}
