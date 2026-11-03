import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyFiscalProfile, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { FiscalAddress } from '../../../companies/domain/value-objects/fiscal-address.vo';
import { FiscalContact } from '../../../companies/domain/value-objects/fiscal-contact.vo';
import { ConsumerV2Principal } from '../http/consumer-v2.guard';
import { PatchFiscalProfileV2Dto } from '../http/onboarding-v2.dto';
import { PrismaConsumerV2Repository } from './prisma-consumer-v2.repository';

function profileResponse(p: ConsumerV2Principal, saved: CompanyFiscalProfile, version: string) {
  return {
    companyId: p.companyId,
    environment: p.environment,
    profile: {
      id: saved.id,
      province: saved.province,
      canton: saved.canton,
      district: saved.district,
      barrio: saved.barrio,
      otrasSenas: saved.otrasSenas,
      email: saved.email,
      phoneCountryCode: saved.phoneCountryCode,
      phoneNumber: saved.phoneNumber,
      proveedorSistemas: saved.proveedorSistemas,
      defaultEconomicActivityId: saved.defaultEconomicActivityId,
      updatedAt: saved.updatedAt.toISOString(),
      version,
    },
  };
}

function conflictOnSerialization(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
    throw new ConflictException({ code: 'FISCAL_PROFILE_VERSION_CONFLICT' });
  throw error;
}

