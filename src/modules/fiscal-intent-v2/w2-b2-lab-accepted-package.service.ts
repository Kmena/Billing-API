import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../infrastructure/queue/ports/job-queue.port';
import { Inject } from '@nestjs/common';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { PrismaConsumerV2Repository } from '../fiscal-consumers/infrastructure/persistence/prisma-consumer-v2.repository';
import { GenerateFiscalPdfService } from '../fiscal-documents/application/artifacts/generate-fiscal-pdf.service';
import { AcceptedFiscalPackageResendService } from '../fiscal-documents/application/delivery/accepted-fiscal-package-resend.service';
import {
  ACCEPTED_FISCAL_PACKAGE_VERSION,
  DELIVERY_JOB_NAME,
} from '../fiscal-documents/application/delivery/delivery.constants';

/** Association-bound first delivery. The v1 resend contract remains unchanged. */
@Injectable()
export class W2B2LabAcceptedPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: PrismaConsumerV2Repository,
    private readonly pdf: GenerateFiscalPdfService,
    private readonly packages: AcceptedFiscalPackageResendService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
  ) {}

  async request(principal: ConsumerV2Principal, documentId: string) {
    if (process.env.NODE_ENV !== 'test' || principal.environment !== 'SANDBOX')
      throw new ConflictException({ code: 'W2_B2_LAB_ONLY' });
    await this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, principal, 'fiscal-v2:deliveries:request');
      const document = await tx.fiscalDocument.findFirst({
        where: {
          id: documentId,
          tenantId: principal.tenantId,
          companyId: principal.companyId,
          environment: 'SANDBOX',
          type: 'INVOICE',
          originConsumerId: principal.consumerId,
          originAssociationId: principal.associationId,
        },
        select: { id: true, status: true, submission: { select: { status: true } } },
      });
      if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
      if (document.status !== 'ACCEPTED' || document.submission?.status !== 'ACCEPTED')
        throw new ConflictException({ code: 'FISCAL_DOCUMENT_NOT_ACCEPTED' });
    });

    // Serialize first PDF generation across API instances. The renderer uses its
    // own DB connection; the advisory transaction holds only this document lock.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('spec10-package-pdf'), hashtext(${documentId}))::text`;
        await this.pdf.generateOrReuse(principal.tenantId, principal.companyId, documentId);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    const packageData = await this.packages.preflightForAuthorizedRequest({
      tenantId: principal.tenantId,
      companyId: principal.companyId,
      environment: 'SANDBOX',
      fiscalDocumentId: documentId,
    });

    const deliveryWhere = {
      tenantId: principal.tenantId,
      companyId: principal.companyId,
      fiscalDocumentId: documentId,
      kind: 'ACCEPTED_FISCAL_PACKAGE' as const,
      channel: 'EMAIL' as const,
      recipient: packageData.recipient,
      packageVersion: null,
    };
    let delivery: { id: string; status: string };
    try {
      delivery = await this.prisma.$transaction(async (tx) => {
        // Recheck association, scope and document after rendering and before writing.
        await this.consumers.assertPrincipalForScope(tx, principal, 'fiscal-v2:deliveries:request');
        const document = await tx.fiscalDocument.findFirst({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            companyId: principal.companyId,
            environment: 'SANDBOX',
            type: 'INVOICE',
            status: 'ACCEPTED',
            originConsumerId: principal.consumerId,
            originAssociationId: principal.associationId,
            submission: { status: 'ACCEPTED' },
          },
          select: { id: true },
        });
        if (!document) throw new ConflictException({ code: 'FISCAL_DOCUMENT_NOT_ACCEPTED' });
        const existing = await tx.documentDelivery.findFirst({ where: deliveryWhere });
        if (existing) return { id: existing.id, status: existing.status };
        const created = await tx.documentDelivery.create({
          data: { id: randomUUID(), ...deliveryWhere, status: 'QUEUED' },
        });
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            companyId: principal.companyId,
            apiKeyId: principal.apiKeyId,
            actor: principal.apiKeyId,
            action: 'fiscal-v2.accepted-package.requested',
            resource: `DocumentDelivery:${created.id}`,
            correlationId: documentId,
            eventClass: 'FISCAL_AUDIT',
            metadata: { associationId: principal.associationId, environment: 'SANDBOX' },
          },
        });
        return { id: created.id, status: created.status };
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      delivery = await this.prisma.$transaction(async (tx) => {
        await this.consumers.assertPrincipalForScope(tx, principal, 'fiscal-v2:deliveries:request');
        const existing = await tx.documentDelivery.findFirst({ where: deliveryWhere });
        if (!existing) throw error;
        return { id: existing.id, status: existing.status };
      });
    }
    if (!['QUEUED', 'SENDING', 'DELIVERED'].includes(delivery.status))
      throw new ConflictException({ code: 'FISCAL_DELIVERY_REVIEW_REQUIRED' });
    if (delivery.status === 'QUEUED') {
      try {
        await this.queue.publish(
          DELIVERY_JOB_NAME,
          { deliveryId: delivery.id },
          {
            retryLimit: 3,
            retryDelay: 60,
            singletonKey: `fiscal-delivery:${delivery.id}`,
            singletonSeconds: 15 * 60,
          },
        );
      } catch {
        // The committed QUEUED row remains recoverable by the delivery worker.
      }
    }
    return {
      deliveryId: delivery.id,
      status: delivery.status,
      packageVersion: ACCEPTED_FISCAL_PACKAGE_VERSION,
    };
  }
}
