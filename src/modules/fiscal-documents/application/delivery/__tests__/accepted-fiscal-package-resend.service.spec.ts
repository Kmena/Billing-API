import { AcceptedFiscalPackageResendService } from '../accepted-fiscal-package-resend.service';
import { FiscalPdfArtifactPolicyException } from '../../artifacts/fiscal-pdf-artifact-state.service';

const IDS = {
  tenant: '11111111-1111-4111-8111-111111111111',
  company: '22222222-2222-4222-8222-222222222222',
  document: '33333333-3333-4333-8333-333333333333',
  apiKey: '44444444-4444-4444-8444-444444444444',
};
const acceptedResponse = Buffer.from(
  '<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"><Mensaje>1</Mensaje></MensajeHacienda>',
);

function documentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.document,
    tenantId: IDS.tenant,
    companyId: IDS.company,
    type: 'INVOICE',
    status: 'ACCEPTED',
    clave: '50600000000000000000000000000000000000000000000000',
    consecutive: '00100001010000000001',
    receiverSnapshot: { correoElectronico: 'receiver@example.com' },
    disposedAt: null,
    supersededByFiscalDocumentId: null,
    ...overrides,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const prisma = {
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({}) },
    fiscalDocument: { findFirst: jest.fn().mockResolvedValue(documentFixture(overrides)) },
    fiscalArtifact: { findFirst: jest.fn().mockResolvedValue({ id: 'pdf' }) },
    documentDelivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'delivery-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const queue = { publish: jest.fn().mockResolvedValue(undefined) };
  const evidence = {
    resolveSignedXmlBytes: jest.fn().mockResolvedValue({
      bytes: Buffer.from('<FacturaElectronica/>'),
      contentType: 'application/xml',
      sha256: 'a',
      storageKey: 'signed',
    }),
    resolveHaciendaResponseBytes: jest.fn().mockResolvedValue({
      bytes: acceptedResponse,
      contentType: 'application/xml',
      sha256: 'b',
      storageKey: 'response',
    }),
  };
  const artifactState = {
    assess: jest.fn().mockResolvedValue({}),
    requireCurrent: jest.fn().mockReturnValue(Buffer.from('%PDF-1.7')),
  };
  const audit = { record: jest.fn() };
  return {
    prisma,
    queue,
    evidence,
    artifactState,
    audit,
    service: new AcceptedFiscalPackageResendService(
      prisma as never,
      queue as never,
      evidence as never,
      artifactState as never,
      audit as never,
    ),
  };
}

const command = {
  tenantId: IDS.tenant,
  companyId: IDS.company,
  environment: 'SANDBOX' as const,
  fiscalDocumentId: IDS.document,
  apiKeyId: IDS.apiKey,
  apiKeyPrefix: 'inventor',
};

describe('AcceptedFiscalPackageResendService', () => {
  it('queues an accepted invoice by reusing exactly the immutable artifacts', async () => {
    const ctx = setup();
    const result = await ctx.service.request(command);

    expect(result).toMatchObject({
      deliveryId: 'delivery-id',
      status: 'QUEUED',
      packageVersion: 'accepted-fiscal-package-v1',
      recipientDomain: 'example.com',
    });
    expect(ctx.prisma.documentDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'ACCEPTED_FISCAL_PACKAGE',
          packageVersion: null,
          status: 'QUEUED',
        }),
      }),
    );
    expect(ctx.queue.publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: 'delivery-id' },
      { retryLimit: 3 },
    );
    expect(ctx.evidence.resolveSignedXmlBytes).toHaveBeenCalledWith(
      IDS.tenant,
      IDS.company,
      IDS.document,
    );
    expect(ctx.evidence.resolveHaciendaResponseBytes).toHaveBeenCalledWith(
      IDS.tenant,
      IDS.company,
      IDS.document,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fiscal-delivery.accepted-package-resend-requested',
        actor: 'apiKey:inventor',
        metadata: expect.objectContaining({ apiKeyId: IDS.apiKey, recipientDomain: 'example.com' }),
      }),
    );
  });

  it('denies a SUPERSEDED source before reading artifacts or queuing', async () => {
    const ctx = setup({ status: 'SUPERSEDED' });
    await expect(ctx.service.request(command)).rejects.toMatchObject({
      code: 'FISCAL_DOCUMENT_SUPERSEDED',
    });
    expect(ctx.evidence.resolveSignedXmlBytes).not.toHaveBeenCalled();
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });

  it('denies an in-progress delivery without creating fiscal records or an SMTP job', async () => {
    const ctx = setup();
    ctx.prisma.documentDelivery.findFirst.mockResolvedValue({
      id: 'delivery-id',
      status: 'SENDING',
      deliveredAt: null,
    });
    await expect(ctx.service.request(command)).rejects.toMatchObject({
      code: 'FISCAL_DELIVERY_ALREADY_IN_PROGRESS',
    });
    expect(ctx.prisma.documentDelivery.create).not.toHaveBeenCalled();
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });
  it('uses a valid legacy snapshot email for AFPR delivery', async () => {
    const ctx = setup({ receiverSnapshot: { email: 'legacy@example.com' } });
    const result = await ctx.service.request(command);

    expect(result.recipientDomain).toBe('example.com');
    expect(ctx.prisma.documentDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipient: 'legacy@example.com' }),
      }),
    );
  });

  it('fails closed for conflicting receiver fields before reading artifacts', async () => {
    const ctx = setup({
      receiverSnapshot: {
        correoElectronico: 'canonical@example.com',
        email: 'legacy@example.com',
      },
    });

    await expect(ctx.service.request(command)).rejects.toMatchObject({
      code: 'FISCAL_DELIVERY_RECIPIENT_CONFLICT',
    });
    expect(ctx.artifactState.assess).not.toHaveBeenCalled();
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });

  it('resolves INV-4-shaped legacy email before the historical mock PDF guard rejects it', async () => {
    const ctx = setup({
      receiverSnapshot: { email: 'historical.receiver@example.com' },
      clave: '50602102600020753025100100001010000000005152720884',
      consecutive: '00100001010000000005',
    });
    ctx.artifactState.requireCurrent.mockImplementation(() => {
      throw new FiscalPdfArtifactPolicyException('HISTORICAL_MOCK', 'LEGACY_PDF_UNAVAILABLE');
    });

    await expect(ctx.service.request(command)).rejects.toMatchObject({
      code: 'FISCAL_DELIVERY_ARTIFACT_VALIDATION_FAILED',
    });
    expect(ctx.artifactState.assess).toHaveBeenCalledTimes(1);
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });
});
