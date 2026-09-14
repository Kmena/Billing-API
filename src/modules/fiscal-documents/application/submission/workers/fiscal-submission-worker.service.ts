import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../../infrastructure/queue/ports/job-queue.port';
import {
  STORAGE_PORT,
  StoragePort,
} from '../../../../../infrastructure/storage/ports/storage.port';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../../infrastructure/secrets/ports/secret-provider.port';
import {
  HACIENDA_AUTH_PORT,
  HaciendaAuthPort,
  HaciendaCredentials,
} from '../../../../hacienda-connection/domain/ports/hacienda-auth.port';
import { HaciendaTokenCache } from '../../../../hacienda-connection/infrastructure/auth/hacienda-token-cache.service';
import { mapIdentificationTypeToXmlCode } from '../../../domain/fiscal-identification.mapper';
import {
  HACIENDA_SUBMISSION_PORT,
  HaciendaPartyPayload,
  HaciendaSubmissionPort,
  HaciendaSubmissionResult,
} from '../ports/hacienda-submission.port';
import { FiscalSubmissionStateService } from '../fiscal-submission-state.service';
import { FiscalSubmissionStatus } from '../../../domain/submission';
import {
  FiscalSubmissionJobPayload,
  RECONCILE_FISCAL_SUBMISSION_JOB,
  SUBMIT_FISCAL_DOCUMENT_JOB,
} from './fiscal-submission-job.constants';

