import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../audit/application/audit.service';
import { FiscalDocumentService } from '../../fiscal-documents/application/fiscal-document.service';
import { FiscalArtifactService } from '../../fiscal-documents/application/artifacts/fiscal-artifact.service';
import { DeliveryRequestService } from '../../fiscal-documents/application/delivery/delivery-request.service';
import { PrepareFiscalXmlService } from '../../fiscal-documents/application/fiscal-xml/prepare-fiscal-xml.service';
import { FiscalReadinessService } from '../../fiscal-documents/application/fiscal-xml/fiscal-readiness.service';
import { SubmitFiscalDocumentService } from '../../fiscal-documents/application/submission/submit-fiscal-document.service';
import type { FiscalTestInvoiceV1Dto } from '../infrastructure/http/fiscal-onboarding-v1.dto';

const CONTRACT_VERSION = '1.0';
const PROFILE_VERSION = 'inventori-fiscal-v1';
const MODE = 'HACIENDA_SANDBOX_SUBMISSION';
const IDEMPOTENCY_PREFIX = 'fiscal-test:v1:';

export interface FiscalTestInvoiceAccess {
  tenantId: string;
  companyId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  apiKeyId: string;
  apiKeyEnvironment: 'TEST' | 'LIVE';
  scopes: string[];
  actor: string;
}

