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
import { PrismaCompanyRepository } from './infrastructure/persistence/prisma-company.repository';
import { CompanyController } from './infrastructure/http/company.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DatabaseModule, IdentityModule, HaciendaModule, AuditModule],
  controllers: [CompanyController],
  providers: [
    CreateCompanyHandler,
    GetCompanyHandler,
    GetCompanyFiscalProfileHandler,
    UpsertCompanyFiscalProfileHandler,
    UpdateCompanyHandler,
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
  ],
})
export class CompaniesModule {}
