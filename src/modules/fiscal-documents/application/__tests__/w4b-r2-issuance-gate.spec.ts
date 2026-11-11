import { ForbiddenException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { JobQueuePort } from '../../../../infrastructure/queue/ports/job-queue.port';
import { FiscalDocumentService } from '../fiscal-document.service';
import { SubmitFiscalDocumentService } from '../submission/submit-fiscal-document.service';
import { HaciendaRecepcionAdapter } from '../../infrastructure/submission/hacienda-recepcion.adapter';
import { HaciendaSubmitSignedDocumentInput } from '../submission/ports/hacienda-submission.port';

describe('W4-B-R2 installed issuance gate', () => {
  it('rejects note creation outside the test laboratory before accessing the database', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const documents = new FiscalDocumentService({} as PrismaService, {} as AuditService);
      await expect(
        documents.createDocument({ type: 'CREDIT_NOTE', environment: 'SANDBOX' } as never),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        documents.createCorrectiveNoteLab({ environment: 'SANDBOX' } as never),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('rejects submission of both note types before using credentials or queues', async () => {
    const submission = new SubmitFiscalDocumentService(
      {} as PrismaService,
      {} as AuditService,
      {} as JobQueuePort,
    );
    for (const documentType of ['CREDIT_NOTE', 'DEBIT_NOTE'] as const) {
      await expect(submission.execute({ documentType } as never)).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('rejects the real Hacienda transport even if called directly', async () => {
    const adapter = new HaciendaRecepcionAdapter(
      { get: () => ({}) } as unknown as ConfigService,
      {} as HttpService,
    );
    for (const documentType of ['CREDIT_NOTE', 'DEBIT_NOTE'] as const) {
      await expect(
        adapter.submitSignedDocument({ documentType } as HaciendaSubmitSignedDocumentInput),
      ).rejects.toThrow(ForbiddenException);
    }
  });
});
