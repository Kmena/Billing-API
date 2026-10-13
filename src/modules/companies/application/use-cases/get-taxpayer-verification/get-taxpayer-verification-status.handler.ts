import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import type { EconomicActivityResult } from '../verify-taxpayer/verify-company-taxpayer.handler';

export interface TaxpayerVerificationStatusResult {
  readonly companyId: string;
  readonly haciendaName: string | null;
  readonly haciendaVerificationStatus: string | null;
  readonly haciendaVerifiedAt: Date | null;
  readonly haciendaTaxSituation: string | null;
  readonly moroso: boolean | null;
  readonly omiso: boolean | null;
  readonly defaultEconomicActivityId: string | null;
  readonly activities: EconomicActivityResult[];
}

@Injectable()
export class GetTaxpayerVerificationStatusHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(tenantId: string, companyId: string): Promise<TaxpayerVerificationStatusResult> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const profile = await this.prisma.companyFiscalProfile.findFirst({
      where: { companyId },
    });

    const activities = await this.prisma.companyEconomicActivity.findMany({
      where: { companyId },
      orderBy: [{ haciendaKind: 'asc' }, { code: 'asc' }],
    });

    return {
      companyId: company.id,
      haciendaName: company.haciendaName ?? null,
      haciendaVerificationStatus: company.haciendaVerificationStatus ?? null,
      haciendaVerifiedAt: company.haciendaVerifiedAt ?? null,
      haciendaTaxSituation: company.haciendaTaxSituation ?? null,
      moroso: company.haciendaMoroso ?? null,
      omiso: company.haciendaOmiso ?? null,
      defaultEconomicActivityId: profile?.defaultEconomicActivityId ?? null,
      activities: activities.map((a) => ({
        id: a.id,
        code: a.code,
        description: a.description,
        haciendaStatus: a.haciendaStatus,
        haciendaKind: a.haciendaKind,
        billingEnabled: a.billingEnabled,
        verifiedAt: a.verifiedAt,
        lastSeenAt: a.lastSeenAt,
        verificationSource: a.verificationSource,
      })),
    };
  }
}
