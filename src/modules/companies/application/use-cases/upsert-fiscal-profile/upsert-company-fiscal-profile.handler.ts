import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import { EconomicActivityCode } from '../../../domain/value-objects/economic-activity-code.vo';
import { FiscalAddress } from '../../../domain/value-objects/fiscal-address.vo';
import { FiscalContact } from '../../../domain/value-objects/fiscal-contact.vo';

export interface UpsertCompanyFiscalProfileCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly actor: string;
  readonly role: string;
  readonly economicActivityCode: string;
  readonly proveedorSistemas?: string;
  readonly province: string;
  readonly canton: string;
  readonly district: string;
  readonly barrio?: string;
  readonly otrasSenas: string;
  readonly email: string;
  readonly phoneCountryCode?: string;
  readonly phoneNumber?: string;
}

export interface CompanyFiscalProfileResult {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly economicActivityCode: string;
  readonly proveedorSistemas?: string | null;
  readonly province: string;
  readonly canton: string;
  readonly district: string;
  readonly barrio?: string | null;
  readonly otrasSenas: string;
  readonly email: string;
  readonly phoneCountryCode?: string | null;
  readonly phoneNumber?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class UpsertCompanyFiscalProfileHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async execute(command: UpsertCompanyFiscalProfileCommand): Promise<CompanyFiscalProfileResult> {
    if (command.role !== 'TENANT_ADMIN') {
      throw new ForbiddenException({ code: 'ADMIN_ROLE_REQUIRED' });
    }

    const company = await this.prisma.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    const economicActivityCode = this.toApplicationError(() =>
      EconomicActivityCode.create(command.economicActivityCode),
    ).value;
    const fiscalAddress = this.toApplicationError(() =>
      FiscalAddress.create({
        province: command.province,
        canton: command.canton,
        district: command.district,
        barrio: command.barrio,
        otrasSenas: command.otrasSenas,
      }),
    ).props;
    const fiscalContact = this.toApplicationError(() =>
      FiscalContact.create({
        email: command.email,
        phoneCountryCode: command.phoneCountryCode,
        phoneNumber: command.phoneNumber,
      }),
    ).props;
    const proveedorSistemas = command.proveedorSistemas?.trim();
    if (proveedorSistemas !== undefined && proveedorSistemas.length > 20) {
      throw new BadRequestException({ code: 'INVALID_PROVEEDOR_SISTEMAS' });
    }

    const profile = await this.prisma.companyFiscalProfile.upsert({
      where: { companyId: company.id },
      create: {
        id: randomUUID(),
        tenantId: command.tenantId,
        companyId: company.id,
        economicActivityCode,
        proveedorSistemas,
        province: fiscalAddress.province,
        canton: fiscalAddress.canton,
        district: fiscalAddress.district,
        barrio: fiscalAddress.barrio,
        otrasSenas: fiscalAddress.otrasSenas,
        email: fiscalContact.email,
        phoneCountryCode: fiscalContact.phoneCountryCode,
        phoneNumber: fiscalContact.phoneNumber,
      },
      update: {
        economicActivityCode,
        proveedorSistemas,
        province: fiscalAddress.province,
        canton: fiscalAddress.canton,
        district: fiscalAddress.district,
        barrio: fiscalAddress.barrio,
        otrasSenas: fiscalAddress.otrasSenas,
        email: fiscalContact.email,
        phoneCountryCode: fiscalContact.phoneCountryCode,
        phoneNumber: fiscalContact.phoneNumber,
      },
    });

    this.auditService.record({
      tenantId: command.tenantId,
      companyId: company.id,
      actor: command.actor,
      action: 'company-fiscal-profile.upserted',
      resource: `CompanyFiscalProfile:${profile.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: {
        economicActivityCode: profile.economicActivityCode,
        hasProveedorSistemas: Boolean(profile.proveedorSistemas),
        hasPhone: Boolean(profile.phoneNumber),
      },
    });

    return profile;
  }

  private toApplicationError<T>(factory: () => T): T {
    try {
      return factory();
    } catch (error) {
      throw new BadRequestException({
        code: error instanceof Error ? error.message : 'INVALID_FISCAL_PROFILE',
      });
    }
  }
}
