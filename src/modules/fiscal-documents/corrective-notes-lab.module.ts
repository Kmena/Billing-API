import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { FiscalDocumentsModule } from './fiscal-documents.module';
import { CorrectiveNotesLabController } from './infrastructure/http/corrective-notes-lab.controller';
import { correctiveStagAllowed } from './domain/corrective-stag-gate';

export const FISCAL_ISSUANCE_BLOCKED = 'YES' as const;

/** Enabled only for an explicit SANDBOX credit-note installation. */
@Module({
  imports: [ApiKeysModule, FiscalDocumentsModule],
  controllers: [CorrectiveNotesLabController],
})
export class CorrectiveNotesLabModule {
  constructor() {
    if (!correctiveStagAllowed('CREDIT_NOTE', 'SANDBOX')) {
      throw new Error('FISCAL_ISSUANCE_BLOCKED');
    }
  }
}
