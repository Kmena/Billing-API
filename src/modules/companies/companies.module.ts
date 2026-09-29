import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { HaciendaModule } from '../../infrastructure/integrations/hacienda/hacienda.module';
import { COMPANY_REPOSITORY } from './domain/ports/company.repository';
import { CreateCompanyHandler } from './application/use-cases/create-company/create-company.handler';
import { GetCompanyHandler } from './application/use-cases/get-company/get-company.handler';
import { GetCompanyFiscalProfileHandler } from './application/use-cases/get-fiscal-profile/get-company-fiscal-profile.handler';
import { UpsertCompanyFiscalProfileHandler } from './application/use-cases/upsert-fiscal-profile/upsert-company-fiscal-profile.handler';
import { UpdateCompanyHandler } from './application/use-cases/update-company/update-company.handler';
// P0: Taxpayer verification use-cases
import { VerifyCompanyTaxpayerHandler } from './application/use-cases/verify-taxpayer/verify-company-taxpayer.handler';
import { GetTaxpayerVerificationStatusHandler } from './application/use-cases/get-taxpayer-verification/get-taxpayer-verification-status.handler';
import { ListEconomicActivitiesHandler } from './application/use-cases/list-economic-activities/list-economic-activities.handler';
import { SetActivityBillingEnabledHandler } from './application/use-cases/set-activity-enabled/set-activity-billing-enabled.handler';
import { SetDefaultEconomicActivityHandler } from './application/use-cases/set-default-activity/set-default-economic-activity.handler';
// M2M readiness — FiscalDocumentsModule cannot be imported here (circular via HaciendaConnectionModule).
// FiscalReadinessService depends only on PrismaService (@Global) and SECRET_PROVIDER (@Global),
// so it is safe to provide directly without cross-module import.
import { FiscalReadinessService } from '../fiscal-documents/application/fiscal-xml/fiscal-readiness.service';
import { PrismaCompanyRepository } from './infrastructure/persistence/prisma-company.repository';
import { CompanyController } from './infrastructure/http/company.controller';
import {
  TaxpayerVerificationController,
  FiscalOnboardingM2MController,
} from './infrastructure/http/taxpayer-verification.controller';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [DatabaseModule, IdentityModule, HaciendaModule, AuditModule, ApiKeysModule],
  controllers: [CompanyController, TaxpayerVerificationController, FiscalOnboardingM2MController],
  providers: [
    CreateCompanyHandler,
    GetCompanyHandler,
    GetCompanyFiscalProfileHandler,
    UpsertCompanyFiscalProfileHandler,
    UpdateCompanyHandler,
    // P0 providers
    VerifyCompanyTaxpayerHandler,
    GetTaxpayerVerificationStatusHandler,
    ListEconomicActivitiesHandler,
    SetActivityBillingEnabledHandler,
    SetDefaultEconomicActivityHandler,
    // M2M readiness — provided here to avoid circular module dependency.
    // Dependencies (PrismaService, SECRET_PROVIDER) are global.
    FiscalReadinessService,
    {
      provide: COMPANY_REPOSITORY,
      useClass: PrismaCompanyRepository,
    },
  ],
  exports: [
    CreateCompanyHandler,
    GetCompanyHandler,
    GetCompanyFiscalProfileHandler,
    UpsertCompanyFiscalProfileHandler,
    UpdateCompanyHandler,
    VerifyCompanyTaxpayerHandler,
    GetTaxpayerVerificationStatusHandler,
    ListEconomicActivitiesHandler,
    SetActivityBillingEnabledHandler,
    SetDefaultEconomicActivityHandler,
  ],
})
export class CompaniesModule {}