@Injectable()
export class FiscalSubmissionWorkerService implements OnModuleInit {
  private readonly logger = new Logger(FiscalSubmissionWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    @Inject(HACIENDA_AUTH_PORT) private readonly auth: HaciendaAuthPort,
    private readonly tokenCache: HaciendaTokenCache,
    @Inject(HACIENDA_SUBMISSION_PORT) private readonly hacienda: HaciendaSubmissionPort,
    private readonly state: FiscalSubmissionStateService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.jobQueue.registerHandler) return;
    await this.jobQueue.registerHandler<FiscalSubmissionJobPayload>(
      SUBMIT_FISCAL_DOCUMENT_JOB,
      (job) => this.handleSubmitJob(job.data),
    );
    await this.jobQueue.registerHandler<FiscalSubmissionJobPayload>(
      RECONCILE_FISCAL_SUBMISSION_JOB,
      (job) => this.handleReconcileJob(job.data),
    );
    await this.enqueueDueWork();
  }

  async handleSubmitJob(payload: FiscalSubmissionJobPayload): Promise<void> {
    const claimed = await this.claimSubmission(payload.submissionId, [
      'QUEUED',
      'TECHNICAL_RETRY_PENDING',
    ]);
    if (!claimed) return;

    try {
      const context = await this.loadContext(payload.submissionId);
      if (!context) return;

      const signedXml = await this.storage.download(context.submission.signedXmlStorageKey);
      this.assertHash(signedXml, context.submission.signedXmlSha256);

      const token = await this.accessToken(
        context.connection.companyId,
        context.connection.environment,
        context.connection.secretReference,
      );
      let result = await this.hacienda.submitSignedDocument({
        environment: context.connection.environment,
        accessToken: token,
        clave: context.submission.clave,
        consecutive: context.document.consecutive,
        issueDate: context.document.issueDate,
        documentType: context.document.type,
        issuer: this.partyFromSnapshot(context.document.issuerSnapshot as Record<string, unknown>),
        receiver: this.optionalPartyFromSnapshot(
          context.document.receiverSnapshot as Record<string, unknown> | null,
        ),
        signedXml,
      });

      if (result.normalizedErrorCode === 'HACIENDA_TOKEN_EXPIRED') {
        this.tokenCache.invalidate(context.connection.companyId, context.connection.environment);
        const refreshedToken = await this.accessToken(
          context.connection.companyId,
          context.connection.environment,
          context.connection.secretReference,
        );
        result = await this.hacienda.submitSignedDocument({
          environment: context.connection.environment,
          accessToken: refreshedToken,
          clave: context.submission.clave,
          consecutive: context.document.consecutive,
          issueDate: context.document.issueDate,
          documentType: context.document.type,
          issuer: this.partyFromSnapshot(
            context.document.issuerSnapshot as Record<string, unknown>,
          ),
          receiver: this.optionalPartyFromSnapshot(
            context.document.receiverSnapshot as Record<string, unknown> | null,
          ),
          signedXml,
        });
      }

      await this.state.applyProviderResult(payload.submissionId, result);
      await this.scheduleNext(payload.submissionId, result);
    } catch (error) {
      await this.handleSubmitFailure(payload.submissionId, error);
    }
  }

  async handleReconcileJob(payload: FiscalSubmissionJobPayload): Promise<void> {
    const context = await this.loadContext(payload.submissionId);
    if (
      !context ||
      context.submission.status === 'ACCEPTED' ||
      context.submission.status === 'REJECTED'
    ) {
      return;
    }

    await this.prisma.fiscalSubmission.update({
      where: { id: payload.submissionId },
      data: { reconciliationAttemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });

    const token = await this.accessToken(
      context.connection.companyId,
      context.connection.environment,
      context.connection.secretReference,
    );
    let result = await this.hacienda.queryStatusByClave({
      environment: context.connection.environment,
      accessToken: token,
      clave: context.submission.clave,
    });

    if (result.normalizedErrorCode === 'HACIENDA_TOKEN_EXPIRED') {
      this.tokenCache.invalidate(context.connection.companyId, context.connection.environment);
      const refreshedToken = await this.accessToken(
        context.connection.companyId,
        context.connection.environment,
        context.connection.secretReference,
      );
      result = await this.hacienda.queryStatusByClave({
        environment: context.connection.environment,
        accessToken: refreshedToken,
        clave: context.submission.clave,
      });
    }

    await this.state.applyProviderResult(payload.submissionId, result);
    await this.scheduleNext(payload.submissionId, result);
  }

  async enqueueDueWork(): Promise<void> {
    const due = await this.prisma.fiscalSubmission.findMany({
      where: {
        status: {
          in: [
            'QUEUED',
            'TECHNICAL_RETRY_PENDING',
            'ACKNOWLEDGED',
            'PROCESSING',
            'POST_OUTCOME_UNKNOWN',
          ],
        },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      take: 100,
    });

    const staleSubmitting = await this.prisma.fiscalSubmission.findMany({
      where: {
        status: 'SUBMITTING',
        lastAttemptAt: { lte: new Date(Date.now() - 5 * 60_000) },
      },
      take: 100,
    });

    for (const submission of [...due, ...staleSubmitting]) {
      if (submission.status === 'SUBMITTING') {
        await this.state.applyProviderResult(submission.id, {
          kind: 'RETRYABLE_FAILURE',
          nextStatus: 'TECHNICAL_RETRY_PENDING',
          normalizedErrorCode: 'FISCAL_SUBMISSION_STALE_SUBMITTING_RECOVERED',
          sanitizedErrorMessage: 'Recovered stale in-flight submission after worker restart.',
        });
      }
      const jobName = ['ACKNOWLEDGED', 'PROCESSING', 'POST_OUTCOME_UNKNOWN'].includes(
        submission.status,
      )
        ? RECONCILE_FISCAL_SUBMISSION_JOB
        : SUBMIT_FISCAL_DOCUMENT_JOB;
      await this.jobQueue.publish(
        jobName,
        { submissionId: submission.id },
        { retryLimit: 3, retryDelay: 60 },
      );
    }
  }

  private async handleSubmitFailure(submissionId: string, error: unknown): Promise<void> {
    this.logger.warn(
      { submissionId, error: error instanceof Error ? error.message : 'Unknown submit failure' },
      'Fiscal submission submit job failed before a durable provider result was applied',
    );
    const result: HaciendaSubmissionResult = {
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      normalizedErrorCode: 'FISCAL_SUBMISSION_WORKER_FAILURE',
      sanitizedErrorMessage:
        'Fiscal submission worker failed before provider outcome was confirmed.',
    };
    await this.state.applyProviderResult(submissionId, result);
    await this.scheduleNext(submissionId, result);
  }

  private async claimSubmission(submissionId: string, expectedStatuses: FiscalSubmissionStatus[]) {
    const update = await this.prisma.fiscalSubmission.updateMany({
      where: { id: submissionId, status: { in: expectedStatuses } },
      data: { status: 'SUBMITTING', attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
    return update.count === 1;
  }

  private async loadContext(submissionId: string) {
    const submission = await this.prisma.fiscalSubmission.findUnique({
      where: { id: submissionId },
      include: { fiscalDocument: true },
    });
    if (!submission) return null;

    const connection = await this.prisma.haciendaConnection.findFirst({
      where: {
        tenantId: submission.tenantId,
        companyId: submission.companyId,
        environment: submission.environment,
        status: 'CONNECTED',
      },
    });
    if (!connection) {
      await this.state.applyProviderResult(submissionId, {
        kind: 'NON_RETRYABLE_FAILURE',
        nextStatus: 'MANUAL_REVIEW_REQUIRED',
        normalizedErrorCode: 'HACIENDA_CONNECTION_NOT_CONNECTED',
        sanitizedErrorMessage: 'Hacienda connection is not enabled for submission.',
      });
      return null;
    }

    return { submission, document: submission.fiscalDocument, connection };
  }

  private async accessToken(
    companyId: string,
    environment: 'SANDBOX' | 'PRODUCTION',
    secretReference: string,
  ): Promise<string> {
    const cached = this.tokenCache.getToken(companyId, environment);
    if (cached) return cached;

    const credentials = JSON.parse(
      await this.secrets.getSecret(secretReference),
    ) as HaciendaCredentials;
    const token = await this.auth.authenticate(credentials, environment);
    this.tokenCache.setToken(companyId, environment, token);
    return token.accessToken;
  }

  private assertHash(content: Buffer, expectedSha256: string): void {
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== expectedSha256) throw new Error('Signed XML hash mismatch.');
  }

  private partyFromSnapshot(snapshot: Record<string, unknown>): HaciendaPartyPayload {
    return {
      identification: {
        type: mapIdentificationTypeToXmlCode(String(snapshot.identificationType)),
        number: String(snapshot.identificationNumber),
      },
    };
  }

  private optionalPartyFromSnapshot(
    snapshot: Record<string, unknown> | null,
  ): HaciendaPartyPayload | undefined {
    if (!snapshot?.identificationType || !snapshot.identificationNumber) return undefined;
    return this.partyFromSnapshot(snapshot);
  }

  private async scheduleNext(
    submissionId: string,
    result: HaciendaSubmissionResult,
  ): Promise<void> {
    if (
      result.nextStatus === 'ACKNOWLEDGED' ||
      result.nextStatus === 'PROCESSING' ||
      result.nextStatus === 'POST_OUTCOME_UNKNOWN'
    ) {
      await this.jobQueue.publish(
        RECONCILE_FISCAL_SUBMISSION_JOB,
        { submissionId },
        { retryLimit: 3, retryDelay: 60, startAfterSeconds: 60 },
      );
      return;
    }

    if (result.nextStatus === 'TECHNICAL_RETRY_PENDING') {
      await this.jobQueue.publish(
        SUBMIT_FISCAL_DOCUMENT_JOB,
        { submissionId },
        {
          retryLimit: 3,
          retryDelay: 60,
          startAfterSeconds: result.rateLimit?.retryAfterSeconds ?? 60,
        },
      );
    }
  }
}
