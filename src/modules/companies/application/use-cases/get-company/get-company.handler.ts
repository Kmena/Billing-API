import { Inject, Injectable } from '@nestjs/common';
import { ICompanyRepository, COMPANY_REPOSITORY } from '../../../domain/ports/company.repository';
import { CompanyNotFoundException } from '../../../domain/exceptions/company-not-found.exception';
import { TenantContext } from '../../../../../infrastructure/tenant/tenant-context';
import type { HaciendaVerificationStatus } from '../../../domain/entities/company.entity';

export interface GetCompanyQuery {
  readonly id: string;
}

export interface GetCompanyResult {
  readonly id: string;
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly identificationType: string;
  readonly identificationNumber: string;
  readonly status: string;
  readonly haciendaName?: string;
  readonly haciendaVerifiedAt?: Date;
  readonly haciendaVerificationStatus?: HaciendaVerificationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class GetCompanyHandler {
  constructor(
    @Inject(COMPANY_REPOSITORY)
    private readonly companyRepository: ICompanyRepository,
  ) {}

  async execute(query: GetCompanyQuery): Promise<GetCompanyResult> {
    const company = await this.companyRepository.findById(query.id);

    // Tenant isolation: 404 if not found OR if belongs to different tenant
    if (!company || company.tenantId !== TenantContext.getTenantId()) {
      throw new CompanyNotFoundException(query.id);
    }

    return {
      id: company.id,
      tenantId: company.tenantId,
      legalName: company.legalName,
      tradeName: company.tradeName,
      identificationType: company.identificationType,
      identificationNumber: company.identificationNumber,
      status: company.status,
      haciendaName: company.haciendaName,
      haciendaVerifiedAt: company.haciendaVerifiedAt,
      haciendaVerificationStatus: company.haciendaVerificationStatus,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }
}
