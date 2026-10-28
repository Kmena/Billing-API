import { NotFoundException } from '@nestjs/common';
import { FiscalEvidenceResolverService } from '../../fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { ConsumerV2Principal } from '../../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { W2B2LabInvoiceService } from '../w2-b2-lab-invoice.service';

describe('W2-B2 invoice XML adapter', () => {
  const principal: ConsumerV2Principal = {
    tenantId: 'tenant',
    companyId: 'company',
    consumerId: 'consumer',
    associationId: 'association',
    environment: 'SANDBOX',
    apiKeyId: 'key',
  };
  const bytes = Buffer.from('<FacturaElectronica/>');
  const artifact = {
    bytes,
    sha256: 'a'.repeat(64),
    contentType: 'application/xml',
    storageKey: 'existing/signed.xml',
  };
  const evidence = { resolveSignedXmlBytes: jest.fn().mockResolvedValue(artifact) };
  const service = new W2B2LabInvoiceService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    evidence as unknown as FiscalEvidenceResolverService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('checks invoice origin before accessing stored bytes', async () => {
    const authorize = jest
      .spyOn(service, 'getDocument')
      .mockRejectedValueOnce(new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' }));
    await expect(service.signedInvoiceXml(principal, 'invoice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(authorize).toHaveBeenCalledWith(principal, 'invoice', ['INVOICE']);
    expect(evidence.resolveSignedXmlBytes).not.toHaveBeenCalled();
  });

  it('returns the existing verified evidence object unchanged', async () => {
    jest.spyOn(service, 'getDocument').mockResolvedValueOnce({
      id: 'invoice',
      status: 'READY_TO_SUBMIT',
      clave: 'key',
      consecutive: 'number',
    });
    const result = await service.signedInvoiceXml(principal, 'invoice');
    expect(evidence.resolveSignedXmlBytes).toHaveBeenCalledWith('tenant', 'company', 'invoice');
    expect(result).toBe(artifact);
    expect(result.bytes).toBe(bytes);
  });
});
