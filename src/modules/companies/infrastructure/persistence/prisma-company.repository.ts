import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { TenantAwarePrismaRepository } from '../../../../infrastructure/database/tenant-aware-prisma.repository';
import { ICompanyRepository } from '../../domain/ports/company.repository';
import { Company } from '../../domain/entities/company.entity';
import type { Company as PrismaCompany } from '@prisma/client';

@Injectable()
export class PrismaCompanyRepository
  extends TenantAwarePrismaRepository
  implements ICompanyRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(id: string): Promise<Company | null> {
    // Tenant isolation applied via TenantAwarePrismaRepository
    const record = await this.prisma.company.findFirst({
      where: this.applyTenantFilter({ id }),
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByIdentificationNumber(tenantId: string, number: string): Promise<Company | null> {
    const record = await this.prisma.company.findUnique({
      where: {
        tenantId_identificationNumber: {
          tenantId,
          identificationNumber: number,
        },
      },
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async save(company: Company): Promise<void> {
    await this.prisma.company.upsert({
      where: { id: company.id },
      create: {
        id: company.id,
        tenantId: company.tenantId,
        legalName: company.legalName,
        tradeName: company.tradeName,
        identificationType: company.identificationType,
        identificationNumber: company.identificationNumber,
        status: company.status,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      },
      update: {
        legalName: company.legalName,
        tradeName: company.tradeName,
        status: company.status,
        updatedAt: company.updatedAt,
      },
    });
  }

  private toDomain(record: PrismaCompany): Company {
    return Company.reconstruct({
      id: record.id,
      tenantId: record.tenantId,
      legalName: record.legalName,
      tradeName: record.tradeName,
      identificationType: record.identificationType,
      identificationNumber: record.identificationNumber,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
