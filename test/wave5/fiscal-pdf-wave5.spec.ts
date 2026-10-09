import { createHash } from 'crypto';
import {
  FiscalPdfArtifactPolicyException,
  FiscalPdfArtifactStateService,
  PersistedPdfArtifact,
} from '../../src/modules/fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import { PdfValidationError } from '../../src/modules/fiscal-documents/application/pdf/valid-pdf-verifier.port';
import { GenerateFiscalPdfService } from '../../src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service';
import { EnsureInitialFiscalPackageService } from '../../src/modules/fiscal-documents/application/delivery/ensure-initial-fiscal-package.service';

const identity = {
  documentType: 'INVOICE' as const,
  clave: '50612092600310100000000100001010000000001123456789',
  consecutive: '00100001010000000001',
};

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const artifact = (bytes: Buffer, rendererVersion = '2.0.0'): PersistedPdfArtifact => ({
  id: 'artifact-1',
  storageKey: 'pdf/artifact-1.pdf',
  sha256: hash(bytes),
  sizeBytes: bytes.length,
  templateId: 'BILLING_DEFAULT_V1',
  rendererVersion,
});

const classifier = (bytes: Buffer, verify = jest.fn().mockResolvedValue({} as never)) => {
  const storage = { download: jest.fn().mockResolvedValue(bytes) };
  return {
    storage,
    verify,
    service: new FiscalPdfArtifactStateService(storage as never, { verify } as never),
  };
};

describe('Fiscal PDF Wave 5 — canonical artifact states', () => {
  it('classifies a verified 2.0.0 artifact as current and permits current use', async () => {
    const bytes = Buffer.from('%PDF-current-real');
    const { service } = classifier(bytes);
    const assessment = await service.assess(artifact(bytes), identity);
    expect(assessment.state).toBe('VALID_REAL_CURRENT');
    expect(service.requireCurrent(assessment)).toEqual(bytes);
  });

  it('classifies a verified older real version separately and permits historical download only', async () => {
    const bytes = Buffer.from('%PDF-older-real');
    const { service } = classifier(bytes);
    const assessment = await service.assess(artifact(bytes, '1.9.0'), identity);
    expect(assessment.state).toBe('VALID_REAL_OLDER_VERSION');
    expect(service.requireDownloadable(assessment)).toEqual(bytes);
    expect(() => service.requireCurrent(assessment)).toThrow(FiscalPdfArtifactPolicyException);
  });

  it('preserves historical mock evidence and never permits reuse/download as current', async () => {
    const bytes = Buffer.from('%PDF-1.4-MOCK-BILLING historical evidence');
    const { service, verify } = classifier(bytes);
    const assessment = await service.assess(artifact(bytes, '1.0.0'), identity);
    expect(assessment.state).toBe('HISTORICAL_MOCK');
    expect(assessment.failureCode).toBe('PDF_MOCK_DETECTED');
    expect(verify).not.toHaveBeenCalled();
    expect(() => service.requireDownloadable(assessment)).toThrow(
      expect.objectContaining({ code: 'LEGACY_PDF_UNAVAILABLE' }),
    );
  });

  it('classifies missing object, corrupt bytes, future version and hash mismatch deterministically', async () => {
    const bytes = Buffer.from('%PDF-valid');
    const missingStorage = { download: jest.fn().mockRejectedValue(new Error('object missing')) };
    const missing = new FiscalPdfArtifactStateService(
      missingStorage as never,
      { verify: jest.fn() } as never,
    );
    await expect(missing.assess(artifact(bytes), identity)).resolves.toMatchObject({
      state: 'MISSING',
    });

    const corrupt = classifier(
      bytes,
      jest.fn().mockRejectedValue(new PdfValidationError('PDF_INVALID', 'bad')),
    );
    await expect(corrupt.service.assess(artifact(bytes), identity)).resolves.toMatchObject({
      state: 'CORRUPT',
    });

    const wrong = classifier(bytes);
    await expect(wrong.service.assess(artifact(bytes, '3.0.0'), identity)).resolves.toMatchObject({
      state: 'WRONG_VERSION',
    });

    const mismatch = classifier(bytes);
    await expect(
      mismatch.service.assess({ ...artifact(bytes), sha256: '0'.repeat(64) }, identity),
    ).resolves.toMatchObject({ state: 'HASH_MISMATCH' });
  });
});

describe('Fiscal PDF Wave 5 — safe current reuse and delivery gate', () => {
  it('reuses only a validated current artifact without rendering again', async () => {
    const bytes = Buffer.from('%PDF-current');
    const existing = {
      ...artifact(bytes),
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
    };
    const render = jest.fn();
    const assessment = { state: 'VALID_REAL_CURRENT' as const, artifact: existing, bytes };
    const service = new GenerateFiscalPdfService(
      {
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue({ ...identity, type: 'INVOICE' }),
        },
        fiscalArtifact: { findFirst: jest.fn().mockResolvedValue(existing) },
      } as never,
      {} as never,
      { render } as never,
      {} as never,
      {} as never,
      true,
      {
        assess: jest.fn().mockResolvedValue(assessment),
        requireCurrent: jest.fn().mockReturnValue(bytes),
      } as never,
    );
    await expect(service.generateOrReuse('tenant-1', 'company-1', 'doc-1')).resolves.toMatchObject({
      artifactId: 'artifact-1',
      wasCreated: false,
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('never regenerates a document with historical PDF evidence', async () => {
    const bytes = Buffer.from('%PDF-1.4-MOCK-BILLING historical evidence');
    const historical = {
      ...artifact(bytes, '1.0.0'),
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
    };
    const render = jest.fn();
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(historical);
    const service = new GenerateFiscalPdfService(
      {
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue({ ...identity, type: 'INVOICE' }),
        },
        fiscalArtifact: { findFirst },
      } as never,
      {} as never,
      { render } as never,
      {} as never,
      {} as never,
      true,
      {
        assess: jest.fn().mockResolvedValue({
          state: 'HISTORICAL_MOCK',
          artifact: historical,
          bytes,
        }),
        requireCurrent: jest.fn().mockImplementation(() => {
          throw new FiscalPdfArtifactPolicyException('HISTORICAL_MOCK', 'LEGACY_PDF_UNAVAILABLE');
        }),
      } as never,
    );

    await expect(service.generateOrReuse('tenant-1', 'company-1', 'doc-1')).rejects.toMatchObject({
      code: 'LEGACY_PDF_UNAVAILABLE',
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('records a failed INITIAL_DOCUMENT without queueing when generation/reuse fails', async () => {
    const publish = jest.fn();
    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'doc-1',
          tenantId: 'tenant-1',
          companyId: 'company-1',
          status: 'ACCEPTED',
          type: 'INVOICE',
          receiverSnapshot: { correoElectronico: 'receiver@example.test' },
          xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'a'.repeat(64) }],
        }),
      },
      documentDelivery: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new EnsureInitialFiscalPackageService(
      prisma as never,
      { publish } as never,
      {
        generateOrReuse: jest
          .fn()
          .mockRejectedValue(
            new FiscalPdfArtifactPolicyException('WRONG_VERSION', 'ARTIFACT_WRONG_VERSION'),
          ),
      } as never,
    );
    await service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
    });
    expect(prisma.documentDelivery.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.documentDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'INITIAL_DOCUMENT',
        status: 'FAILED',
        lastErrorCode: 'ARTIFACT_WRONG_VERSION',
      }),
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
