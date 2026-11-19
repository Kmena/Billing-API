import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { FiscalSubmissionStateMachine, FiscalSubmissionStatus } from '../../../domain/submission';
import { correctiveStagAllowed } from '../../../domain/corrective-stag-gate';
import {
  FiscalSubmissionJobPayload,
  RECONCILE_FISCAL_SUBMISSION_JOB,
  SUBMIT_FISCAL_DOCUMENT_JOB,
} from './fiscal-submission-job.constants';

@Injectable()
export class FiscalSubmissionWorkerService implements OnModuleInit, OnModuleDestroy {
  private static readonly RECOVERY_INTERVAL_MS = 60_000;
  private readonly logger = new Logger(FiscalSubmissionWorkerService.name);
  private recoveryTimer: NodeJS.Timeout | null = null;

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
    if (this.shouldDisableAutoStartInTests()) {
      this.logger.warn(
        'Fiscal submission worker auto-start disabled under test runtime; set FISCAL_WORKER_ENABLE_IN_TESTS=true to opt in.',
      );
      return;
    }
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
    this.startRecoveryTimer();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private shouldDisableAutoStartInTests(): boolean {
    const isTestRuntime = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
    return isTestRuntime && process.env.FISCAL_WORKER_ENABLE_IN_TESTS !== 'true';
  }

  private singlePostStagTest(): boolean {
    const scopedInstalledStag =
      /^[0-9a-f-]{36}$/i.test(process.env.BILLING_STAG_ALLOWED_COMPANY_ID ?? '') &&
      process.env.USE_REAL_HACIENDA === 'true' &&
      process.env.EMAIL_USE_REAL === 'false' &&
      process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL ===
        'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' &&
      process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL === 'https://127.0.0.1:9/';
    const isolatedDemo =
      process.env.DEMO_STAG_SINGLE_POST === 'true' &&
      process.env.NODE_ENV === 'development' &&
      process.env.DATABASE_URL?.includes('@billing-db:5432/billing_demo') &&
      process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL ===
        'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' &&
      process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL === 'https://127.0.0.1:9/' &&
      process.env.EMAIL_USE_REAL === 'false';
    return (
      isolatedDemo || scopedInstalledStag ||
      process.env.NODE_ENV === 'test' &&
      process.env.BILLING_SPEC09_STAG_INVOICING === 'true' &&
      process.env.SPEC10_SINGLE_STAG_POST === 'true'
    );
  }

  private protectedDemoCompanyInMock(): string | null {
    if (process.env.NODE_ENV !== 'development' ||
        process.env.USE_REAL_HACIENDA !== 'false' ||
        !process.env.DATABASE_URL?.includes('@billing-db:5432/billing_demo') ||
        process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL !==
          'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' ||
        process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL !== 'https://127.0.0.1:9/' ||
        process.env.EMAIL_USE_REAL !== 'false') return null;
    return process.env.DEMO_STAG_PROTECTED_COMPANY_ID || null;
  }

  private async isOutsideStagScope(submissionId: string): Promise<boolean> {
    const allowedCompanyId = process.env.BILLING_STAG_ALLOWED_COMPANY_ID;
    if (!allowedCompanyId) return false;
    const row = await this.prisma.fiscalSubmission.findUnique({
      where: { id: submissionId }, select: { companyId: true, environment: true },
    });
    return !row || row.companyId !== allowedCompanyId || row.environment !== 'SANDBOX';
  }

  private async mockWouldProcessProtectedSubmission(id: string): Promise<boolean> {
    const companyId = this.protectedDemoCompanyInMock();
    if (!companyId) return false;
    const row = await this.prisma.fiscalSubmission.findUnique({
      where: { id }, select: { companyId: true },
    });
    return row?.companyId === companyId;
  }

