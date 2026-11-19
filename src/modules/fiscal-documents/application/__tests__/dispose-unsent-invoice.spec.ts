import { ConflictException } from '@nestjs/common';
import { FiscalDocumentService } from '../fiscal-document.service';

function fixture(submissions = 0) {
  const document = { id: 'invoice-id', status: 'READY_TO_SUBMIT', disposedAt: null };
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ id: document.id }]),
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({ apiKeyId: 'key-id' }) },
    fiscalDocument: {
      findFirst: jest.fn().mockResolvedValue(document),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    fiscalSubmission: { count: jest.fn().mockResolvedValue(submissions) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  const service = new FiscalDocumentService(prisma as never, {} as never);
  const input = { tenantId: 'tenant-id', companyId: 'company-id', documentId: 'invoice-id',
    apiKeyId: 'key-id', actor: 'apiKey:test', reason: 'Cobro cancelado' };
  return { service, prisma, input };
}

describe('dispose unsent invoice', () => {
  it('refuses disposal once a fiscal submission exists', async () => {
    const { service, prisma, input } = fixture(1);
    await expect(service.disposeUnsentInvoice(input)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.fiscalDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks only an unsent sandbox invoice as superseded and audits it', async () => {
    const { service, prisma, input } = fixture();
    await expect(service.disposeUnsentInvoice(input)).resolves.toEqual({
      id: 'invoice-id', status: 'SUPERSEDED',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.fiscalDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUPERSEDED' }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
