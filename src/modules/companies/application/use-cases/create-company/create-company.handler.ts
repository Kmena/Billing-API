import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Company } from '../../../domain/entities/company.entity';
import { ICompanyRepository, COMPANY_REPOSITORY } from '../../../domain/ports/company.repository';
import { CompanyAlreadyExistsException } from '../../../domain/exceptions/company-already-exists.exception';

export interface CreateCompanyCommand {
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly identificationType: string;
  readonly identificationNumber: string;
}

export interface CreateCompanyResult {
  readonly id: string;
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly identificationType: string;
  readonly identificationNumber: string;
  readonly status: string;
  readonly createdAt: Date;
}

@Injectable()
export class CreateCompanyHandler {
  constructor(
    @Inject(COMPANY_REPOSITORY)
    private readonly companyRepository: ICompanyRepository,
  ) {}

  async execute(command: CreateCompanyCommand): Promise<CreateCompanyResult> {
    // Check uniqueness within tenant (BR: unique per tenant, not global)
    const existing = await this.companyRepository.findByIdentificationNumber(
      command.tenantId,
      command.identificationNumber,
    );

    if (existing) {
      throw new CompanyAlreadyExistsException(command.identificationNumber);
    }

    const company = Company.create(
      uuidv4(),
      command.tenantId,
      command.legalName,
      command.identificationType,
      command.identificationNumber,
      command.tradeName,
    );

    await this.companyRepository.save(company);

    return {
      id: company.id,
      tenantId: company.tenantId,
      legalName: company.legalName,
      tradeName: company.tradeName,
      identificationType: company.identificationType,
      identificationNumber: company.identificationNumber,
      status: company.status,
      createdAt: company.createdAt,
    };
  }
}
