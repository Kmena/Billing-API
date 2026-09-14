import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { HaciendaSubmissionResult } from './ports/hacienda-submission.port';
import { FiscalSubmissionStateMachine, FiscalSubmissionStatus } from '../../domain/submission';

@Injectable()
export class FiscalSubmissionStateService {
  private readonly logger = new Logger(FiscalSubmissionStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async applyProviderResult(submissionId: string, result: HaciendaSubmissionResult): Promise<void> {
    const submission = await this.prisma.fiscalSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) return;

    const nextStatus = result.nextStatus;
    const transition = FiscalSubmissionStateMachine.evaluateTransition(
      submission.status,
      nextStatus,
    );

    if (transition.outcome === 'IGNORED_STALE_TERMINAL') {
      this.logger.warn(
        { submissionId, currentStatus: submission.status, attemptedStatus: nextStatus },
        'Ignored stale fiscal submission transition',
      );
      return;
    }

    if (transition.outcome === 'REJECTED') {
      await this.prisma.fiscalSubmission.update({
        where: { id: submissionId },
        data: {
          lastNormalizedErrorCode:
            result.normalizedErrorCode ?? 'FISCAL_SUBMISSION_INVALID_TRANSITION',
          lastSanitizedErrorMessage: transition.reason,
        },
      });
      return;
    }

    const artifactMetadata = await this.storeResponseArtifactIfPresent(submission, result);
    const now = new Date();
    const terminal = nextStatus === 'ACCEPTED' || nextStatus === 'REJECTED';

    await this.prisma.$transaction(async (tx) => {
      const update = await tx.fiscalSubmission.updateMany({
        where: {
          id: submissionId,
          status: { notIn: ['ACCEPTED', 'REJECTED'] },
        },
        data: {
          status: nextStatus,
          lastHttpStatus: result.httpStatus ?? null,
          providerLocation: result.providerLocation ?? submission.providerLocation,
          providerReference: result.providerReference ?? submission.providerReference,
          lastProviderStatus: result.providerStatus ?? submission.lastProviderStatus,
          lastNormalizedErrorCode: result.normalizedErrorCode ?? null,
          lastSanitizedErrorMessage: result.sanitizedErrorMessage ?? null,
          lastProviderMetadata: (result.providerMetadata ?? result.rateLimit ?? undefined) as
            Record<string, string | number | boolean | null> | undefined,
          nextAttemptAt: this.nextAttemptAt(nextStatus, result.rateLimit?.retryAfterSeconds),
          acceptedAt: nextStatus === 'ACCEPTED' ? now : submission.acceptedAt,
          rejectedAt: nextStatus === 'REJECTED' ? now : submission.rejectedAt,
          responseStorageKey: artifactMetadata?.storageKey ?? submission.responseStorageKey,
          responseSha256: artifactMetadata?.sha256 ?? submission.responseSha256,
          responseContentType: artifactMetadata?.contentType ?? submission.responseContentType,
          responseReceivedAt: artifactMetadata ? now : submission.responseReceivedAt,
        },
      });

      if (update.count === 0) return;

      if (terminal) {
        await tx.fiscalDocument.updateMany({
          where: { id: submission.fiscalDocumentId, status: { notIn: ['ACCEPTED', 'REJECTED'] } },
          data: { status: nextStatus },
        });
      }
    });

    this.auditService.record({
      tenantId: submission.tenantId,
      companyId: submission.companyId,
      action: this.auditAction(nextStatus),
      eventClass: terminal ? EventClass.FISCAL_AUDIT : EventClass.TECHNICAL,
      resource: `FiscalSubmission:${submissionId}`,
      correlationId: submission.fiscalDocumentId,
      metadata: {
        documentId: submission.fiscalDocumentId,
        clave: submission.clave,
        environment: submission.environment,
        status: nextStatus,
        providerStatus: result.providerStatus,
        httpStatus: result.httpStatus,
      },
    });
  }

  private async storeResponseArtifactIfPresent(
    submission: {
      id: string;
      tenantId: string;
      companyId: string;
      environment: string;
      clave: string;
    },
    result: HaciendaSubmissionResult,
  ): Promise<{ storageKey: string; sha256: string; contentType: string } | null> {
    if (!result.responseArtifact) return null;

    const sha256 = createHash('sha256').update(result.responseArtifact.content).digest('hex');
    const storageKey = `fiscal-submissions/${submission.tenantId}/${submission.companyId}/${submission.environment}/${submission.clave}/hacienda-response.xml`;
    await this.storage.upload(storageKey, result.responseArtifact.content, {
      contentType: result.responseArtifact.contentType,
      sha256,
      clave: submission.clave,
      submissionId: submission.id,
    });

    return { storageKey, sha256, contentType: result.responseArtifact.contentType };
  }

  private nextAttemptAt(status: FiscalSubmissionStatus, retryAfterSeconds?: number): Date | null {
    if (status === 'PROCESSING' || status === 'ACKNOWLEDGED' || status === 'POST_OUTCOME_UNKNOWN') {
      return new Date(Date.now() + 60_000);
    }
    if (status === 'TECHNICAL_RETRY_PENDING') {
      return new Date(Date.now() + (retryAfterSeconds ?? 60) * 1000);
    }
    return null;
  }

  private auditAction(status: FiscalSubmissionStatus): string {
    return `fiscal-submission.${status.toLowerCase().replace(/_/g, '-')}`;
  }
}
