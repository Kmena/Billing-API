import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import { ActivityNotFoundException } from '../../../domain/exceptions/taxpayer-verification.exceptions';
import type { EconomicActivityResult } from '../verify-taxpayer/verify-company-taxpayer.handler';

export interface SetActivityBillingEnabledCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly code: string;
  readonly billingEnabled: boolean;
  readonly actor: string;
}

@Injectable()
export class SetActivityBillingEnabledHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async execute(command: SetActivityBillingEnabledCommand): Promise<EconomicActivityResult> {
    const company = await this.prisma.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const activity = await this.prisma.companyEconomicActivity.findUnique({
      where: { companyId_code: { companyId: command.companyId, code: command.code } },
    });
    if (!activity) throw new ActivityNotFoundException(command.code);

    // If disabling the current default, we do NOT automatically clear the default —
    // readiness will report DEFAULT_ECONOMIC_ACTIVITY_INVALID and require explicit action.
    const updated = await this.prisma.companyEconomicActivity.update({
      where: { id: activity.id },
      data: { billingEnabled: command.billingEnabled },
    });

    this.auditService.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      actor: command.actor,
      action: `company.economic-activity.${command.billingEnabled ? 'enabled' : 'disabled'}`,
      resource: `CompanyEconomicActivity:${activity.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: { code: command.code, billingEnabled: command.billingEnabled },
    });

    return {
      id: updated.id,
      code: updated.code,
      description: updated.description,
      haciendaStatus: updated.haciendaStatus,
      haciendaKind: updated.haciendaKind,
      billingEnabled: updated.billingEnabled,
      verifiedAt: updated.verifiedAt,
      lastSeenAt: updated.lastSeenAt,
      verificationSource: updated.verificationSource,
    };
  }
}
