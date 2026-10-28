import { Module } from '@nestjs/common';
import { W2B2FiscalLabModule } from './w2-b2-fiscal-lab.module';
import { FiscalDocumentsModule } from '../fiscal-documents/fiscal-documents.module';
import { FiscalConsumersLabModule } from '../fiscal-consumers/fiscal-consumers-lab.module';
import { W3ALabCorrectionService } from './w3-a-lab-correction.service';
import { W3ALabCorrectionController } from './w3-a-lab-correction.controller';
import { CancellationWorkflowLabService } from './cancellation-workflow-lab.service';
import { CancellationWorkflowLabController } from './cancellation-workflow-lab.controller';

/** Deliberately excluded from AppModule and all production bootstraps. */
@Module({
  imports: [W2B2FiscalLabModule, FiscalDocumentsModule, FiscalConsumersLabModule],
  controllers: [W3ALabCorrectionController, CancellationWorkflowLabController],
  providers: [W3ALabCorrectionService, CancellationWorkflowLabService],
})
export class W3AFiscalLabModule {
  constructor() {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('W3_A_LAB_MODULE_REQUIRES_TEST_ENVIRONMENT');
  }
}
