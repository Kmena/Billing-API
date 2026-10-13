import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import type { EconomicActivityResult } from '../verify-taxpayer/verify-company-taxpayer.handler';

@Injectable()
export class ListEconomicActivitiesHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(tenantId: string, companyId: string): Promise<EconomicActivityResult[]> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const rows = await this.prisma.companyEconomicActivity.findMany({
      where: { companyId },
      orderBy: [{ haciendaKind: 'asc' }, { code: 'asc' }],
    });

    return rows.map((a) => ({
      id: a.id,
      code: a.code,
      description: a.description,
      haciendaStatus: a.haciendaStatus,
      haciendaKind: a.haciendaKind,
      billingEnabled: a.billingEnabled,
      verifiedAt: a.verifiedAt,
      lastSeenAt: a.lastSeenAt,
      verificationSource: a.verificationSource,
    }));
  }
}
