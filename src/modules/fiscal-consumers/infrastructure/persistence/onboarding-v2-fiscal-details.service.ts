import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CompanyFiscalProfile, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { FiscalAddress } from '../../../companies/domain/value-objects/fiscal-address.vo';
import { FiscalContact } from '../../../companies/domain/value-objects/fiscal-contact.vo';
import { ConsumerV2Principal } from '../http/consumer-v2.guard';
import { PatchFiscalProfileV2Dto } from '../http/onboarding-v2.dto';
import { PrismaConsumerV2Repository } from './prisma-consumer-v2.repository';
import { SPEC09_TAXPAYER_LOOKUP, Spec09TaxpayerLookup } from './spec09-taxpayer-lookup';
import { HaciendaUnavailableException } from '../../../../infrastructure/integrations/hacienda/exceptions/hacienda-unavailable.exception';

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
    @Inject(SPEC09_TAXPAYER_LOOKUP) private readonly taxpayerLookup: Spec09TaxpayerLookup,
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

  /** Import only the activities returned for Billing's existing legal identity. */
  async verifyTaxpayer(p: ConsumerV2Principal) {
    if (!this.taxpayerLookup) throw new ConflictException({ code: 'TAXPAYER_LOOKUP_DISABLED' });
    const identity = await this.prisma.$transaction(async (tx) => {
      await this.repository.assertPrincipalForScope(tx, p, 'fiscal-v2:onboarding:activity:write');
      const company = await tx.company.findFirst({
        where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
        select: { identificationNumber: true, identificationType: true },
      });
      if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
      return company;
    });
    let taxpayer;
    try {
      taxpayer = await this.taxpayerLookup.getTaxpayer(identity.identificationNumber);
    } catch (error) {
      if (error instanceof HaciendaUnavailableException)
        throw new ServiceUnavailableException({ code: 'TAXPAYER_LOOKUP_UNAVAILABLE' });
      throw error;
    }
    if (!taxpayer.found) throw new NotFoundException({ code: 'TAXPAYER_NOT_FOUND' });
    const returnedType = (
      { '01': 'FISICA', '02': 'JURIDICA', '03': 'DIMEX', '04': 'NITE' } as Record<string, string>
    )[taxpayer.identificationType ?? ''];
    if (
      taxpayer.identification !== identity.identificationNumber ||
      returnedType !== identity.identificationType
    )
      throw new ConflictException({ code: 'TAXPAYER_IDENTITY_MISMATCH' });
    const activities = taxpayer.economicActivities ?? [];
    if (
      !taxpayer.name?.trim() ||
      taxpayer.name.length > 255 ||
      !taxpayer.taxSituation?.trim() ||
      taxpayer.taxSituation.length > 100 ||
      typeof taxpayer.moroso !== 'boolean' ||
      typeof taxpayer.omiso !== 'boolean' ||
      activities.length > 100 ||
      activities.some(
        (activity) =>
          !activity.code?.trim() ||
          activity.code.length > 20 ||
          !activity.description?.trim() ||
          activity.description.length > 255 ||
          !['A', 'I'].includes(activity.status),
      ) ||
      new Set(activities.map((activity) => activity.code)).size !== activities.length
    )
      throw new ServiceUnavailableException({ code: 'TAXPAYER_LOOKUP_INVALID_RESPONSE' });
    const now = new Date();
    await this.prisma
      .$transaction(
        async (tx) => {
          await this.repository.assertPrincipalForScope(
            tx,
            p,
            'fiscal-v2:onboarding:activity:write',
          );
          await tx.$queryRaw`SELECT id FROM companies
        WHERE id = ${p.companyId}::uuid AND tenant_id = ${p.tenantId}::uuid FOR UPDATE`;
          const current = await tx.company.findFirst({
            where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
            select: { identificationNumber: true, identificationType: true },
          });
          if (
            !current ||
            current.identificationNumber !== identity.identificationNumber ||
            current.identificationType !== identity.identificationType
          )
            throw new ConflictException({ code: 'TAXPAYER_IDENTITY_CHANGED' });
          await tx.company.update({
            where: { id: p.companyId },
            data: {
              haciendaName: taxpayer.name,
              haciendaVerifiedAt: now,
              haciendaVerificationStatus: 'VERIFIED',
              haciendaTaxSituation: taxpayer.taxSituation,
              haciendaMoroso: taxpayer.moroso,
              haciendaOmiso: taxpayer.omiso,
            },
          });
          for (const activity of activities) {
            await tx.companyEconomicActivity.upsert({
              where: { companyId_code: { companyId: p.companyId, code: activity.code } },
              create: {
                id: randomUUID(),
                tenantId: p.tenantId,
                companyId: p.companyId,
                code: activity.code,
                description: activity.description,
                haciendaStatus: activity.status,
                haciendaKind: activity.type ?? null,
                billingEnabled: true,
                verifiedAt: now,
                lastSeenAt: now,
                verificationSource: 'HACIENDA_FE_AE',
              },
              update: {
                description: activity.description,
                haciendaStatus: activity.status,
                haciendaKind: activity.type ?? null,
                verifiedAt: now,
                lastSeenAt: now,
                verificationSource: 'HACIENDA_FE_AE',
              },
            });
          }
          await tx.companyEconomicActivity.updateMany({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              verificationSource: 'HACIENDA_FE_AE',
              code: { notIn: activities.map((activity) => activity.code) },
              haciendaStatus: 'A',
            },
            data: { haciendaStatus: 'I', lastSeenAt: now },
          });
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              apiKeyId: p.apiKeyId,
              actor: `apikey:${p.apiKeyId}`,
              action: 'onboarding-v2.taxpayer.verified',
              eventClass: 'FISCAL_AUDIT',
              metadata: {
                environment: p.environment,
                associationId: p.associationId,
                source: 'HACIENDA_FE_AE',
                activitiesCount: activities.length,
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(conflictOnSerialization);
    return {
      status: 'VERIFIED',
      activitiesCount: activities.length,
      verifiedAt: now.toISOString(),
    };
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
