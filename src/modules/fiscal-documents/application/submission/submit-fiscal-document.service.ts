import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../../domain/fiscal.constants';
import { FiscalSubmissionResponse } from './fiscal-submission-response';
import {
  RECONCILE_FISCAL_SUBMISSION_JOB,
  SUBMIT_FISCAL_DOCUMENT_JOB,
} from './workers/fiscal-submission-job.constants';

export interface SubmitFiscalDocumentInput {
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly documentId: string;
  readonly apiKeyId: string;
  readonly scopes: string[];
  readonly actor?: string;
}

export interface SubmitFiscalDocumentResult extends FiscalSubmissionResponse {
  readonly jobName: string;
}

@Injectable()
export class SubmitFiscalDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
  ) {}

  async execute(input: SubmitFiscalDocumentInput): Promise<SubmitFiscalDocumentResult> {
    this.assertScope(input.documentType, input.scopes);
    await this.assertApiKeyCompany(input.apiKeyId, input.companyId);

    const connection = await this.prisma.haciendaConnection.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        status: 'CONNECTED',
      },
    });

    if (!connection) {
      throw new ConflictException({ code: 'HACIENDA_CONNECTION_NOT_CONNECTED' });
    }

    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: input.documentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        type: input.documentType,
      },
      include: { xmlArtifacts: true, submission: true },
    });

    if (!document) {
      throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
    }

    if (document.status !== 'READY_TO_SUBMIT') {
      throw new ConflictException({ code: 'FISCAL_DOCUMENT_NOT_READY_TO_SUBMIT' });
    }

    const artifact = document.xmlArtifacts[0];
    if (!artifact?.signedXmlStorageKey || !artifact.signedXmlSha256) {
      throw new BadRequestException({ code: 'SIGNED_XML_ARTIFACT_REQUIRED' });
    }

    const existing = document.submission;
    const submission = existing ?? (await this.createOrLoadSubmission(document, artifact));

    if (submission.status === 'ACCEPTED' || submission.status === 'REJECTED') {
      return { ...this.toResponse(submission), jobName: SUBMIT_FISCAL_DOCUMENT_JOB };
    }

    const jobName = this.jobNameForSubmissionStatus(submission.status);
    const queuedSubmission = await this.markQueuedWhenSafeToSubmit(submission);

    if (jobName) {
      await this.jobQueue.publish(
        jobName,
        { submissionId: queuedSubmission.id },
        { retryLimit: 3, retryDelay: 60 },
      );
    }

    this.auditService.record({
      tenantId: input.tenantId,
      companyId: input.companyId,
      apiKeyId: input.apiKeyId,
      actor: input.actor,
      action: 'fiscal-submission.requested',
      eventClass: EventClass.TECHNICAL,
      resource: `FiscalSubmission:${queuedSubmission.id}`,
      correlationId: document.id,
      metadata: {
        documentId: document.id,
        environment: document.environment,
        status: queuedSubmission.status,
      },
    });

    return { ...this.toResponse(queuedSubmission), jobName: jobName ?? SUBMIT_FISCAL_DOCUMENT_JOB };
  }

  private jobNameForSubmissionStatus(status: string): string | null {
    if (status === 'ACKNOWLEDGED' || status === 'PROCESSING' || status === 'POST_OUTCOME_UNKNOWN') {
      return RECONCILE_FISCAL_SUBMISSION_JOB;
    }
    if (status === 'SUBMITTING') return null;
    return SUBMIT_FISCAL_DOCUMENT_JOB;
  }

  private async markQueuedWhenSafeToSubmit(submission: { id: string; status: string }) {
    if (this.jobNameForSubmissionStatus(submission.status) !== SUBMIT_FISCAL_DOCUMENT_JOB) {
      return this.prisma.fiscalSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    }

    return this.prisma.fiscalSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'QUEUED',
        nextAttemptAt: new Date(),
        lastNormalizedErrorCode: null,
        lastSanitizedErrorMessage: null,
      },
    });
  }

  private async createOrLoadSubmission(
    document: {
      id: string;
      tenantId: string;
      companyId: string;
      environment: HaciendaEnvironment;
      type: FiscalDocumentType;
      clave: string;
    },
    artifact: { signedXmlSha256: string | null; signedXmlStorageKey: string | null },
  ) {
    try {
      return await this.prisma.fiscalSubmission.create({
        data: {
          id: randomUUID(),
          fiscalDocumentId: document.id,
          tenantId: document.tenantId,
          companyId: document.companyId,
          environment: document.environment,
          documentType: document.type,
          clave: document.clave,
          signedXmlSha256: artifact.signedXmlSha256!,
          signedXmlStorageKey: artifact.signedXmlStorageKey!,
          status: 'REQUESTED',
          nextAttemptAt: new Date(),
        },
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.prisma.fiscalSubmission.findUnique({
          where: { fiscalDocumentId: document.id },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private toResponse(submission: {
    id: string;
    fiscalDocumentId: string;
    clave: string;
    environment: HaciendaEnvironment;
    status: string;
    attemptCount: number;
    reconciliationAttemptCount: number;
    nextAttemptAt: Date | null;
    acceptedAt: Date | null;
    rejectedAt: Date | null;
    lastNormalizedErrorCode: string | null;
    lastSanitizedErrorMessage: string | null;
    lastProviderStatus: string | null;
    responseSha256: string | null;
    responseContentType: string | null;
    responseReceivedAt: Date | null;
  }): FiscalSubmissionResponse {
    return {
      documentId: submission.fiscalDocumentId,
      submissionId: submission.id,
      clave: submission.clave,
      environment: submission.environment,
      status: submission.status,
      attemptCount: submission.attemptCount,
      reconciliationAttemptCount: submission.reconciliationAttemptCount,
      nextAttemptAt: submission.nextAttemptAt,
      acceptedAt: submission.acceptedAt,
      rejectedAt: submission.rejectedAt,
      lastNormalizedErrorCode: submission.lastNormalizedErrorCode,
      lastSanitizedErrorMessage: submission.lastSanitizedErrorMessage,
      lastProviderStatus: submission.lastProviderStatus,
      responseSha256: submission.responseSha256,
      responseContentType: submission.responseContentType,
      responseReceivedAt: submission.responseReceivedAt,
    };
  }

  private assertScope(documentType: FiscalDocumentType, scopes: string[]): void {
    const requiredScope = documentType === 'INVOICE' ? 'invoices:write' : 'tickets:write';
    if (!scopes.includes(requiredScope)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    }
  }

  private async assertApiKeyCompany(apiKeyId: string, companyId: string): Promise<void> {
    const link = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId, companyId } },
    });
    if (!link) {
      throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_ALLOWED' });
    }
  }
}
