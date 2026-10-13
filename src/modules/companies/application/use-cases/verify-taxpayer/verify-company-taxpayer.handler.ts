import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import {
  HACIENDA_PORT,
  HaciendaPort,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';
import { HaciendaUnavailableException } from '../../../../../infrastructure/integrations/hacienda/exceptions/hacienda-unavailable.exception';
import {
  TaxpayerIdentityMismatchException,
  TaxpayerLookupUnavailableException,
  TaxpayerNotFoundException,
} from '../../../domain/exceptions/taxpayer-verification.exceptions';

/** Normalization constants */
const VERIFICATION_SOURCE = 'HACIENDA_FE_AE';

/** Maps Hacienda type codes to domain IdentificationType */
function normalizeIdType(code: string | undefined): string | null {
  if (code === '01') return 'FISICA';
  if (code === '02') return 'JURIDICA';
  if (code === '03') return 'DIMEX';
  if (code === '04') return 'NITE';
  return null;
}

export interface VerifyCompanyTaxpayerCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly actor: string;
}

export interface EconomicActivityResult {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly haciendaStatus: string;
  readonly haciendaKind: string | null;
  readonly billingEnabled: boolean;
  readonly verifiedAt: Date;
  readonly lastSeenAt: Date;
  readonly verificationSource: string;
}

export interface TaxpayerVerificationResult {
  readonly companyId: string;
  readonly haciendaName: string;
  readonly haciendaVerificationStatus: string;
  readonly haciendaVerifiedAt: Date;
  readonly haciendaTaxSituation: string | null;
  readonly moroso: boolean;
  readonly omiso: boolean;
  readonly activities: EconomicActivityResult[];
  readonly autoSelectedDefaultActivityId: string | null;
}

