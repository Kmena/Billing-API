import { EnsureInitialFiscalPackageService } from '../ensure-initial-fiscal-package.service';
import { FiscalPdfArtifactPolicyException } from '../../artifacts/fiscal-pdf-artifact-state.service';
import { FiscalXmlProjectionError } from '../../fiscal-representation/read-only-fiscal-xml-parser';
import { PdfRenderTimeoutError } from '../../pdf/bounded-pdf-render-attempt';
import { PdfValidationError } from '../../pdf/valid-pdf-verifier.port';

const makeFailureBoundary = (error: Error) => {
  const publish = jest.fn();
  const create = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    fiscalDocument: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'doc-typed-failure',
        tenantId: 'tenant-1',
        companyId: 'company-1',
        status: 'ACCEPTED',
        type: 'INVOICE',
        receiverSnapshot: { correoElectronico: 'receiver@example.test' },
        xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'b'.repeat(64) }],
      }),
    },
    documentDelivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create,
      update: jest.fn(),
    },
  };
  const service = new EnsureInitialFiscalPackageService(
    prisma as never,
    { publish } as never,
    { generateOrReuse: jest.fn().mockRejectedValue(error) } as never,
  );
  return { create, prisma, publish, service };
};

describe('EnsureInitialFiscalPackageService artifact behavior', () => {
  it('ensures PDF artifact even when receiver has no email and delivery is skipped', async () => {
    const tenantId = 'tenant-1';
    const companyId = 'company-1';
    const fiscalDocumentId = 'doc-1';
    const publish = jest.fn();
    const generateOrReuse = jest.fn().mockResolvedValue({
      artifactId: 'pdf-1',
      storageKey: 'pdf/doc.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 12,
      wasCreated: true,
    });

    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: fiscalDocumentId,
          tenantId,
          companyId,
          status: 'ACCEPTED',
          type: 'INVOICE',
          receiverSnapshot: { email: null },
          xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'b'.repeat(64) }],
        }),
      },
      documentDelivery: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    const service = new EnsureInitialFiscalPackageService(
      prisma as never,
      { publish } as never,
      { generateOrReuse } as never,
    );

    await service.ensure({ tenantId, companyId, fiscalDocumentId });

    expect(generateOrReuse).toHaveBeenCalledWith(tenantId, companyId, fiscalDocumentId);
    expect(prisma.documentDelivery.findFirst).not.toHaveBeenCalled();
    expect(prisma.documentDelivery.create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    [
      'PDF_INVALID',
      new PdfValidationError('PDF_INVALID', 'parser rejected opaque bytes'),
      'PDF_INVALID',
    ],
    [
      'PDF_OVERSIZED',
      new PdfValidationError('PDF_OVERSIZED', 'byte ceiling exceeded'),
      'PDF_OVERSIZED',
    ],
    [
      'PDF_MOCK_DETECTED',
      new PdfValidationError('PDF_MOCK_DETECTED', 'historical marker found'),
      'PDF_MOCK_DETECTED',
    ],
    [
      'SIGNED_XML_HASH_MISMATCH',
      new FiscalXmlProjectionError('SIGNED_XML_HASH_MISMATCH', 'immutable evidence differs'),
      'SIGNED_XML_HASH_MISMATCH',
    ],
    [
      'SIGNED_XML_OVERSIZED',
      new FiscalXmlProjectionError('SIGNED_XML_OVERSIZED', 'input ceiling exceeded'),
      'SIGNED_XML_OVERSIZED',
    ],
    [
      'XML_MALFORMED',
      new FiscalXmlProjectionError('XML_MALFORMED', 'parser rejected the document'),
      'XML_MALFORMED',
    ],
    [
      'XML_SECURITY_REJECTED',
      new FiscalXmlProjectionError('XML_SECURITY_REJECTED', 'unsafe construct rejected'),
      'XML_SECURITY_REJECTED',
    ],
    [
      'XML_UNSUPPORTED_ROOT',
      new FiscalXmlProjectionError('XML_UNSUPPORTED_ROOT', 'unsupported document family'),
      'XML_UNSUPPORTED_ROOT',
    ],
    [
      'XML_NAMESPACE_INVALID',
      new FiscalXmlProjectionError('XML_NAMESPACE_INVALID', 'unexpected namespace'),
      'XML_NAMESPACE_INVALID',
    ],
    [
      'PROJECTION_FAILED',
      new FiscalXmlProjectionError('PROJECTION_FAILED', 'projection could not be completed'),
      'PROJECTION_FAILED',
    ],
    [
      'ARTIFACT_HASH_MISMATCH',
      new FiscalPdfArtifactPolicyException('HASH_MISMATCH', 'ARTIFACT_HASH_MISMATCH'),
      'ARTIFACT_HASH_MISMATCH',
    ],
    [
      'ARTIFACT_WRONG_VERSION',
      new FiscalPdfArtifactPolicyException('WRONG_VERSION', 'ARTIFACT_WRONG_VERSION'),
      'ARTIFACT_WRONG_VERSION',
    ],
    [
      'HISTORICAL_MOCK',
      new FiscalPdfArtifactPolicyException('HISTORICAL_MOCK', 'LEGACY_PDF_UNAVAILABLE'),
      'LEGACY_PDF_UNAVAILABLE',
    ],
    [
      'ARTIFACT_CORRUPT',
      new FiscalPdfArtifactPolicyException('CORRUPT', 'PDF_INVALID_STRUCTURE'),
      'PDF_INVALID_STRUCTURE',
    ],
  ])(
    'stores terminal typed failure %s without queueing SMTP delivery',
    async (_label, error, expectedCode) => {
      const { create, publish, service } = makeFailureBoundary(error);

      await service.ensure({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        fiscalDocumentId: 'doc-typed-failure',
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: expectedCode,
          nextAttemptAt: null,
        }),
      });
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'missing current artifact',
      new FiscalPdfArtifactPolicyException('MISSING', 'ARTIFACT_MISSING'),
      'ARTIFACT_MISSING',
    ],
    ['render timeout', new PdfRenderTimeoutError(30_000), 'RENDER_TIMEOUT'],
    ['transient renderer failure', new Error('renderer temporarily unavailable'), 'RENDER_FAILED'],
  ])('preserves bounded retry for %s', async (_label, error, expectedCode) => {
    const { create, publish, service } = makeFailureBoundary(error);

    await service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-typed-failure',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'RETRY_PENDING',
        lastErrorCode: expectedCode,
        nextAttemptAt: expect.any(Date),
      }),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not infer a canonical fiscal failure from an untyped message', async () => {
    const { create, service } = makeFailureBoundary(
      new Error('PDF_INVALID text without typed identity'),
    );

    await service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-typed-failure',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'RETRY_PENDING',
        lastErrorCode: 'RENDER_FAILED',
      }),
    });
  });
});

