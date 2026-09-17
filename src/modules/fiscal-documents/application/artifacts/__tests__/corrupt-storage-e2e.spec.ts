/**
 * Corrupt storage E2E-ish integrity test — F4 final remediation.
 *
 * Uses a real StoragePort implementation backed by an in-memory map so bytes are
 * actually persisted, mutated, downloaded and verified through production services.
 */
import { createHash } from 'crypto';
import { FiscalArtifactService } from '../fiscal-artifact.service';
import { FiscalEvidenceResolverService } from '../fiscal-evidence-resolver.service';
import { DeliveryWorkerService } from '../../delivery/delivery-worker.service';
import { StoragePort } from '../../../../../infrastructure/storage/ports/storage.port';
import { DocumentDeliveryStatus } from '../../../domain/delivery/document-delivery-status.enum';
import { EventClass } from '../../../../audit/application/audit.service';

class MutableMemoryStorage implements StoragePort {
  private readonly objects = new Map<string, Buffer>();

  async upload(key: string, content: Buffer): Promise<string> {
    this.objects.set(key, Buffer.from(content));
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }

  async getSignedUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  corrupt(key: string, bytes: Buffer): void {
    this.objects.set(key, Buffer.from(bytes));
  }
}

type ArtifactServiceDeps = ConstructorParameters<typeof FiscalArtifactService>;
type EvidenceResolverDeps = ConstructorParameters<typeof FiscalEvidenceResolverService>;
type DeliveryWorkerDeps = ConstructorParameters<typeof DeliveryWorkerService>;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('F4 corrupt storage integrity flow', () => {
  const tenantId = 'tenant-corrupt';
  const companyId = 'company-corrupt';
  const fiscalDocumentId = 'document-corrupt';
  const artifactId = 'artifact-pdf-corrupt';
  const deliveryId = 'delivery-corrupt';
  const signedXmlKey = 'signed/document.xml';
  const pdfKey = 'pdf/document.pdf';
  const clave = '50601012500310112345600100001010000000001100000001';

  let storage: MutableMemoryStorage;
  let fiscalStatus: string;
  let deliveryStatus: string;
  let auditRecords: Array<{ eventClass: EventClass; action: string; metadata?: unknown }>;
  let emailSend: jest.Mock;

  beforeEach(async () => {
    storage = new MutableMemoryStorage();
    fiscalStatus = 'READY_TO_SUBMIT';
    deliveryStatus = 'QUEUED';
    auditRecords = [];
    emailSend = jest.fn();

    await storage.upload(signedXmlKey, Buffer.from('<signed>ok</signed>'));
    await storage.upload(pdfKey, Buffer.from('%PDF-expected-bytes'));
    storage.corrupt(pdfKey, Buffer.from('%PDF-corrupted-bytes'));
  });

  function createPrismaMock() {
    const signedXmlBytes = Buffer.from('<signed>ok</signed>');
    const pdfExpectedBytes = Buffer.from('%PDF-expected-bytes');

    return {
      fiscalArtifact: {
        findFirst: jest
          .fn()
          .mockImplementation((query: { where: { id?: string; type?: string } }) => {
            if (query.where.id === artifactId || query.where.type === 'PDF') {
              return Promise.resolve({
                id: artifactId,
                tenantId,
                companyId,
                fiscalDocumentId,
                type: 'PDF',
                storageKey: pdfKey,
                sha256: sha256(pdfExpectedBytes),
                contentType: 'application/pdf',
                sizeBytes: pdfExpectedBytes.length,
                templateId: 'BILLING_DEFAULT_V1',
                rendererVersion: '1.0.0',
                supersededAt: null,
                fiscalDocument: { clave },
              });
            }
            return Promise.resolve(null);
          }),
        findMany: jest.fn(),
      },
      fiscalXmlArtifact: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId,
          companyId,
          fiscalDocumentId,
          signedXmlStorageKey: signedXmlKey,
          signedXmlSha256: sha256(signedXmlBytes),
        }),
      },
      documentDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: deliveryId,
          tenantId,
          companyId,
          fiscalDocumentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: 'receiver@example.com',
          status: 'QUEUED',
          attemptCount: 0,
          fiscalDocument: {
            id: fiscalDocumentId,
            tenantId,
            companyId,
            clave,
            type: 'INVOICE',
            status: fiscalStatus,
          },
        }),
        updateMany: jest.fn().mockImplementation((input: { data: { status?: string } }) => {
          if (input.data.status) deliveryStatus = input.data.status;
          return Promise.resolve({ count: 1 });
        }),
      },
      deliveryAttempt: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('rejects corrupted download and blocks corrupted delivery with SECURITY audit', async () => {
    const prisma = createPrismaMock();
    const evidenceResolver = new FiscalEvidenceResolverService(
      prisma as unknown as EvidenceResolverDeps[0],
      storage,
    );
    const artifactService = new FiscalArtifactService(
      prisma as unknown as ArtifactServiceDeps[0],
      storage,
      evidenceResolver,
    );

    await expect(
      artifactService.downloadArtifact(tenantId, companyId, artifactId),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_INTEGRITY_FAILURE',
    });

    const worker = new DeliveryWorkerService(
      prisma as unknown as DeliveryWorkerDeps[0],
      storage,
      { sendEmail: emailSend } as DeliveryWorkerDeps[2],
      {
        registerHandler: jest.fn(),
        enqueue: jest.fn(),
        schedule: jest.fn(),
        publish: jest.fn(),
      } as unknown as DeliveryWorkerDeps[3],
      evidenceResolver,
      artifactService,
      {
        record: (event: { eventClass: EventClass; action: string; metadata?: unknown }) => {
          auditRecords.push(event);
        },
      } as DeliveryWorkerDeps[6],
    );

    await worker.processDelivery({ deliveryId });

    expect(emailSend).not.toHaveBeenCalled();
    expect(deliveryStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
    expect(auditRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventClass: EventClass.SECURITY,
          action: 'fiscal-delivery.artifact-integrity-failure',
        }),
      ]),
    );
    expect(fiscalStatus).toBe('READY_TO_SUBMIT');
  });
});
