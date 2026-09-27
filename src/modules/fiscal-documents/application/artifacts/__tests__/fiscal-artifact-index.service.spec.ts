import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { FiscalArtifactIndexService } from '../fiscal-artifact-index.service';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/local-storage.adapter';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('FiscalArtifactIndexService', () => {
  const tenantId = 'tenant-1';
  const companyId = 'company-1';
  const fiscalDocumentId = 'doc-1';

  let tmp: string;
  let storage: LocalStorageAdapter;
  let createdRows: Array<Record<string, unknown>>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'billing-artifact-index-'));
    storage = new LocalStorageAdapter(tmp, 'test-secret');
    createdRows = [];
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function prismaMock(options: {
    signedKey?: string;
    signedSha?: string;
    responseKey?: string;
    responseSha?: string;
    existing?: Record<string, unknown> | null;
  }) {
    return {
      fiscalArtifact: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(options.existing ?? null)),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdRows.push(data);
          return Promise.resolve(data);
        }),
      },
      fiscalXmlArtifact: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.signedKey && options.signedSha
              ? { signedXmlStorageKey: options.signedKey, signedXmlSha256: options.signedSha }
              : null,
          ),
      },
      fiscalSubmission: {
        findFirst: jest.fn().mockResolvedValue(
          options.responseKey && options.responseSha
            ? {
                responseStorageKey: options.responseKey,
                responseSha256: options.responseSha,
                responseContentType: 'application/xml',
              }
            : null,
        ),
      },
    };
  }

  it('indexes exact existing signed XML bytes without duplicating object content', async () => {
    const key = 'fiscal/test/signed.xml';
    const bytes = Buffer.from('<signed>original</signed>');
    await storage.upload(key, bytes);

    const prisma = prismaMock({ signedKey: key, signedSha: sha256(bytes) });
    const service = new FiscalArtifactIndexService(prisma as never, storage);

    const result = await service.ensureSignedXmlArtifact({ tenantId, companyId, fiscalDocumentId });

    expect(result.wasCreated).toBe(true);
    expect(result.sha256).toBe(sha256(bytes));
    expect(createdRows).toEqual([
      expect.objectContaining({
        tenantId,
        companyId,
        fiscalDocumentId,
        type: 'SIGNED_XML',
        storageKey: key,
        sha256: sha256(bytes),
        contentType: 'application/xml',
        sizeBytes: bytes.length,
      }),
    ]);
  });

  it('indexes exact Hacienda response XML and preserves persisted response checksum', async () => {
    const key = 'fiscal-submissions/test/hacienda-response.xml';
    const bytes = Buffer.from('<MensajeHacienda><Mensaje>1</Mensaje></MensajeHacienda>');
    await storage.upload(key, bytes);

    const prisma = prismaMock({ responseKey: key, responseSha: sha256(bytes) });
    const service = new FiscalArtifactIndexService(prisma as never, storage);

    const result = await service.ensureHaciendaResponseArtifact({
      tenantId,
      companyId,
      fiscalDocumentId,
    });

    expect(result.wasCreated).toBe(true);
    expect(result.sha256).toBe(sha256(bytes));
    expect(createdRows[0]).toEqual(
      expect.objectContaining({
        type: 'HACIENDA_RESPONSE_XML',
        storageKey: key,
        sha256: sha256(bytes),
        contentType: 'application/xml',
        sizeBytes: bytes.length,
      }),
    );
  });

  it('blocks indexing when durable object checksum differs from metadata', async () => {
    const key = 'fiscal/test/signed.xml';
    await storage.upload(key, Buffer.from('<signed>mutated</signed>'));

    const prisma = prismaMock({ signedKey: key, signedSha: '0'.repeat(64) });
    const service = new FiscalArtifactIndexService(prisma as never, storage);

    await expect(
      service.ensureSignedXmlArtifact({ tenantId, companyId, fiscalDocumentId }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_FAILURE' });
    expect(createdRows).toHaveLength(0);
  });
});
