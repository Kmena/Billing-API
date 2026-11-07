import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { FiscalEvidenceResolverService } from '../../fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { FiscalPdfArtifactStateService } from '../../fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import { ConsumerV2Principal } from '../../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { W2B2LabInvoiceService } from '../w2-b2-lab-invoice.service';
import { Spec10InvoiceDocumentsService } from '../spec10-invoice-documents.service';

describe('SPEC-10 M2M fiscal read model', () => {
  const principal: ConsumerV2Principal = {
    tenantId: 'tenant',
    companyId: 'company',
    consumerId: 'consumer',
    associationId: 'association',
    apiKeyId: 'key',
    environment: 'SANDBOX',
  };
  const id = 'document';
  const pdfBytes = Buffer.from('%PDF-original');
  const xmlBytes = Buffer.from('<Factura>original</Factura>');
  const responseBytes = Buffer.from('<Mensaje>original</Mensaje>');
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  let status = 'ACCEPTED';
  let complete = true;
  const invoice = { getDocument: jest.fn().mockResolvedValue({ id }) };
  const prisma = {
    fiscalDocument: {
      findFirst: jest.fn().mockImplementation(async () => ({
        id,
        status,
        clave: '506123',
        consecutive: '00100001010000000008',
        issueDate: new Date('2026-11-06T10:00:00Z'),
        updatedAt: new Date('2026-11-06T10:04:00Z'),
        submission: {
          status,
          acceptedAt: status === 'ACCEPTED' ? new Date('2026-11-06T10:05:00Z') : null,
          rejectedAt: status === 'REJECTED' ? new Date('2026-11-06T10:05:00Z') : null,
          responseReceivedAt: complete ? new Date('2026-11-06T10:05:00Z') : null,
          responseStorageKey: complete ? 'response-key' : null,
          responseSha256: complete ? sha(responseBytes) : null,
          lastNormalizedErrorCode: status === 'REJECTED' ? 'RECEPTOR_INVALIDO' : null,
          lastSanitizedErrorMessage: null,
        },
      })),
    },
    fiscalArtifact: {
      findFirst: jest.fn().mockImplementation(async () =>
        complete
          ? {
              id: 'pdf',
              type: 'PDF',
              storageKey: 'pdf-key',
              sha256: sha(pdfBytes),
              sizeBytes: pdfBytes.length,
              contentType: 'application/pdf',
              templateId: 'BILLING_DEFAULT_V1',
              rendererVersion: '1.0.0',
            }
          : null,
      ),
      findMany: jest.fn().mockImplementation(async () =>
        complete
          ? [
              { type: 'SIGNED_XML', sha256: sha(xmlBytes), sizeBytes: xmlBytes.length },
              {
                type: 'HACIENDA_RESPONSE_XML',
                sha256: sha(responseBytes),
                sizeBytes: responseBytes.length,
              },
            ]
          : [],
      ),
    },
    fiscalXmlArtifact: {
      findFirst: jest.fn().mockResolvedValue({ signedXmlSha256: sha(xmlBytes) }),
    },
    documentDelivery: {
      findMany: jest.fn().mockResolvedValue([
        {
          kind: 'INITIAL_DOCUMENT',
          status: 'DELIVERED',
          deliveredAt: new Date(),
          updatedAt: new Date(),
        },
        {
          kind: 'ACCEPTED_FISCAL_PACKAGE',
          status: 'QUEUED',
          deliveredAt: null,
          updatedAt: new Date(),
        },
      ]),
    },
  };
  const evidence = {
    resolveSignedXmlBytes: jest.fn().mockResolvedValue({
      bytes: xmlBytes,
      sha256: sha(xmlBytes),
      contentType: 'application/xml',
    }),
    resolveHaciendaResponseBytes: jest.fn().mockResolvedValue({
      bytes: responseBytes,
      sha256: sha(responseBytes),
      contentType: 'application/xml',
    }),
  };
  const pdfState = {
    assess: jest.fn().mockResolvedValue({ state: 'VALID_REAL_CURRENT', bytes: pdfBytes }),
    requireDownloadable: jest.fn().mockReturnValue(pdfBytes),
  };
  const service = new Spec10InvoiceDocumentsService(
    prisma as unknown as PrismaService,
    invoice as unknown as W2B2LabInvoiceService,
    evidence as unknown as FiscalEvidenceResolverService,
    pdfState as unknown as FiscalPdfArtifactStateService,
  );

  beforeEach(() => {
    status = 'ACCEPTED';
    complete = true;
    invoice.getDocument.mockResolvedValue({ id });
  });

  it('returns fiscal, email, dates and artifact hashes independently', async () => {
    const view = await service.view(principal, id);
    expect(view).toMatchObject({
      status: 'ACCEPTED',
      environment: 'STAG',
      acceptedAt: new Date('2026-11-06T10:05:00Z'),
      emailDelivery: { kind: 'ACCEPTED_FISCAL_PACKAGE', status: 'QUEUED' },
      documents: {
        pdf: { sha256: sha(pdfBytes) },
        signedXml: { sha256: sha(xmlBytes) },
        haciendaResponse: { sha256: sha(responseBytes) },
      },
    });
  });

  it.each(['READY_FOR_XML', 'REJECTED', 'MANUAL_REVIEW'])(
    'preserves the real %s state and missing files',
    async (value) => {
      status = value;
      complete = false;
      const view = await service.view(principal, id);
      expect(view.status).toBe(value);
      expect(view.documents.pdf).toBeNull();
      expect(view.documents.haciendaResponse).toBeNull();
      expect(view.documents.signedXml).toMatchObject({ sha256: sha(xmlBytes) });
      if (value === 'REJECTED') expect(view.rejectionReason).toBe('RECEPTOR_INVALIDO');
    },
  );

  it('requires the current consumer origin before reading any artifact', async () => {
    invoice.getDocument.mockRejectedValueOnce(new NotFoundException());
    const reads = prisma.fiscalDocument.findFirst.mock.calls.length;
    await expect(service.artifact(principal, id, 'SIGNED_XML')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.fiscalDocument.findFirst.mock.calls.length).toBe(reads);
  });
});
