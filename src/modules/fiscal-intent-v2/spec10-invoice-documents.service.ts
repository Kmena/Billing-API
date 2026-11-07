import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { FiscalEvidenceResolverService } from '../fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { FiscalPdfArtifactStateService } from '../fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';
import { fiscalPackageZip } from './spec10-zip';

export type Spec10ArtifactType = 'PDF' | 'SIGNED_XML' | 'HACIENDA_RESPONSE_XML';
type ArtifactBytes = { bytes: Buffer; contentType: string; sha256: string; filename: string };

@Injectable()
export class Spec10InvoiceDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: W2B2LabInvoiceService,
    private readonly evidence: FiscalEvidenceResolverService,
    private readonly pdfState: FiscalPdfArtifactStateService,
  ) {}

  private async document(principal: ConsumerV2Principal, id: string) {
    // The existing v2 read service checks the current key and the document's consumer origin.
    await this.invoices.getDocument(principal, id, ['INVOICE']);
    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id,
        tenantId: principal.tenantId,
        companyId: principal.companyId,
        environment: principal.environment,
        type: 'INVOICE',
        originConsumerId: principal.consumerId,
        originAssociationId: principal.associationId,
      },
      select: {
        id: true,
        status: true,
        clave: true,
        consecutive: true,
        issueDate: true,
        updatedAt: true,
        submission: {
          select: {
            status: true,
            acceptedAt: true,
            rejectedAt: true,
            responseReceivedAt: true,
            responseStorageKey: true,
            responseSha256: true,
            lastNormalizedErrorCode: true,
            lastSanitizedErrorMessage: true,
          },
        },
      },
    });
    if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
    return document;
  }

  async view(principal: ConsumerV2Principal, id: string) {
    const document = await this.document(principal, id);
    const scope = {
      tenantId: principal.tenantId,
      companyId: principal.companyId,
      fiscalDocumentId: id,
    };
    const [pdf, xml, evidence, delivery] = await Promise.all([
      this.prisma.fiscalArtifact.findFirst({
        where: { ...scope, type: 'PDF', supersededAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          sha256: true,
          sizeBytes: true,
          contentType: true,
          templateId: true,
          rendererVersion: true,
        },
      }),
      this.prisma.fiscalXmlArtifact.findFirst({
        where: { ...scope, signedXmlStorageKey: { not: null }, signedXmlSha256: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { signedXmlSha256: true },
      }),
      this.prisma.fiscalArtifact.findMany({
        where: {
          ...scope,
          supersededAt: null,
          type: { in: ['SIGNED_XML', 'HACIENDA_RESPONSE_XML'] },
        },
        select: { type: true, sha256: true, sizeBytes: true },
      }),
      this.prisma.documentDelivery.findMany({
        where: { ...scope, channel: 'EMAIL' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { kind: true, status: true, deliveredAt: true, updatedAt: true },
      }),
    ]);
    const selectedDelivery =
      delivery.find((entry) => entry.kind === 'ACCEPTED_FISCAL_PACKAGE') ?? delivery[0];
    const xmlIndex = evidence.find((entry) => entry.type === 'SIGNED_XML');
    const responseIndex = evidence.find((entry) => entry.type === 'HACIENDA_RESPONSE_XML');
    const signedSha = xml?.signedXmlSha256 ?? null;
    const responseSha = document.submission?.responseSha256 ?? null;
    const valid = (hash: string | null | undefined) =>
      Boolean(hash && /^[a-f0-9]{64}$/i.test(hash));
    return {
      id: document.id,
      type: 'INVOICE' as const,
      environment:
        principal.environment === 'SANDBOX' ? ('STAG' as const) : ('PRODUCTION' as const),
      status: document.status,
      clave: document.clave,
      consecutive: document.consecutive,
      issuedAt: document.issueDate,
      acceptedAt: document.submission?.acceptedAt ?? null,
      updatedAt: document.submission?.responseReceivedAt ?? document.updatedAt,
      submissionStatus: document.submission?.status ?? null,
      rejectionReason:
        document.submission?.lastSanitizedErrorMessage ??
        document.submission?.lastNormalizedErrorCode ??
        null,
      emailDelivery: selectedDelivery
        ? {
            kind: selectedDelivery.kind,
            status: selectedDelivery.status,
            deliveredAt: selectedDelivery.deliveredAt,
            updatedAt: selectedDelivery.updatedAt,
          }
        : { kind: null, status: 'NOT_REQUESTED', deliveredAt: null, updatedAt: null },
      documents: {
        pdf:
          pdf &&
          pdf.contentType === 'application/pdf' &&
          pdf.templateId &&
          pdf.rendererVersion &&
          pdf.sizeBytes > 0 &&
          valid(pdf.sha256)
            ? { sha256: pdf.sha256, sizeBytes: pdf.sizeBytes }
            : null,
        signedXml: valid(signedSha)
          ? { sha256: signedSha, sizeBytes: xmlIndex?.sizeBytes ?? null }
          : null,
        haciendaResponse:
          document.submission?.responseStorageKey && valid(responseSha)
            ? { sha256: responseSha, sizeBytes: responseIndex?.sizeBytes ?? null }
            : null,
      },
    };
  }

  async artifact(
    principal: ConsumerV2Principal,
    id: string,
    type: Spec10ArtifactType,
  ): Promise<ArtifactBytes> {
    const document = await this.document(principal, id);
    const filename =
      type === 'PDF'
        ? `${document.clave}.pdf`
        : type === 'SIGNED_XML'
          ? `${document.clave}.xml`
          : `${document.clave}_respuesta.xml`;
    if (type === 'SIGNED_XML') {
      const result = await this.evidence.resolveSignedXmlBytes(
        principal.tenantId,
        principal.companyId,
        id,
      );
      return {
        bytes: result.bytes,
        contentType: result.contentType,
        sha256: result.sha256,
        filename,
      };
    }
    if (type === 'HACIENDA_RESPONSE_XML') {
      const result = await this.evidence.resolveHaciendaResponseBytes(
        principal.tenantId,
        principal.companyId,
        id,
      );
      return {
        bytes: result.bytes,
        contentType: result.contentType,
        sha256: result.sha256,
        filename,
      };
    }
    const pdf = await this.prisma.fiscalArtifact.findFirst({
      where: {
        tenantId: principal.tenantId,
        companyId: principal.companyId,
        fiscalDocumentId: id,
        type: 'PDF',
        supersededAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!pdf) throw new NotFoundException({ code: 'FISCAL_PDF_NOT_FOUND' });
    if (pdf.contentType !== 'application/pdf' || !pdf.templateId || !pdf.rendererVersion)
      throw new UnprocessableEntityException({ code: 'FISCAL_PDF_INVALID' });
    const assessment = await this.pdfState.assess(pdf, {
      documentType: 'INVOICE',
      clave: document.clave,
      consecutive: document.consecutive,
    });
    let bytes: Buffer;
    try {
      bytes = this.pdfState.requireDownloadable(assessment);
    } catch {
      throw new UnprocessableEntityException({ code: 'FISCAL_PDF_INTEGRITY' });
    }
    return { bytes, contentType: 'application/pdf', sha256: pdf.sha256, filename };
  }

  async package(principal: ConsumerV2Principal, id: string): Promise<ArtifactBytes> {
    const [pdf, signed, response] = await Promise.all([
      this.artifact(principal, id, 'PDF'),
      this.artifact(principal, id, 'SIGNED_XML'),
      this.artifact(principal, id, 'HACIENDA_RESPONSE_XML'),
    ]);
    const bytes = fiscalPackageZip(
      [pdf, signed, response].map((file) => ({ name: file.filename, bytes: file.bytes })),
    );
    return {
      bytes,
      contentType: 'application/zip',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      filename: `${pdf.filename.slice(0, -4)}_paquete.zip`,
    };
  }
}
