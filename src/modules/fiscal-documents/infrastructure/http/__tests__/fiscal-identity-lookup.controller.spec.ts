import { FiscalIdentityLookupController } from '../fiscal-identity-lookup.controller';

const request = {
  user: { tenantId: 'tenant-id' },
  apiKey: { id: 'api-key-id', scopes: ['invoices:read'], keyPrefix: 'safe-prefix' },
};

describe('FiscalIdentityLookupController', () => {
  it('maps the authenticated GET request to the read-only lookup service', async () => {
    const lookup = { execute: jest.fn().mockResolvedValue({ fiscalDocumentId: 'document-id' }) };
    const controller = new FiscalIdentityLookupController(lookup as never);

    await expect(
      controller.findByIdempotency(request as never, 'company-id', 'SANDBOX', {
        idempotencyKey: 'inventori:1:invoice:1890',
        operation: 'fiscal-document.create.invoice',
        requestHash: 'A'.repeat(64),
      }),
    ).resolves.toEqual({ fiscalDocumentId: 'document-id' });

    expect(lookup.execute).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      companyId: 'company-id',
      environment: 'SANDBOX',
      apiKeyId: 'api-key-id',
      scopes: ['invoices:read'],
      idempotencyKey: 'inventori:1:invoice:1890',
      operation: 'fiscal-document.create.invoice',
      requestHash: 'a'.repeat(64),
    });
  });
});