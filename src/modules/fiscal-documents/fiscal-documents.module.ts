import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { FiscalDocumentService } from './application/fiscal-document.service';
import { FiscalManagementController } from './infrastructure/http/fiscal-management.controller';
import { FiscalPublicDocumentsController } from './infrastructure/http/fiscal-public-documents.controller';
import { FiscalDocumentsController } from './infrastructure/http/fiscal-documents.controller';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule, ApiKeysModule],
  controllers: [
    FiscalManagementController,
    FiscalDocumentsController,
    FiscalPublicDocumentsController,
  ],
  providers: [FiscalDocumentService],
})
export class FiscalDocumentsModule {}
