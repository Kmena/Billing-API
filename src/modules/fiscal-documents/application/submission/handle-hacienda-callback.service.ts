import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { JOB_QUEUE, JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { RECONCILE_FISCAL_SUBMISSION_JOB } from './workers/fiscal-submission-job.constants';

export interface HaciendaCallbackInput {
  readonly clave?: unknown;
  readonly ['ind-estado']?: unknown;
}

@Injectable()
export class HandleHaciendaCallbackService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueuePort,
  ) {}

  async execute(input: HaciendaCallbackInput): Promise<{ accepted: true; enqueued: boolean }> {
    if (typeof input.clave !== 'string' || !/^\d{50}$/.test(input.clave)) {
      throw new BadRequestException({ code: 'HACIENDA_CALLBACK_INVALID_CLAVE' });
    }

    const submission = await this.prisma.fiscalSubmission.findUnique({
      where: { clave: input.clave },
    });
    if (!submission) {
      return { accepted: true, enqueued: false };
    }

    if (submission.status !== 'ACCEPTED' && submission.status !== 'REJECTED') {
      await this.prisma.fiscalSubmission.update({
        where: { id: submission.id },
        data: {
          lastProviderStatus:
            typeof input['ind-estado'] === 'string'
              ? input['ind-estado'].slice(0, 40)
              : submission.lastProviderStatus,
          nextAttemptAt: new Date(),
        },
      });
      await this.jobQueue.publish(
        RECONCILE_FISCAL_SUBMISSION_JOB,
        { submissionId: submission.id },
        { retryLimit: 3, retryDelay: 60 },
      );
      return { accepted: true, enqueued: true };
    }

    return { accepted: true, enqueued: false };
  }
}
