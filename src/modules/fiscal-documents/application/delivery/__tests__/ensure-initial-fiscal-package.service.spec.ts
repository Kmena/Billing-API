import { EnsureInitialFiscalPackageService } from '../ensure-initial-fiscal-package.service';

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
});