@Injectable()
export class VerifyCompanyTaxpayerHandler {
  private readonly logger = new Logger(VerifyCompanyTaxpayerHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HACIENDA_PORT) private readonly haciendaPort: HaciendaPort,
    private readonly auditService: AuditService,
  ) {}

  async execute(command: VerifyCompanyTaxpayerCommand): Promise<TaxpayerVerificationResult> {
    // 1. Load Company under tenant isolation
    const company = await this.prisma.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const identification = company.identificationNumber;

    // 2–4. Call Hacienda public /fe/ae lookup
    let taxpayer;
    try {
      taxpayer = await this.haciendaPort.getTaxpayer(identification);
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) {
        throw new TaxpayerLookupUnavailableException();
      }
      throw err;
    }

    // 5. Validate not-found (body.code=404)
    if (!taxpayer.found) {
      // Persist NOT_FOUND status
      await this.prisma.company.update({
        where: { id: company.id },
        data: { haciendaVerificationStatus: 'NOT_FOUND' },
      });
      throw new TaxpayerNotFoundException(identification);
    }

    // 6. Validate returned taxpayer canonical identity against Company (TASK-005)
    const returnedIdType = normalizeIdType(taxpayer.identificationType);
    if (returnedIdType !== null && returnedIdType !== company.identificationType) {
      throw new TaxpayerIdentityMismatchException(
        `${company.identificationType}/${identification}`,
        `${returnedIdType}/${taxpayer.identification}`,
      );
    }
    // Normalize returned identification — Hacienda echoes back the queried identification
    const returnedId = (taxpayer.identification ?? '').trim();
    if (returnedId && returnedId !== identification) {
      throw new TaxpayerIdentityMismatchException(identification, returnedId);
    }

    const now = new Date();
    const moroso = taxpayer.moroso ?? false;
    const omiso = taxpayer.omiso ?? false;

    // 7–10. Persist verification + upsert activities in a transaction
    const activities = taxpayer.economicActivities ?? [];
    const returnedCodes = new Set(activities.map((a) => a.code));

    const activityRows = await this.prisma.$transaction(async (tx) => {
      // 7. Persist taxpayer verification state on Company
      await tx.company.update({
        where: { id: company.id },
        data: {
          haciendaName: taxpayer.name,
          haciendaVerifiedAt: now,
          haciendaVerificationStatus: 'VERIFIED',
          haciendaTaxSituation: taxpayer.taxSituation ?? null,
          haciendaMoroso: moroso,
          haciendaOmiso: omiso,
        },
      });

      // 8. Upsert returned CompanyEconomicActivities
      for (const activity of activities) {
        await tx.companyEconomicActivity.upsert({
          where: { companyId_code: { companyId: company.id, code: activity.code } },
          create: {
            id: randomUUID(),
            tenantId: command.tenantId,
            companyId: company.id,
            code: activity.code,
            description: activity.description,
            haciendaStatus: activity.status,
            haciendaKind: activity.type ?? null,
            billingEnabled: true,
            verifiedAt: now,
            lastSeenAt: now,
            verificationSource: VERIFICATION_SOURCE,
          },
          update: {
            description: activity.description,
            haciendaStatus: activity.status,
            haciendaKind: activity.type ?? null,
            lastSeenAt: now,
            verifiedAt: now,
            verificationSource: VERIFICATION_SOURCE,
          },
        });
      }

      // 10. Mark previously-seen activities not returned this time
      // We do NOT delete them — historical records are preserved.
      // We update their haciendaStatus to 'I' (inactive as of this verification)
      // only if they were previously 'A' and are not in the current response.
      await tx.companyEconomicActivity.updateMany({
        where: {
          companyId: company.id,
          haciendaStatus: 'A',
          // NOT in the current set
          code: { notIn: returnedCodes.size > 0 ? [...returnedCodes] : ['__NONE__'] },
        },
        data: { haciendaStatus: 'I', lastSeenAt: now },
      });

      return tx.companyEconomicActivity.findMany({
        where: { companyId: company.id },
        orderBy: [{ haciendaKind: 'asc' }, { code: 'asc' }],
      });
    });

    // 12. Determine default activity according to DEC-002
    const validActive = activityRows.filter((a) => a.haciendaStatus === 'A' && a.billingEnabled);
    let autoSelectedDefaultActivityId: string | null = null;

    // Check current fiscal profile for existing default
    const existingProfile = await this.prisma.companyFiscalProfile.findFirst({
      where: { companyId: company.id },
    });

    if (existingProfile) {
      // Check if existing default is still valid
      const existingDefault = existingProfile.defaultEconomicActivityId
        ? activityRows.find((a) => a.id === existingProfile.defaultEconomicActivityId)
        : null;

      const existingDefaultStillValid =
        existingDefault && existingDefault.haciendaStatus === 'A' && existingDefault.billingEnabled;

      if (!existingDefaultStillValid) {
        // DEC-002: auto-select if exactly one valid active activity
        if (validActive.length === 1) {
          autoSelectedDefaultActivityId = validActive[0].id;
          await this.prisma.companyFiscalProfile.update({
            where: { companyId: company.id },
            data: {
              defaultEconomicActivityId: validActive[0].id,
              economicActivityCode: validActive[0].code, // DEC-006: sync legacy field
            },
          });
          this.logger.log(
            { companyId: company.id, code: validActive[0].code },
            'Auto-selected single valid activity as default',
          );
        } else if (existingDefault && !existingDefaultStillValid) {
          // Existing default became invalid — clear it
          await this.prisma.companyFiscalProfile.update({
            where: { companyId: company.id },
            data: { defaultEconomicActivityId: null },
          });
        }
      } else {
        autoSelectedDefaultActivityId = existingDefault.id;
      }
    }

    this.auditService.record({
      tenantId: command.tenantId,
      companyId: company.id,
      actor: command.actor,
      action: 'company.taxpayer-verified',
      resource: `Company:${company.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: {
        haciendaVerificationStatus: 'VERIFIED',
        activitiesCount: activities.length,
        moroso,
        omiso,
        autoSelectedDefault: Boolean(autoSelectedDefaultActivityId),
      },
    });

    return {
      companyId: company.id,
      haciendaName: taxpayer.name,
      haciendaVerificationStatus: 'VERIFIED',
      haciendaVerifiedAt: now,
      haciendaTaxSituation: taxpayer.taxSituation ?? null,
      moroso,
      omiso,
      activities: activityRows.map((a) => ({
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
      autoSelectedDefaultActivityId,
    };
  }
}
