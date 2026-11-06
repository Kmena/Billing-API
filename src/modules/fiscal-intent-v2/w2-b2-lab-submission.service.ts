import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../infrastructure/queue/ports/job-queue.port';
import { PrismaConsumerV2Repository } from '../fiscal-consumers/infrastructure/persistence/prisma-consumer-v2.repository';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { SUBMIT_FISCAL_DOCUMENT_JOB } from '../fiscal-documents/application/submission/workers/fiscal-submission-job.constants';

/** Explicitly registered only in the isolated SANDBOX v2 module. */
@Injectable()
export class W2B2LabSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: PrismaConsumerV2Repository,
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
  ) {}

  private assertLab(principal: ConsumerV2Principal): void {
    if (process.env.NODE_ENV !== 'test' || principal.environment !== 'SANDBOX')
      throw new ConflictException({ code: 'W2_B2_LAB_ONLY' });
  }

  async submit(principal: ConsumerV2Principal, documentId: string, correlationId: string) {
    this.assertLab(principal);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, principal, 'fiscal-v2:invoices:submit');
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
        include: { xmlArtifacts: true, submission: true },
      });
      if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
      const existing = document.submission;
      if (!existing && document.status !== 'READY_TO_SUBMIT')
        throw new ConflictException({ code: 'FISCAL_DOCUMENT_NOT_READY_TO_SUBMIT' });
      const artifact = document.xmlArtifacts[0];
      if (!existing && (!artifact?.signedXmlStorageKey || !artifact.signedXmlSha256))
        throw new BadRequestException({ code: 'SIGNED_XML_ARTIFACT_REQUIRED' });
      const connection = await tx.haciendaConnection.findFirst({
        where: {
          tenantId: principal.tenantId,
          companyId: principal.companyId,
          environment: 'SANDBOX',
          status: 'CONNECTED',
        },
        select: { id: true },
      });
      if (!connection) throw new ConflictException({ code: 'HACIENDA_CONNECTION_NOT_CONNECTED' });
      const submission =
        existing ??
        (await tx.fiscalSubmission.upsert({
          where: { fiscalDocumentId: document.id },
          update: {},
          create: {
            id: randomUUID(),
            fiscalDocumentId: document.id,
            tenantId: document.tenantId,
            companyId: document.companyId,
            environment: 'SANDBOX',
            documentType: 'INVOICE',
            clave: document.clave,
            signedXmlSha256: artifact!.signedXmlSha256!,
            signedXmlStorageKey: artifact!.signedXmlStorageKey!,
            status: 'REQUESTED',
            nextAttemptAt: new Date(),
          },
        }));
      if (submission.status === 'REQUESTED') {
        const advanced = await tx.fiscalSubmission.updateMany({
          where: { id: submission.id, status: 'REQUESTED' },
          data: {
            status: 'QUEUED',
            nextAttemptAt: new Date(),
          },
        });
        if (advanced.count === 1)
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              companyId: principal.companyId,
              apiKeyId: principal.apiKeyId,
              actor: principal.apiKeyId,
              action: 'fiscal-v2.submission.requested',
              resource: `FiscalSubmission:${submission.id}`,
              correlationId,
              eventClass: 'FISCAL_AUDIT',
              metadata: {
                associationId: principal.associationId,
                environment: 'SANDBOX',
                documentId,
              },
            },
          });
      }
      return {
        documentId,
        submissionId: submission.id,
        status: submission.status === 'REQUESTED' ? 'QUEUED' : submission.status,
        environment: 'SANDBOX' as const,
      };
    });
    if (result.status === 'QUEUED') {
      // The durable submission row survives a queue outage; worker recovery re-enqueues it.
      try {
        await this.queue.publish(
          SUBMIT_FISCAL_DOCUMENT_JOB,
          { submissionId: result.submissionId },
          {
            retryLimit:
              process.env.NODE_ENV === 'test' &&
              process.env.BILLING_SPEC09_STAG_INVOICING === 'true' &&
              process.env.SPEC10_SINGLE_STAG_POST === 'true'
                ? 0
                : 3,
            retryDelay: 60,
            singletonKey: `fiscal-submission:${SUBMIT_FISCAL_DOCUMENT_JOB}:${result.submissionId}`,
            singletonSeconds: 12 * 60 * 60,
          },
        );
      } catch {
        /* Recovery worker scans durable QUEUED submissions. */
      }
    }
    return result;
  }

  async status(principal: ConsumerV2Principal, documentId: string) {
    this.assertLab(principal);
    return this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, principal, 'fiscal-v2:operations:read');
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
        select: { id: true },
      });
      if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
      const submission = await tx.fiscalSubmission.findUnique({
        where: { fiscalDocumentId: documentId },
        select: { id: true, status: true, lastNormalizedErrorCode: true },
      });
      if (!submission) throw new NotFoundException({ code: 'FISCAL_SUBMISSION_NOT_FOUND' });
      return {
        documentId,
        submissionId: submission.id,
        status: submission.status,
        environment: 'SANDBOX' as const,
        lastErrorCode: submission.lastNormalizedErrorCode,
      };
    });
  }
}