@Injectable()
export class FiscalTestInvoiceV1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: FiscalDocumentService,
    private readonly prepareXml: PrepareFiscalXmlService,
    private readonly submitDocument: SubmitFiscalDocumentService,
    private readonly artifacts: FiscalArtifactService,
    private readonly deliveries: DeliveryRequestService,
    private readonly readiness: FiscalReadinessService,
  ) {}

  async initiate(
    access: FiscalTestInvoiceAccess,
    idempotencyToken: string,
    dto: FiscalTestInvoiceV1Dto,
  ) {
    this.assertSandbox(access);
    const key = `${IDEMPOTENCY_PREFIX}${idempotencyToken}`;
    const lockScope = `${access.tenantId}:${access.companyId}`;

    return this.prisma.$transaction(
      async (lockTx) => {
        await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockScope}), hashtext(${key}))`;

        const readiness = await this.readiness.evaluate({
          tenantId: access.tenantId,
          companyId: access.companyId,
          environment: 'SANDBOX',
        });
        if (!readiness.readyToIssue) {
          throw new ConflictException({
            code: 'FISCAL_TEST_INVOICE_NOT_READY',
            blockers: readiness.reasonCodes,
          });
        }

        const created = (await this.documents.createDocument({
          tenantId: access.tenantId,
          companyId: access.companyId,
          environment: 'SANDBOX',
          type: 'INVOICE',
          receiver: dto.receiver,
          currency: dto.currency,
          exchangeRate: dto.exchangeRate,
          saleCondition: dto.saleCondition,
          creditTermDays: dto.creditTermDays,
          paymentMethod: dto.paymentMethod,
          lines: dto.lines,
          idempotencyKey: key,
          apiKeyId: access.apiKeyId,
          actor: access.actor,
        })) as { id: string; status: string };

        // createDocument is the fiscal identity idempotency boundary. A replay
        // after the first request advanced beyond allocation must return the
        // canonical execution instead of preparing/submitting the same document
        // again. READY_FOR_XML remains resumable when a prior request stopped
        // after allocation but before XML preparation.
        if (created.status !== 'READY_FOR_XML') {
          return this.status(access, created.id);
        }

        await this.prepareXml.execute({
          tenantId: access.tenantId,
          documentId: created.id,
          apiKeyId: access.apiKeyId,
          scopes: access.scopes,
          actor: access.actor,
        });
        await this.submitDocument.execute({
          tenantId: access.tenantId,
          companyId: access.companyId,
          environment: 'SANDBOX',
          documentType: 'INVOICE',
          documentId: created.id,
          apiKeyId: access.apiKeyId,
          scopes: access.scopes,
          actor: access.actor,
        });

        this.audit.record({
          tenantId: access.tenantId,
          companyId: access.companyId,
          apiKeyId: access.apiKeyId,
          actor: access.actor,
          action: 'fiscal-test-invoice.requested',
          eventClass: EventClass.FISCAL_AUDIT,
          resource: `FiscalDocument:${created.id}`,
          correlationId: created.id,
          metadata: { environment: 'SANDBOX', mode: MODE, contractVersion: CONTRACT_VERSION },
        });

        return this.status(access, created.id);
      },
      { timeout: 60_000 },
    );
  }

  async status(access: FiscalTestInvoiceAccess, documentId: string) {
    this.assertSandbox(access);
    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: documentId,
        tenantId: access.tenantId,
        companyId: access.companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        idempotencyKey: { startsWith: IDEMPOTENCY_PREFIX },
      },
      select: {
        id: true,
        clave: true,
        consecutive: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        xmlArtifacts: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            unsignedXmlSha256: true,
            signedXmlSha256: true,
            xsdValidationStatus: true,
            signedAt: true,
            signatureVerifiedAt: true,
          },
        },
        submission: {
          select: {
            id: true,
            status: true,
            attemptCount: true,
            reconciliationAttemptCount: true,
            nextAttemptAt: true,
            acceptedAt: true,
            rejectedAt: true,
            lastNormalizedErrorCode: true,
            lastSanitizedErrorMessage: true,
            lastProviderStatus: true,
            responseSha256: true,
            responseContentType: true,
            responseReceivedAt: true,
          },
        },
      },
    });
    if (!document) throw new NotFoundException({ code: 'FISCAL_TEST_INVOICE_NOT_FOUND' });

    const [artifacts, deliveries] = await Promise.all([
      this.artifacts.listArtifacts(
        {
          tenantId: access.tenantId,
          companyId: access.companyId,
          apiKeyId: access.apiKeyId,
          scopes: access.scopes,
        },
        { fiscalDocumentId: document.id, environment: 'SANDBOX', documentType: 'INVOICE' },
      ),
      this.deliveries.listDeliveries(access.tenantId, access.companyId, document.id),
    ]);

    return {
      contractVersion: CONTRACT_VERSION,
      profileVersion: PROFILE_VERSION,
      executionId: document.id,
      documentId: document.id,
      environment: 'SANDBOX',
      mode: MODE,
      disclosure: {
        consumesSandboxConsecutive: true,
        billingRequestAcceptedIsNotHaciendaAcceptance: true,
      },
      document: {
        clave: document.clave,
        consecutive: document.consecutive,
        status: document.status,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      },
      submission: document.submission
        ? {
            submissionId: document.submission.id,
            status: document.submission.status,
            haciendaAccepted: document.submission.status === 'ACCEPTED',
            attemptCount: document.submission.attemptCount,
            reconciliationAttemptCount: document.submission.reconciliationAttemptCount,
            nextAttemptAt: document.submission.nextAttemptAt,
            acceptedAt: document.submission.acceptedAt,
            rejectedAt: document.submission.rejectedAt,
            errorCode: document.submission.lastNormalizedErrorCode,
            errorMessage: document.submission.lastSanitizedErrorMessage,
            providerStatus: document.submission.lastProviderStatus,
            responseSha256: document.submission.responseSha256,
            responseContentType: document.submission.responseContentType,
            responseReceivedAt: document.submission.responseReceivedAt,
          }
        : null,
      xmlProcessing: {
        generatedXmlAvailable: Boolean(document.xmlArtifacts[0]?.unsignedXmlSha256),
        signedXmlAvailable: Boolean(document.xmlArtifacts[0]?.signedXmlSha256),
        unsignedXmlSha256: document.xmlArtifacts[0]?.unsignedXmlSha256 ?? null,
        signedXmlSha256: document.xmlArtifacts[0]?.signedXmlSha256 ?? null,
        validationStatus: document.xmlArtifacts[0]?.xsdValidationStatus ?? 'NOT_VALIDATED',
        signedAt: document.xmlArtifacts[0]?.signedAt ?? null,
        signatureVerifiedAt: document.xmlArtifacts[0]?.signatureVerifiedAt ?? null,
      },
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        downloadPath: `/api/v1/companies/${access.companyId}/fiscal-documents/SANDBOX/invoices/${document.id}/artifacts/${artifact.id}/download`,
      })),
      deliveries,
    };
  }

  private assertSandbox(access: FiscalTestInvoiceAccess) {
    if (access.environment !== 'SANDBOX' || access.apiKeyEnvironment !== 'TEST') {
      throw new ForbiddenException({ code: 'FISCAL_TEST_INVOICE_PRODUCTION_FORBIDDEN' });
    }
    if (!access.scopes.includes('invoices:write') || !access.scopes.includes('invoices:read')) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    }
  }
}