  async handleSubmitJob(payload: FiscalSubmissionJobPayload): Promise<void> {
    if (await this.isOutsideStagScope(payload.submissionId)) return;
    if (await this.mockWouldProcessProtectedSubmission(payload.submissionId)) return;
    if (this.singlePostStagTest()) {
      const current = await this.prisma.fiscalSubmission.findUnique({
        where: { id: payload.submissionId },
        select: { status: true },
      });
      if (current?.status === 'TECHNICAL_RETRY_PENDING') {
        await this.state.applyProviderResult(payload.submissionId, {
          kind: 'NON_RETRYABLE_FAILURE',
          nextStatus: 'MANUAL_REVIEW_REQUIRED',
          normalizedErrorCode: 'SPEC10_SINGLE_POST_RETRY_BLOCKED',
          sanitizedErrorMessage: 'A second STAG POST is prohibited for this test.',
        });
        return;
      }
    }
    const claimed = await this.claimSubmission(payload.submissionId, [
      'QUEUED',
      'TECHNICAL_RETRY_PENDING',
    ]);
    if (!claimed) return;

    try {
      const context = await this.loadContext(payload.submissionId);
      if (!context) return;
      if ((context.document.type === 'CREDIT_NOTE' || context.document.type === 'DEBIT_NOTE') &&
          !correctiveStagAllowed(context.document.type, context.document.environment)) {
        throw new Error('FISCAL_ISSUANCE_BLOCKED');
      }

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

      if (result.normalizedErrorCode === 'HACIENDA_TOKEN_EXPIRED' && !this.singlePostStagTest()) {
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

      if (this.singlePostStagTest() && result.nextStatus === 'TECHNICAL_RETRY_PENDING') {
        result = {
          ...result,
          kind: 'NON_RETRYABLE_FAILURE',
          nextStatus: 'MANUAL_REVIEW_REQUIRED',
          sanitizedErrorMessage:
            'The single authorized STAG POST ended without a conclusive fiscal state.',
        };
      }

      await this.state.applyProviderResult(payload.submissionId, result);
      await this.scheduleNext(payload.submissionId, result);
    } catch (error) {
      await this.handleSubmitFailure(payload.submissionId, error);
    }
  }

  async handleReconcileJob(payload: FiscalSubmissionJobPayload): Promise<void> {
    if (await this.isOutsideStagScope(payload.submissionId)) return;
    if (await this.mockWouldProcessProtectedSubmission(payload.submissionId)) return;
    const context = await this.loadContext(payload.submissionId);
    if (!context || FiscalSubmissionStateMachine.isTerminal(context.submission.status)) {
      return;
    }
    if ((context.document.type === 'CREDIT_NOTE' || context.document.type === 'DEBIT_NOTE') &&
        !correctiveStagAllowed(context.document.type, context.document.environment)) {
      throw new Error('FISCAL_ISSUANCE_BLOCKED');
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
    const singlePost = this.singlePostStagTest();
    const protectedCompanyId = this.protectedDemoCompanyInMock();
    const allowedCompanyId = process.env.BILLING_STAG_ALLOWED_COMPANY_ID;
    const due = await this.prisma.fiscalSubmission.findMany({
      where: {
        ...(allowedCompanyId ? { companyId: allowedCompanyId, environment: 'SANDBOX' as const } : {}),
        ...(protectedCompanyId ? { companyId: { not: protectedCompanyId } } : {}),
        status: {
          in: [
            'QUEUED',
            ...(singlePost ? [] : ['TECHNICAL_RETRY_PENDING' as const]),
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
        ...(allowedCompanyId ? { companyId: allowedCompanyId, environment: 'SANDBOX' as const } : {}),
        ...(protectedCompanyId ? { companyId: { not: protectedCompanyId } } : {}),
        status: 'SUBMITTING',
        lastAttemptAt: { lte: new Date(Date.now() - 5 * 60_000) },
      },
      take: 100,
    });

    for (const submission of [...due, ...staleSubmitting]) {
      if (submission.status === 'SUBMITTING') {
        await this.state.applyProviderResult(submission.id, {
          kind: singlePost ? 'NON_RETRYABLE_FAILURE' : 'RETRYABLE_FAILURE',
          nextStatus: singlePost ? 'MANUAL_REVIEW_REQUIRED' : 'TECHNICAL_RETRY_PENDING',
          normalizedErrorCode: singlePost
            ? 'SPEC10_SINGLE_POST_OUTCOME_UNKNOWN'
            : 'FISCAL_SUBMISSION_STALE_SUBMITTING_RECOVERED',
          sanitizedErrorMessage: singlePost
            ? 'The single STAG POST outcome is unknown after worker restart.'
            : 'Recovered stale in-flight submission after worker restart.',
        });
        if (singlePost) continue;
      }
      const jobName = ['ACKNOWLEDGED', 'PROCESSING', 'POST_OUTCOME_UNKNOWN'].includes(
        submission.status,
      )
        ? RECONCILE_FISCAL_SUBMISSION_JOB
        : SUBMIT_FISCAL_DOCUMENT_JOB;
      await this.publishSubmissionJob(jobName, submission.id, {
        retryLimit: singlePost ? 0 : 3,
        retryDelay: 60,
      });
    }
  }

  private async handleSubmitFailure(submissionId: string, error: unknown): Promise<void> {
    this.logger.warn(
      { submissionId, error: error instanceof Error ? error.message : 'Unknown submit failure' },
      'Fiscal submission submit job failed before a durable provider result was applied',
    );
    const result: HaciendaSubmissionResult = {
      kind: this.singlePostStagTest() ? 'NON_RETRYABLE_FAILURE' : 'RETRYABLE_FAILURE',
      nextStatus: this.singlePostStagTest() ? 'MANUAL_REVIEW_REQUIRED' : 'TECHNICAL_RETRY_PENDING',
      normalizedErrorCode: this.singlePostStagTest()
        ? 'SPEC10_SINGLE_POST_WORKER_FAILURE'
        : 'FISCAL_SUBMISSION_WORKER_FAILURE',
      sanitizedErrorMessage: this.singlePostStagTest()
        ? 'The single STAG POST outcome could not be confirmed.'
        : 'Fiscal submission worker failed before provider outcome was confirmed.',
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

  private startRecoveryTimer(): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setInterval(() => {
      this.enqueueDueWork().catch((error: unknown) => {
        this.logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown recovery failure' },
          'Fiscal submission periodic recovery failed',
        );
      });
    }, FiscalSubmissionWorkerService.RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  private async publishSubmissionJob(
    jobName: string,
    submissionId: string,
    options: { retryLimit: number; retryDelay: number; startAfterSeconds?: number },
  ): Promise<void> {
    await this.jobQueue.publish(
      jobName,
      { submissionId },
      {
        ...options,
        singletonKey: this.singletonKey(jobName, submissionId),
        singletonSeconds: 12 * 60 * 60,
      },
    );
  }

  private singletonKey(jobName: string, submissionId: string): string {
    return `fiscal-submission:${jobName}:${submissionId}`;
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
      await this.publishSubmissionJob(RECONCILE_FISCAL_SUBMISSION_JOB, submissionId, {
        retryLimit: 3,
        retryDelay: 60,
        startAfterSeconds: 60,
      });
      return;
    }

    if (result.nextStatus === 'TECHNICAL_RETRY_PENDING') {
      if (this.singlePostStagTest()) return;
      await this.publishSubmissionJob(SUBMIT_FISCAL_DOCUMENT_JOB, submissionId, {
        retryLimit: 3,
        retryDelay: 60,
        startAfterSeconds: result.rateLimit?.retryAfterSeconds ?? 60,
      });
    }
  }
}
