import { ForbiddenException, Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { DomainException } from '../../../shared/domain/domain-exception';
import {
  ArtifactIntegrityException,
  ArtifactNotFoundException,
  FiscalEvidenceResolverService,
} from '../artifacts/fiscal-evidence-resolver.service';
import {
  FiscalPdfArtifactPolicyException,
  FiscalPdfArtifactStateService,
} from '../artifacts/fiscal-pdf-artifact-state.service';
import { parseMensajeHacienda } from '../../infrastructure/submission/hacienda-mensajehacienda-parser';
import { EmailAttachment } from '../email/email-delivery.port';
import {
  ACCEPTED_FISCAL_PACKAGE_VERSION,
  DEFAULT_ACCEPTED_PACKAGE_RESEND_COOLDOWN_SECONDS,
  DELIVERY_JOB_NAME,
} from './delivery.constants';
import { resolveDeliveryRecipient } from './delivery-recipient.resolver';

export class AcceptedPackageResendException extends DomainException {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AcceptedPackageResendCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: 'SANDBOX' | 'PRODUCTION';
  readonly fiscalDocumentId: string;
  readonly apiKeyId: string;
  readonly apiKeyPrefix: string;
}

export interface AcceptedPackagePreflight {
  readonly recipient: string;
  readonly recipientDomain: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly attachments: readonly EmailAttachment[];
}

@Injectable()
export class AcceptedFiscalPackageResendService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    private readonly evidenceResolver: FiscalEvidenceResolverService,
    private readonly artifactState: FiscalPdfArtifactStateService,
    private readonly auditService: AuditService,
  ) {}

  async request(command: AcceptedPackageResendCommand) {
    await this.assertApiKeyCompany(command.apiKeyId, command.companyId);
    const packageData = await this.preflight({
      tenantId: command.tenantId,
      companyId: command.companyId,
      environment: command.environment,
      fiscalDocumentId: command.fiscalDocumentId,
    });
    const requestedAt = new Date();
    const delivery = await this.claimDelivery(command, packageData.recipient, requestedAt);

    try {
      await this.jobQueue.publish(
        DELIVERY_JOB_NAME,
        { deliveryId: delivery.id },
        {
          retryLimit: 3,
          retryDelay: 60,
          singletonKey: `fiscal-delivery:${delivery.id}`,
          singletonSeconds: 15 * 60,
        },
      );
    } catch (error: unknown) {
      await this.prisma.documentDelivery.updateMany({
        where: { id: delivery.id, status: 'QUEUED' },
        data: {
          lastErrorCode: 'QUEUE_PUBLICATION_FAILED',
          lastSanitizedError: String(error).substring(0, 500),
          updatedAt: new Date(),
        },
      });
      // The request remains durably queued; recovery owns later publication.
    }
    this.auditService.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      actor: `apiKey:${command.apiKeyPrefix}`,
      action: 'fiscal-delivery.accepted-package-resend-requested',
      eventClass: EventClass.FISCAL_AUDIT,
      resource: `DocumentDelivery:${delivery.id}`,
      correlationId: command.fiscalDocumentId,
      metadata: {
        apiKeyId: command.apiKeyId,
        fiscalDocumentId: command.fiscalDocumentId,
        deliveryId: delivery.id,
        packageVersion: ACCEPTED_FISCAL_PACKAGE_VERSION,
        recipientDomain: packageData.recipientDomain,
      },
    });

    return {
      deliveryId: delivery.id,
      status: 'QUEUED' as const,
      packageVersion: ACCEPTED_FISCAL_PACKAGE_VERSION,
      requestedAt: requestedAt.toISOString(),
      recipientDomain: packageData.recipientDomain,
    };
  }

  /** Revalidates all immutable bytes immediately before the worker sends email. */
  async preflightForWorker(input: {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    recipient: string;
  }): Promise<AcceptedPackagePreflight> {
    const result = await this.preflight(input);
    if (result.recipient !== input.recipient) {
      throw new AcceptedPackageResendException(
        'FISCAL_DELIVERY_RECIPIENT_MISSING',
        422,
        'The canonical fiscal recipient no longer matches the delivery record.',
      );
    }
    return result;
  }

  private async preflight(input: {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    environment?: 'SANDBOX' | 'PRODUCTION';
  }): Promise<AcceptedPackagePreflight> {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: input.fiscalDocumentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        ...(input.environment ? { environment: input.environment } : {}),
        type: 'INVOICE',
      },
      select: {
        id: true,
        tenantId: true,
        companyId: true,
        type: true,
        status: true,
        clave: true,
        consecutive: true,
        receiverSnapshot: true,
        disposedAt: true,
        supersededByFiscalDocumentId: true,
      },
    });
    if (!document) {
      throw new AcceptedPackageResendException(
        'FISCAL_DOCUMENT_NOT_FOUND',
        404,
        'Fiscal document not found.',
      );
    }
    if (
      document.status === 'SUPERSEDED' ||
      document.supersededByFiscalDocumentId !== null ||
      document.disposedAt !== null
    ) {
      throw new AcceptedPackageResendException(
        'FISCAL_DOCUMENT_SUPERSEDED',
        422,
        'Superseded fiscal documents cannot be resent.',
      );
    }
    if (document.status !== 'ACCEPTED') {
      throw new AcceptedPackageResendException(
        'FISCAL_DOCUMENT_NOT_ACCEPTED',
        422,
        'Only accepted fiscal documents can be resent.',
      );
    }

    const recipientResolution = resolveDeliveryRecipient(document.receiverSnapshot);
    if (recipientResolution.kind !== 'RESOLVED') {
      throw new AcceptedPackageResendException(
        recipientResolution.code,
        422,
        this.recipientResolutionMessage(recipientResolution.kind),
      );
    }
    const recipient = recipientResolution.recipient;

    try {
      const pdfArtifact = await this.prisma.fiscalArtifact.findFirst({
        where: {
          tenantId: document.tenantId,
          companyId: document.companyId,
          fiscalDocumentId: document.id,
          type: 'PDF',
          supersededAt: null,
        },
      });
      const pdf = this.artifactState.requireCurrent(
        await this.artifactState.assess(pdfArtifact, {
          documentType: document.type,
          clave: document.clave,
          consecutive: document.consecutive,
        }),
      );
      const signedXml = await this.evidenceResolver.resolveSignedXmlBytes(
        document.tenantId,
        document.companyId,
        document.id,
      );
      const responseXml = await this.evidenceResolver.resolveHaciendaResponseBytes(
        document.tenantId,
        document.companyId,
        document.id,
      );
      const parsed = parseMensajeHacienda(responseXml.bytes);
      if (parsed.parseError || parsed.diagnostic.mensaje !== '1') {
        throw new AcceptedPackageResendException(
          'FISCAL_DELIVERY_HACIENDA_RESPONSE_UNAVAILABLE',
          422,
          'The authoritative Hacienda response is not accepted.',
        );
      }
      return {
        recipient,
        recipientDomain: recipient.split('@')[1] ?? 'unknown',
        clave: document.clave,
        consecutive: document.consecutive,
        attachments: [
          { filename: `${document.clave}.pdf`, content: pdf, contentType: 'application/pdf' },
          {
            filename: `${document.clave}.xml`,
            content: signedXml.bytes,
            contentType: signedXml.contentType,
          },
          {
            filename: `${document.clave}_respuesta.xml`,
            content: responseXml.bytes,
            contentType: responseXml.contentType,
          },
        ],
      };
    } catch (error) {
      if (error instanceof AcceptedPackageResendException) throw error;
      if (error instanceof ArtifactNotFoundException) {
        const code =
          error.artifactType === 'SIGNED_XML'
            ? 'FISCAL_DELIVERY_SIGNED_XML_UNAVAILABLE'
            : error.artifactType === 'HACIENDA_RESPONSE_XML'
              ? 'FISCAL_DELIVERY_HACIENDA_RESPONSE_UNAVAILABLE'
              : 'FISCAL_DELIVERY_PDF_UNAVAILABLE';
        throw new AcceptedPackageResendException(
          code,
          422,
          'Required fiscal artifact is unavailable.',
        );
      }
      if (
        error instanceof ArtifactIntegrityException ||
        error instanceof FiscalPdfArtifactPolicyException
      ) {
        throw new AcceptedPackageResendException(
          'FISCAL_DELIVERY_ARTIFACT_VALIDATION_FAILED',
          422,
          'Fiscal artifact validation failed.',
        );
      }
      throw error;
    }
  }

  private async claimDelivery(
    command: AcceptedPackageResendCommand,
    recipient: string,
    requestedAt: Date,
  ): Promise<{ id: string }> {
    const where = {
      tenantId: command.tenantId,
      companyId: command.companyId,
      fiscalDocumentId: command.fiscalDocumentId,
      kind: 'ACCEPTED_FISCAL_PACKAGE' as const,
      channel: 'EMAIL' as const,
      recipient,
      packageVersion: null,
    };
    let delivery = await this.prisma.documentDelivery.findFirst({ where });
    if (!delivery) {
      try {
        return await this.prisma.documentDelivery.create({
          data: { id: randomUUID(), ...where, status: 'QUEUED', updatedAt: requestedAt },
          select: { id: true },
        });
      } catch (error: unknown) {
        const code = (error as { code?: string }).code;
        if (code !== 'P2002') throw error;
        delivery = await this.prisma.documentDelivery.findFirst({ where });
        if (!delivery) throw error;
      }
    }

    if (
      delivery.status === 'QUEUED' ||
      delivery.status === 'SENDING' ||
      delivery.status === 'RETRY_PENDING'
    ) {
      throw new AcceptedPackageResendException(
        'FISCAL_DELIVERY_ALREADY_IN_PROGRESS',
        409,
        'Accepted fiscal package delivery is already in progress.',
      );
    }
    if (delivery.status === 'CANCELLED') {
      throw new AcceptedPackageResendException(
        'FISCAL_DELIVERY_ALREADY_IN_PROGRESS',
        409,
        'Cancelled accepted fiscal package deliveries cannot be resent.',
      );
    }
    const cooldownSeconds = this.cooldownSeconds();
    if (
      delivery.status === 'DELIVERED' &&
      delivery.deliveredAt &&
      delivery.deliveredAt.getTime() > requestedAt.getTime() - cooldownSeconds * 1000
    ) {
      throw new AcceptedPackageResendException(
        'FISCAL_DELIVERY_RESEND_THROTTLED',
        429,
        'Accepted fiscal package resend is cooling down.',
      );
    }
    const updated = await this.prisma.documentDelivery.updateMany({
      where: {
        id: delivery.id,
        status: { in: ['DELIVERED', 'FAILED', 'MANUAL_REVIEW_REQUIRED', 'PENDING'] },
      },
      data: {
        status: 'QUEUED',
        nextAttemptAt: null,
        lastErrorCode: null,
        lastSanitizedError: null,
        updatedAt: requestedAt,
      },
    });
    if (updated.count !== 1) {
      throw new AcceptedPackageResendException(
        'FISCAL_DELIVERY_ALREADY_IN_PROGRESS',
        409,
        'Accepted fiscal package delivery changed concurrently.',
      );
    }
    return { id: delivery.id };
  }

  private async assertApiKeyCompany(apiKeyId: string, companyId: string): Promise<void> {
    const binding = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId, companyId } },
    });
    if (!binding) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_ALLOWED' });
  }

  private recipientResolutionMessage(kind: 'MISSING' | 'INVALID' | 'CONFLICT'): string {
    if (kind === 'CONFLICT') return 'Fiscal recipient fields conflict.';
    if (kind === 'INVALID') return 'Fiscal recipient email is invalid.';
    return 'Accepted fiscal package has no canonical recipient.';
  }

  private cooldownSeconds(): number {
    const value = Number(process.env.FISCAL_ACCEPTED_PACKAGE_RESEND_COOLDOWN_SECONDS);
    return Number.isInteger(value) && value >= 0
      ? value
      : DEFAULT_ACCEPTED_PACKAGE_RESEND_COOLDOWN_SECONDS;
  }
}
