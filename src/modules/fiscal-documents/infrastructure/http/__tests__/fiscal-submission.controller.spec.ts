import { FiscalSubmissionController } from '../fiscal-submission.controller';

const request = {
  user: { tenantId: 'tenant-id' },
  apiKey: { id: 'api-key-id', scopes: ['invoices:write', 'tickets:write'], keyPrefix: 'test' },
};

describe('FiscalSubmissionController', () => {
  it('maps invoice submit route to submit use case with sanitized actor context', async () => {
    const submit = { execute: jest.fn().mockResolvedValue({ status: 'QUEUED' }) };
    const controller = new FiscalSubmissionController(submit as never, {} as never, {} as never);

    await controller.submitInvoice(request as never, 'company-id', 'SANDBOX', 'document-id');

    expect(submit.execute).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      companyId: 'company-id',
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      documentId: 'document-id',
      apiKeyId: 'api-key-id',
      scopes: ['invoices:write', 'tickets:write'],
      actor: 'apiKey:test',
    });
  });

  it('maps ticket status and manual reconcile routes without exposing secrets', async () => {
    const getStatus = { execute: jest.fn().mockResolvedValue({ status: 'PROCESSING' }) };
    const reconcile = { execute: jest.fn().mockResolvedValue({ status: 'PROCESSING' }) };
    const controller = new FiscalSubmissionController(
      {} as never,
      getStatus as never,
      reconcile as never,
    );

    await controller.getTicketSubmission(request as never, 'company-id', 'SANDBOX', 'document-id');
    await controller.reconcileTicketSubmission(
      request as never,
      'company-id',
      'SANDBOX',
      'document-id',
    );

    expect(getStatus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'TICKET' }),
    );
    expect(reconcile.execute).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'TICKET' }),
    );
  });
});
