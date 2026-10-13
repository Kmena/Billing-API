import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import {
  ActivityNotFoundException,
  DefaultActivityInvalidException,
} from '../../../domain/exceptions/taxpayer-verification.exceptions';

export interface SetDefaultEconomicActivityCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly code: string;
  readonly actor: string;
}

export interface DefaultActivityResult {
  readonly companyId: string;
  readonly defaultEconomicActivityId: string;
  readonly code: string;
}

@Injectable()
export class SetDefaultEconomicActivityHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async execute(command: SetDefaultEconomicActivityCommand): Promise<DefaultActivityResult> {
    // 1. Tenant-scoped Company lookup
    const company = await this.prisma.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    // 2. Activity must belong to this Company (cross-company FK prevented by unique constraint)
    const activity = await this.prisma.companyEconomicActivity.findUnique({
      where: { companyId_code: { companyId: command.companyId, code: command.code } },
    });
    if (!activity) throw new ActivityNotFoundException(command.code);

    // 3. Validate activity meets default requirements (TASK-004)
    if (activity.haciendaStatus !== 'A') {
      throw new DefaultActivityInvalidException(
        `Activity ${command.code} is not active in Hacienda (status: ${activity.haciendaStatus}).`,
      );
    }
    if (!activity.billingEnabled) {
      throw new DefaultActivityInvalidException(
        `Activity ${command.code} is disabled for Billing. Enable it first.`,
      );
    }

    // 4. Fiscal profile must exist
    const profile = await this.prisma.companyFiscalProfile.findFirst({
      where: { companyId: command.companyId },
    });
    if (!profile) throw new NotFoundException({ code: 'FISCAL_PROFILE_NOT_FOUND' });

    // 5. Persist default + sync legacy code (DEC-006)
    await this.prisma.companyFiscalProfile.update({
      where: { companyId: command.companyId },
      data: {
        defaultEconomicActivityId: activity.id,
        economicActivityCode: activity.code, // DEC-006: keep legacy field in sync
      },
    });

    this.auditService.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      actor: command.actor,
      action: 'company.default-economic-activity.set',
      resource: `CompanyEconomicActivity:${activity.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: { code: command.code },
    });

    return {
      companyId: command.companyId,
      defaultEconomicActivityId: activity.id,
      code: activity.code,
    };
  }
}
