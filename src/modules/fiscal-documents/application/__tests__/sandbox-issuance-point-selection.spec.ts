import { FiscalDocumentService } from '../fiscal-document.service';

describe('explicit SANDBOX issuance point', () => {
  it('selects only the requested active point in the issuer company', async () => {
    const sentinel = new Error('STOP_BEFORE_SEQUENCE');
    const tx = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-id' }) },
      haciendaConnection: { findFirst: jest.fn().mockResolvedValue({ id: 'connection-id' }) },
      fiscalIssuancePoint: { findFirst: jest.fn().mockResolvedValue({
        id: 'point-id', branchCode: '001', terminalCode: '00999',
      }) },
      $queryRaw: jest.fn().mockRejectedValue(sentinel),
    };
    const service = new FiscalDocumentService({} as never, {} as never);
    (service as unknown as { getReadyCompanyFiscalProfile: jest.Mock }).getReadyCompanyFiscalProfile =
      jest.fn().mockResolvedValue({ resolvedActivityCode: '000000' });
    const command = {
      tenantId: 'tenant-id', companyId: 'company-id', environment: 'SANDBOX',
      type: 'INVOICE', issuancePoint: { branchCode: '001', terminalCode: '00999' },
    };
    await expect((service as unknown as { createDocumentCore: (...args: unknown[]) => Promise<unknown> })
      .createDocumentCore(tx, command, 'hash', 'key')).rejects.toThrow('STOP_BEFORE_SEQUENCE');
    expect(tx.fiscalIssuancePoint.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-id', companyId: 'company-id', environment: 'SANDBOX',
        active: true, branchCode: '001', terminalCode: '00999' },
      orderBy: { id: 'asc' },
    });
  });
});
