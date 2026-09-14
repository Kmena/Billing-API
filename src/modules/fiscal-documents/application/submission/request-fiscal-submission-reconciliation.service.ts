import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../../domain/fiscal.constants';
import { FiscalSubmissionStateMachine } from '../../domain/submission';
import { RECONCILE_FISCAL_SUBMISSION_JOB } from './workers/fiscal-submission-job.constants';
import { FiscalSubmissionResponse } from './fiscal-submission-response';

@Injectable()
export class RequestFiscalSubmissionReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
  ) {}

  async execute(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly environment: HaciendaEnvironment;
    readonly documentType: FiscalDocumentType;
    readonly documentId: string;
    readonly apiKeyId: string;
    readonly scopes: string[];
  }): Promise<FiscalSubmissionResponse> {
    this.assertScope(input.documentType, input.scopes);
    await this.assertApiKeyCompany(input.apiKeyId, input.companyId);

    const submission = await this.prisma.fiscalSubmission.findFirst({
      where: {
        fiscalDocumentId: input.documentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        documentType: input.documentType,
      },
    });

    if (!submission) throw new NotFoundException({ code: 'FISCAL_SUBMISSION_NOT_FOUND' });
    if (FiscalSubmissionStateMachine.isTerminal(submission.status)) {
      throw new ConflictException({ code: 'FISCAL_SUBMISSION_ALREADY_TERMINAL' });
    }

    const updated = await this.prisma.fiscalSubmission.update({
      where: { id: submission.id },
      data: {
        nextAttemptAt: new Date(),
        lastNormalizedErrorCode: null,
        lastSanitizedErrorMessage: null,
      },
    });

    await this.jobQueue.publish(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      { submissionId: updated.id },
      { retryLimit: 3, retryDelay: 60 },
    );

    return {
      documentId: updated.fiscalDocumentId,
      submissionId: updated.id,
      clave: updated.clave,
      environment: updated.environment,
      status: updated.status,
      attemptCount: updated.attemptCount,
      reconciliationAttemptCount: updated.reconciliationAttemptCount,
      nextAttemptAt: updated.nextAttemptAt,
      acceptedAt: updated.acceptedAt,
      rejectedAt: updated.rejectedAt,
      lastNormalizedErrorCode: updated.lastNormalizedErrorCode,
      lastSanitizedErrorMessage: updated.lastSanitizedErrorMessage,
      lastProviderStatus: updated.lastProviderStatus,
      responseSha256: updated.responseSha256,
      responseContentType: updated.responseContentType,
      responseReceivedAt: updated.responseReceivedAt,
    };
  }

  private assertScope(documentType: FiscalDocumentType, scopes: string[]): void {
    const requiredScope = documentType === 'INVOICE' ? 'invoices:write' : 'tickets:write';
    if (!scopes.includes(requiredScope))
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
  }

  private async assertApiKeyCompany(apiKeyId: string, companyId: string): Promise<void> {
    const link = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId, companyId } },
    });
    if (!link) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_ALLOWED' });
  }
}
