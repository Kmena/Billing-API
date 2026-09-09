import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { COMPANY_REPOSITORY } from './domain/ports/company.repository';
import { CreateCompanyHandler } from './application/use-cases/create-company/create-company.handler';
import { GetCompanyHandler } from './application/use-cases/get-company/get-company.handler';
import { PrismaCompanyRepository } from './infrastructure/persistence/prisma-company.repository';
import { CompanyController } from './infrastructure/http/company.controller';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [CompanyController],
  providers: [
    CreateCompanyHandler,
    GetCompanyHandler,
    {
      provide: COMPANY_REPOSITORY,
      useClass: PrismaCompanyRepository,
    },
  ],
  exports: [CreateCompanyHandler, GetCompanyHandler],
})
export class CompaniesModule {}