/** Fiscal details live in Billing's existing profile and verified-activity tables. */
@Injectable()
export class OnboardingV2FiscalDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PrismaConsumerV2Repository,
  ) {}

  async read(p: ConsumerV2Principal) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.repository.assertPrincipalForScope(tx, p, 'fiscal-v2:onboarding:read');
        const [profile, activities, company] = await Promise.all([
          tx.companyFiscalProfile.findFirst({
            where: { tenantId: p.tenantId, companyId: p.companyId },
            select: {
              id: true,
              province: true,
              canton: true,
              district: true,
              barrio: true,
              otrasSenas: true,
              email: true,
              phoneCountryCode: true,
              phoneNumber: true,
              proveedorSistemas: true,
              defaultEconomicActivityId: true,
              updatedAt: true,
            },
          }),
          tx.companyEconomicActivity.findMany({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              verificationSource: 'HACIENDA_FE_AE',
            },
            orderBy: { code: 'asc' },
            select: {
              id: true,
              code: true,
              description: true,
              haciendaStatus: true,
              billingEnabled: true,
              verifiedAt: true,
              verificationSource: true,
            },
          }),
          tx.company.findFirst({
            where: { id: p.companyId, tenantId: p.tenantId },
            select: {
              haciendaVerificationStatus: true,
              haciendaVerifiedAt: true,
              haciendaTaxSituation: true,
            },
          }),
        ]);
        if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
        const version = profile ? await this.version(tx, p) : 'absent';
        return {
          companyId: p.companyId,
          environment: p.environment,
          profile: profile
            ? { ...profile, updatedAt: profile.updatedAt.toISOString(), version }
            : null,
          activities: activities.map((activity) => ({
            code: activity.code,
            description: activity.description,
            haciendaStatus: activity.haciendaStatus,
            billingEnabled: activity.billingEnabled,
            verifiedAt: activity.verifiedAt.toISOString(),
            verificationSource: activity.verificationSource,
            selected: activity.id === profile?.defaultEconomicActivityId,
          })),
          taxpayerVerification: {
            status: company.haciendaVerificationStatus ?? 'PENDING',
            verifiedAt: company.haciendaVerifiedAt?.toISOString() ?? null,
            taxSituation: company.haciendaTaxSituation ?? null,
          },
          externalCall: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async version(tx: Prisma.TransactionClient, p: ConsumerV2Principal) {
    const rows = await tx.$queryRaw<{ version: string }[]>`SELECT xmin::text AS version
      FROM company_fiscal_profiles WHERE company_id = ${p.companyId}::uuid AND tenant_id = ${p.tenantId}::uuid`;
    return rows[0]?.version ?? 'absent';
  }

  async patchProfile(
    p: ConsumerV2Principal,
    dto: PatchFiscalProfileV2Dto,
    ifMatch: string | undefined,
  ) {
    const changes = dto ? Object.entries(dto).filter(([, value]) => value !== undefined) : [];
    if (
      !dto ||
      !changes.length ||
      changes.some(([, value]) => value === null || (typeof value === 'string' && !value.trim()))
    )
      throw new BadRequestException({ code: 'FISCAL_PROFILE_PATCH_INVALID' });
    if (!ifMatch) throw new BadRequestException({ code: 'FISCAL_PROFILE_VERSION_REQUIRED' });
    return this.prisma
      .$transaction(
        async (tx) => {
          await this.repository.assertPrincipalForScope(
            tx,
            p,
            'fiscal-v2:onboarding:profile:write',
          );
          await tx.$queryRaw`SELECT id FROM companies WHERE id = ${p.companyId}::uuid AND tenant_id = ${p.tenantId}::uuid FOR UPDATE`;
          const company = await tx.company.findFirst({
            where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
          const current = await tx.companyFiscalProfile.findFirst({
            where: { tenantId: p.tenantId, companyId: p.companyId },
          });
          const currentVersion = current ? await this.version(tx, p) : 'absent';
          if (
            current &&
            changes.every(
              ([field, value]) =>
                (current as unknown as Record<string, unknown>)[field] === value.trim(),
            )
          )
            return profileResponse(p, current, currentVersion);
          if (currentVersion !== ifMatch)
            throw new ConflictException({ code: 'FISCAL_PROFILE_VERSION_CONFLICT' });
          const merged = {
            province: dto.province ?? current?.province,
            canton: dto.canton ?? current?.canton,
            district: dto.district ?? current?.district,
            barrio: dto.barrio ?? current?.barrio ?? undefined,
            otrasSenas: dto.otrasSenas ?? current?.otrasSenas,
            email: dto.email ?? current?.email,
            phoneCountryCode: dto.phoneCountryCode ?? current?.phoneCountryCode ?? undefined,
            phoneNumber: dto.phoneNumber ?? current?.phoneNumber ?? undefined,
            proveedorSistemas:
              dto.proveedorSistemas?.trim() ?? current?.proveedorSistemas ?? undefined,
          };
          let address: FiscalAddress;
          let contact: FiscalContact;
          try {
            address = FiscalAddress.create({
              province: merged.province!,
              canton: merged.canton!,
              district: merged.district!,
              barrio: merged.barrio,
              otrasSenas: merged.otrasSenas!,
            });
            contact = FiscalContact.create({
              email: merged.email!,
              phoneCountryCode: merged.phoneCountryCode,
              phoneNumber: merged.phoneNumber,
            });
          } catch {
            throw new BadRequestException({ code: 'FISCAL_PROFILE_INCOMPLETE_OR_INVALID' });
          }
          const data = {
            ...address.props,
            ...contact.props,
            proveedorSistemas: merged.proveedorSistemas,
          };
          const saved = await tx.companyFiscalProfile.upsert({
            where: { companyId: p.companyId },
            create: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              economicActivityCode: null,
              ...data,
            },
            update: data,
          });
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              apiKeyId: p.apiKeyId,
              actor: `apikey:${p.apiKeyId}`,
              action: 'onboarding-v2.profile.updated',
              eventClass: 'FISCAL_AUDIT',
              metadata: {
                environment: p.environment,
                associationId: p.associationId,
                changedFields: changes.map(([field]) => field),
              },
            },
          });
          return profileResponse(p, saved, await this.version(tx, p));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(conflictOnSerialization);
  }

  async selectDefaultActivity(p: ConsumerV2Principal, code: string, ifMatch: string | undefined) {
    if (!ifMatch) throw new BadRequestException({ code: 'FISCAL_PROFILE_VERSION_REQUIRED' });
    return this.prisma
      .$transaction(
        async (tx) => {
          await this.repository.assertPrincipalForScope(
            tx,
            p,
            'fiscal-v2:onboarding:activity:write',
          );
          await tx.$queryRaw`SELECT id FROM companies WHERE id = ${p.companyId}::uuid AND tenant_id = ${p.tenantId}::uuid FOR UPDATE`;
          const activity = await tx.companyEconomicActivity.findFirst({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              code,
              haciendaStatus: 'A',
              billingEnabled: true,
              verificationSource: 'HACIENDA_FE_AE',
            },
          });
          if (!activity) throw new NotFoundException({ code: 'VERIFIED_ACTIVITY_NOT_FOUND' });
          const profile = await tx.companyFiscalProfile.findFirst({
            where: { tenantId: p.tenantId, companyId: p.companyId },
          });
          if (!profile) throw new ConflictException({ code: 'FISCAL_PROFILE_REQUIRED' });
          const currentVersion = await this.version(tx, p);
          if (profile.defaultEconomicActivityId === activity.id)
            return {
              companyId: p.companyId,
              environment: p.environment,
              code: activity.code,
              version: currentVersion,
              updatedAt: profile.updatedAt.toISOString(),
            };
          if (currentVersion !== ifMatch)
            throw new ConflictException({ code: 'FISCAL_PROFILE_VERSION_CONFLICT' });
          const saved = await tx.companyFiscalProfile.update({
            where: { companyId: p.companyId },
            data: { defaultEconomicActivityId: activity.id, economicActivityCode: activity.code },
          });
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              apiKeyId: p.apiKeyId,
              actor: `apikey:${p.apiKeyId}`,
              action: 'onboarding-v2.activity.selected',
              eventClass: 'FISCAL_AUDIT',
              metadata: {
                environment: p.environment,
                associationId: p.associationId,
                code: activity.code,
              },
            },
          });
          return {
            companyId: p.companyId,
            environment: p.environment,
            code: activity.code,
            updatedAt: saved.updatedAt.toISOString(),
            version: await this.version(tx, p),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(conflictOnSerialization);
  }
}
