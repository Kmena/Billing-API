import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { FiscalConsumersLabModule } from '../fiscal-consumers/fiscal-consumers-lab.module';
import { FiscalDocumentsModule } from '../fiscal-documents/fiscal-documents.module';
import { W2B2LabInvoiceController } from './w2-b2-lab-invoice.controller';
import { W2B2LabTicketController } from './w2-b2-lab-ticket.controller';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';
import { W2B2LabSubmissionService } from './w2-b2-lab-submission.service';
import { W2B2LabAcceptedPackageService } from './w2-b2-lab-accepted-package.service';
import { Spec10HistoricalArchiveController } from './spec10-historical-archive.controller';
import { Spec10HistoricalArchiveService } from './spec10-historical-archive.service';

/** Test-only module. It is deliberately absent from AppModule and worker bootstrap. */
@Module({
  imports: [DatabaseModule, QueueModule, FiscalConsumersLabModule, FiscalDocumentsModule],
  controllers: [
    W2B2LabInvoiceController,
    W2B2LabTicketController,
    Spec10HistoricalArchiveController,
  ],
  providers: [
    W2B2LabInvoiceService,
    W2B2LabSubmissionService,
    W2B2LabAcceptedPackageService,
    Spec10HistoricalArchiveService,
  ],
  exports: [W2B2LabInvoiceService],
})
export class W2B2FiscalLabModule {
  constructor() {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('W2_B2_LAB_MODULE_REQUIRES_TEST_ENVIRONMENT');
  }
}
