import { FiscalIdentityEvidenceLookupController } from '../fiscal-identity-evidence-lookup.controller';

const request = {
  user: { tenantId: 'tenant-id' },
  apiKey: { id: 'api-key-id', scopes: ['invoices:read'], keyPrefix: 'safe-prefix' },
};

describe('FiscalIdentityEvidenceLookupController', () => {
  it('maps authenticated POST evidence to the read-only lookup service', async () => {
    const lookup = { execute: jest.fn().mockResolvedValue({ fiscalDocumentId: 'document-id' }) };
    const controller = new FiscalIdentityEvidenceLookupController(lookup as never);
    const body = {
      idempotencyKey: 'inventori:1:invoice:1890',
      operation: 'fiscal-document.create.invoice',
      equivalenceContractVersion: 'fiscal-payload-equivalence.v1',
      fiscalPayload: { currency: 'CRC', saleCondition: '01', lines: [] },
    };

    await expect(
      controller.findByFiscalEvidence(request as never, 'company-id', 'SANDBOX', body as never),
    ).resolves.toEqual({ fiscalDocumentId: 'document-id' });
    expect(lookup.execute).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      companyId: 'company-id',
      environment: 'SANDBOX',
      apiKeyId: 'api-key-id',
      scopes: ['invoices:read'],
      idempotencyKey: 'inventori:1:invoice:1890',
      operation: 'fiscal-document.create.invoice',
      equivalenceContractVersion: 'fiscal-payload-equivalence.v1',
      fiscalPayload: body.fiscalPayload,
    });
  });
});
