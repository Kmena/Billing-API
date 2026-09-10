import { Inject, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Company, HaciendaVerificationStatus } from '../../../domain/entities/company.entity';
import { ICompanyRepository, COMPANY_REPOSITORY } from '../../../domain/ports/company.repository';
import { CompanyAlreadyExistsException } from '../../../domain/exceptions/company-already-exists.exception';
import {
  HACIENDA_PORT,
  HaciendaPort,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';
import { HaciendaUnavailableException } from '../../../../../infrastructure/integrations/hacienda/exceptions/hacienda-unavailable.exception';

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
  readonly haciendaName?: string;
  readonly haciendaVerifiedAt?: Date;
  readonly haciendaVerificationStatus?: HaciendaVerificationStatus;
  readonly createdAt: Date;
}

@Injectable()
export class CreateCompanyHandler {
  private readonly logger = new Logger(CreateCompanyHandler.name);

  constructor(
    @Inject(COMPANY_REPOSITORY)
    private readonly companyRepository: ICompanyRepository,
    @Inject(HACIENDA_PORT)
    private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(command: CreateCompanyCommand): Promise<CreateCompanyResult> {
    // Check uniqueness within tenant
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

    // FR-014/FR-015: Best-effort Hacienda verification — ALL identification types (DEC-004)
    // Company creation MUST NOT fail due to Hacienda unavailability (FR-015).
    let haciendaName: string | undefined;
    let haciendaVerifiedAt: Date | undefined;
    let verificationStatus: HaciendaVerificationStatus;

    try {
      const taxpayer = await this.haciendaPort.getTaxpayer(command.identificationNumber);
      if (taxpayer.found) {
        haciendaName = taxpayer.name;
        haciendaVerifiedAt = new Date();
        verificationStatus = 'VERIFIED';
      } else {
        verificationStatus = 'NOT_FOUND'; // Distinct from UNAVAILABLE — BR-004
      }
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) {
        verificationStatus = 'UNAVAILABLE'; // 429, timeout, 5xx, open circuit
      } else {
        verificationStatus = 'ERROR'; // Unexpected failure
      }
      this.logger.warn(
        {
          identificationNumber: command.identificationNumber,
          error: err instanceof Error ? err.message : String(err),
        },
        'Hacienda verification — creating company without verification',
      );
    }

    // Create enriched company with verification result
    const verifiedCompany = Company.reconstruct({
      id: company.id,
      tenantId: company.tenantId,
      legalName: company.legalName,
      tradeName: company.tradeName,
      identificationType: company.identificationType,
      identificationNumber: company.identificationNumber,
      status: company.status,
      haciendaName,
      haciendaVerifiedAt,
      haciendaVerificationStatus: verificationStatus,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    });

    await this.companyRepository.save(verifiedCompany);

    return {
      id: verifiedCompany.id,
      tenantId: verifiedCompany.tenantId,
      legalName: verifiedCompany.legalName,
      tradeName: verifiedCompany.tradeName,
      identificationType: verifiedCompany.identificationType,
      identificationNumber: verifiedCompany.identificationNumber,
      status: verifiedCompany.status,
      haciendaName: verifiedCompany.haciendaName,
      haciendaVerifiedAt: verifiedCompany.haciendaVerifiedAt,
      haciendaVerificationStatus: verifiedCompany.haciendaVerificationStatus,
      createdAt: verifiedCompany.createdAt,
    };
  }
}
