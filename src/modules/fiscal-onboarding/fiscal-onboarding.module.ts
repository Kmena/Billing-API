import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuditModule } from '../audit/audit.module';
import { CompaniesModule } from '../companies/companies.module';
import { HaciendaConnectionModule } from '../hacienda-connection/hacienda-connection.module';
import { FiscalDocumentsModule } from '../fiscal-documents/fiscal-documents.module';
import { FiscalOnboardingV1Service } from './application/fiscal-onboarding-v1.service';
import { FiscalTestInvoiceV1Service } from './application/fiscal-test-invoice-v1.service';
import { IntegrationProfileGuard } from './infrastructure/integration-profile.guard';
import { BootstrapIntegrationProfileGuard } from './infrastructure/bootstrap-integration-profile.guard';
import {
  FiscalOnboardingBootstrapV1Controller,
  FiscalOnboardingM2MV1Controller,
  FiscalOnboardingServiceBootstrapV1Controller,
} from './infrastructure/http/fiscal-onboarding-v1.controller';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ApiKeysModule,
    CompaniesModule,
    HaciendaConnectionModule,
    FiscalDocumentsModule,
  ],
  controllers: [
    FiscalOnboardingBootstrapV1Controller,
    FiscalOnboardingServiceBootstrapV1Controller,
    FiscalOnboardingM2MV1Controller,
  ],
  providers: [
    FiscalOnboardingV1Service,
    FiscalTestInvoiceV1Service,
    IntegrationProfileGuard,
    BootstrapIntegrationProfileGuard,
  ],
})
export class FiscalOnboardingModule {}
