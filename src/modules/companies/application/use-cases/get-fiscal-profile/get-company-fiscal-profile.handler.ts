import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { CompanyFiscalProfileResult } from '../upsert-fiscal-profile/upsert-company-fiscal-profile.handler';

export interface GetCompanyFiscalProfileCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly role: string;
}

@Injectable()
export class GetCompanyFiscalProfileHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: GetCompanyFiscalProfileCommand): Promise<CompanyFiscalProfileResult> {
    if (command.role !== 'TENANT_ADMIN') {
      throw new ForbiddenException({ code: 'ADMIN_ROLE_REQUIRED' });
    }

    const profile = await this.prisma.companyFiscalProfile.findFirst({
      where: { tenantId: command.tenantId, companyId: command.companyId },
    });
    if (!profile) throw new NotFoundException({ code: 'COMPANY_FISCAL_PROFILE_NOT_FOUND' });
    return profile;
  }
}