describe('EnsureInitialFiscalPackageService recipient compatibility', () => {
  it('uses legacy email for initial delivery', async () => {
    const publish = jest.fn();
    const create = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'doc-legacy',
          tenantId: 'tenant-1',
          companyId: 'company-1',
          status: 'ACCEPTED',
          type: 'INVOICE',
          receiverSnapshot: { email: 'legacy@example.com' },
          xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'b'.repeat(64) }],
        }),
      },
      documentDelivery: { findFirst: jest.fn().mockResolvedValue(null), create, update: jest.fn() },
    };
    const service = new EnsureInitialFiscalPackageService(
      prisma as never,
      { publish } as never,
      { generateOrReuse: jest.fn().mockResolvedValue({}) } as never,
    );
    await service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-legacy',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipient: 'legacy@example.com' }),
      }),
    );
    expect(publish).toHaveBeenCalled();
  });

  it('fails closed for conflicting recipient fields without creating a delivery', async () => {
    const publish = jest.fn();
    const create = jest.fn();
    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'doc-conflict',
          tenantId: 'tenant-1',
          companyId: 'company-1',
          status: 'ACCEPTED',
          type: 'INVOICE',
          receiverSnapshot: {
            correoElectronico: 'canonical@example.com',
            email: 'legacy@example.com',
          },
          xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'b'.repeat(64) }],
        }),
      },
      documentDelivery: { findFirst: jest.fn(), create, update: jest.fn() },
    };
    const service = new EnsureInitialFiscalPackageService(
      prisma as never,
      { publish } as never,
      { generateOrReuse: jest.fn().mockResolvedValue({}) } as never,
    );
    await service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-conflict',
    });
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
