import { Module } from '@nestjs/common';
import { FiscalDocumentsModule } from './fiscal-documents.module';
import { CorrectiveNotesLabController } from './infrastructure/http/corrective-notes-lab.controller';

export const FISCAL_ISSUANCE_BLOCKED = 'YES' as const;

/** Excluded from AppModule and all installed entrypoints. Synthetic tests import it explicitly. */
@Module({ imports: [FiscalDocumentsModule], controllers: [CorrectiveNotesLabController] })
export class CorrectiveNotesLabModule {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('FISCAL_ISSUANCE_BLOCKED');
    }
  }
}
