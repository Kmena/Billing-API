import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../audit/application/audit.service';
import { FiscalReadinessService } from '../../fiscal-documents/application/fiscal-xml/fiscal-readiness.service';
import {
  INVENTORI_FISCAL_PROFILE,
  INVENTORI_FISCAL_V1_SCOPES,
} from '../domain/inventori-fiscal-profile';
import type {
  BootstrapFiscalIssuerDto,
  FiscalOnboardingDocumentTypeDto,
  FiscalOnboardingEnvironmentDto,
  ProvisionFiscalIssuerDto,
} from '../infrastructure/http/fiscal-onboarding-v1.dto';

type Environment = `${FiscalOnboardingEnvironmentDto}`;
type DocumentType = `${FiscalOnboardingDocumentTypeDto}`;

@Injectable()
export class FiscalOnboardingV1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly readiness: FiscalReadinessService,
  ) {}

  async provisionAssociation(input: {
    tenantId: string;
    actor: string;
    dto: ProvisionFiscalIssuerDto;
  }) {
    const execute = async () =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.fiscalIntegrationAssociation.findUnique({
            where: {
              tenantId_provider_externalCompanyKey: {
                tenantId: input.tenantId,
                provider: 'INVENTORI',
                externalCompanyKey: input.dto.externalCompanyKey,
              },
            },
            include: { company: true },
          });
          if (existing) {
            this.assertEquivalentAssociation(existing.company, input.dto);
            return this.toAssociationResponse(existing);
          }

          let company = input.dto.companyId
            ? await tx.company.findFirst({
                where: { id: input.dto.companyId, tenantId: input.tenantId, status: 'ACTIVE' },
              })
            : await tx.company.findUnique({
                where: {
                  tenantId_identificationNumber: {
                    tenantId: input.tenantId,
                    identificationNumber: input.dto.identificationNumber,
                  },
                },
              });

          if (input.dto.companyId && !company) {
            throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
          }
          if (company) {
            this.assertEquivalentAssociation(company, input.dto);
          } else {
            company = await tx.company.create({
              data: {
                id: randomUUID(),
                tenantId: input.tenantId,
                legalName: input.dto.legalName.trim(),
                tradeName: input.dto.tradeName?.trim() || null,
                identificationType: input.dto.identificationType,
                identificationNumber: input.dto.identificationNumber.trim(),
                status: 'ACTIVE',
              },
            });
          }

          const association = await tx.fiscalIntegrationAssociation.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              companyId: company.id,
              provider: 'INVENTORI',
              externalCompanyKey: input.dto.externalCompanyKey,
              profileVersion: INVENTORI_FISCAL_PROFILE,
            },
            include: { company: true },
          });
          return this.toAssociationResponse(association);
        },
        { isolationLevel: 'Serializable' },
      );

    try {
      const result = await execute();
      this.record(input.tenantId, result.company.id, input.actor, 'fiscal-onboarding.associated', {
        profileVersion: result.profileVersion,
      });
      return result;
    } catch (error) {
      if (!this.isUniqueOrSerializationError(error)) throw error;
      const existing = await this.prisma.fiscalIntegrationAssociation.findUnique({
        where: {
          tenantId_provider_externalCompanyKey: {
            tenantId: input.tenantId,
            provider: 'INVENTORI',
            externalCompanyKey: input.dto.externalCompanyKey,
          },
        },
        include: { company: true },
      });
      if (!existing) throw new ConflictException({ code: 'ASSOCIATION_CONCURRENT_CONFLICT' });
      this.assertEquivalentAssociation(existing.company, input.dto);
      return this.toAssociationResponse(existing);
    }
  }

  async bootstrapAssociation(input: {
    tenantId: string;
    bootstrapKeyId: string;
    actor: string;
    dto: BootstrapFiscalIssuerDto;
  }) {
    const association = await this.provisionAssociation({
      tenantId: input.tenantId,
      actor: input.actor,
      dto: {
        externalCompanyKey: input.dto.externalCompanyKey,
        companyId: input.dto.existingCompanyId,
        legalName: input.dto.legalName,
        tradeName: input.dto.tradeName,
        identificationType: input.dto.identificationType,
        identificationNumber: input.dto.identificationNumber,
      },
    });
    const apiEnvironment = input.dto.environment === 'SANDBOX' ? 'TEST' : 'LIVE';
    const credentialName = `inventori-fiscal:${input.dto.externalCompanyKey}:${input.dto.environment}`;
    const prefix = randomBytes(4).toString('hex');
    const fullKey = `bk_${apiEnvironment === 'TEST' ? 'test' : 'live'}_${prefix}_${randomBytes(16).toString('hex')}`;
    const keyHash = await argon2.hash(fullKey, { type: argon2.argon2id });
    const operationalKeyId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${credentialName}`}, 0))`;
      await tx.apiKey.updateMany({
        where: {
          tenantId: input.tenantId,
          name: credentialName,
          integrationProfile: INVENTORI_FISCAL_PROFILE,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedBy: input.bootstrapKeyId,
        },
      });
      await tx.apiKey.create({
        data: {
          id: operationalKeyId,
          tenantId: input.tenantId,
          name: credentialName,
          environment: apiEnvironment,
          keyPrefix: prefix,
          keyHash,
          scopes: [...INVENTORI_FISCAL_V1_SCOPES],
          integrationProfile: INVENTORI_FISCAL_PROFILE,
          status: 'ACTIVE',
        },
      });
      await tx.apiKeyCompany.create({
        data: { apiKeyId: operationalKeyId, companyId: association.company.id },
      });
    });

    this.record(
      input.tenantId,
      association.company.id,
      input.actor,
      'fiscal-onboarding.credential-issued',
      {
        apiKeyId: operationalKeyId,
        keyPrefix: prefix,
        environment: input.dto.environment,
        profileVersion: INVENTORI_FISCAL_PROFILE,
      },
    );
    return {
      association,
      credential: {
        apiKeyId: operationalKeyId,
        keyPrefix: prefix,
        secret: fullKey,
        environment: apiEnvironment,
        profileVersion: INVENTORI_FISCAL_PROFILE,
        returnedOnce: true,
      },
    };
  }

  async getAssociation(tenantId: string, companyId: string) {
    const association = await this.prisma.fiscalIntegrationAssociation.findFirst({
      where: { tenantId, companyId, provider: 'INVENTORI' },
      include: { company: true },
    });
    if (!association) throw new NotFoundException({ code: 'FISCAL_ASSOCIATION_NOT_FOUND' });
    return this.toAssociationResponse(association);
  }

  async createBranch(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    code: string;
    name: string;
    actor: string;
  }) {
    await this.assertCompany(input.tenantId, input.companyId);
    const branch = await this.prisma.fiscalBranch.upsert({
      where: {
        companyId_environment_code: {
          companyId: input.companyId,
          environment: input.environment,
          code: input.code,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        code: input.code,
        name: input.name.trim(),
        active: true,
      },
      update: { name: input.name.trim() },
    });
    this.record(input.tenantId, input.companyId, input.actor, 'fiscal-branch.upserted', {
      branchId: branch.id,
      environment: input.environment,
      code: branch.code,
    });
    return branch;
  }

  listBranches(tenantId: string, companyId: string, environment: Environment) {
    return this.prisma.fiscalBranch.findMany({
      where: { tenantId, companyId, environment },
      orderBy: { code: 'asc' },
      include: { terminals: { orderBy: { code: 'asc' } } },
    });
  }

  async createTerminal(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    branchId: string;
    code: string;
    name: string;
    actor: string;
  }) {
    const branch = await this.prisma.fiscalBranch.findFirst({
      where: {
        id: input.branchId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        active: true,
      },
    });
    if (!branch) throw new NotFoundException({ code: 'FISCAL_BRANCH_NOT_FOUND' });

    const terminal = await this.prisma.fiscalTerminal.upsert({
      where: { branchId_code: { branchId: branch.id, code: input.code } },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        branchId: branch.id,
        environment: input.environment,
        code: input.code,
        name: input.name.trim(),
        active: true,
      },
      update: { name: input.name.trim() },
    });

    await this.prisma.fiscalIssuancePoint.upsert({
      where: {
        companyId_environment_branchCode_terminalCode: {
          companyId: input.companyId,
          environment: input.environment,
          branchCode: branch.code,
          terminalCode: terminal.code,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        branchCode: branch.code,
        terminalCode: terminal.code,
        branchId: branch.id,
        terminalId: terminal.id,
        name: terminal.name,
        active: true,
        isDefault: false,
      },
      update: {
        branchId: branch.id,
        terminalId: terminal.id,
        name: terminal.name,
        active: true,
      },
    });
    this.record(input.tenantId, input.companyId, input.actor, 'fiscal-terminal.upserted', {
      branchId: branch.id,
      terminalId: terminal.id,
      environment: input.environment,
      code: terminal.code,
    });
    return terminal;
  }

  async setBranchActive(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    branchId: string;
    active: boolean;
    actor: string;
  }) {
    const branch = await this.prisma.fiscalBranch.findFirst({ where: this.branchScope(input) });
    if (!branch) throw new NotFoundException({ code: 'FISCAL_BRANCH_NOT_FOUND' });
    if (!input.active) {
      const defaultPoint = await this.prisma.fiscalIssuancePoint.findFirst({
        where: { branchId: branch.id, active: true, isDefault: true },
      });
      if (defaultPoint) throw new ConflictException({ code: 'DEFAULT_ISSUANCE_POINT_ACTIVE' });
    }
    const updated = await this.prisma.fiscalBranch.update({
      where: { id: branch.id },
      data: { active: input.active },
    });
    this.record(input.tenantId, input.companyId, input.actor, 'fiscal-branch.status-changed', {
      branchId: branch.id,
      active: input.active,
    });
    return updated;
  }

  async setTerminalActive(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    terminalId: string;
    active: boolean;
    actor: string;
  }) {
    const terminal = await this.prisma.fiscalTerminal.findFirst({
      where: {
        id: input.terminalId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
      },
    });
    if (!terminal) throw new NotFoundException({ code: 'FISCAL_TERMINAL_NOT_FOUND' });
    if (!input.active) {
      const point = await this.prisma.fiscalIssuancePoint.findFirst({
        where: { terminalId: terminal.id, active: true, isDefault: true },
      });
      if (point) throw new ConflictException({ code: 'DEFAULT_ISSUANCE_POINT_ACTIVE' });
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.fiscalTerminal.update({
        where: { id: terminal.id },
        data: { active: input.active },
      }),
      this.prisma.fiscalIssuancePoint.updateMany({
        where: { terminalId: terminal.id },
        data: { active: input.active },
      }),
    ]);
    this.record(input.tenantId, input.companyId, input.actor, 'fiscal-terminal.status-changed', {
      terminalId: terminal.id,
      active: input.active,
    });
    return updated;
  }

  async selectDefaultIssuancePoint(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    terminalId: string;
    actor: string;
  }) {
    try {
      const point = await this.prisma.$transaction(
        async (tx) => {
          const terminal = await tx.fiscalTerminal.findFirst({
            where: {
              id: input.terminalId,
              tenantId: input.tenantId,
              companyId: input.companyId,
              environment: input.environment,
              active: true,
              branch: { active: true },
            },
            include: { branch: true },
          });
          if (!terminal) throw new BadRequestException({ code: 'FISCAL_TERMINAL_NOT_ELIGIBLE' });
          await tx.fiscalIssuancePoint.updateMany({
            where: {
              tenantId: input.tenantId,
              companyId: input.companyId,
              environment: input.environment,
              isDefault: true,
            },
            data: { isDefault: false },
          });
          return tx.fiscalIssuancePoint.upsert({
            where: {
              companyId_environment_branchCode_terminalCode: {
                companyId: input.companyId,
                environment: input.environment,
                branchCode: terminal.branch.code,
                terminalCode: terminal.code,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: input.tenantId,
              companyId: input.companyId,
              environment: input.environment,
              branchCode: terminal.branch.code,
              terminalCode: terminal.code,
              branchId: terminal.branch.id,
              terminalId: terminal.id,
              name: terminal.name,
              active: true,
              isDefault: true,
            },
            update: {
              branchId: terminal.branch.id,
              terminalId: terminal.id,
              active: true,
              isDefault: true,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      this.record(
        input.tenantId,
        input.companyId,
        input.actor,
        'fiscal-issuance-point.default-selected',
        {
          issuancePointId: point.id,
          environment: input.environment,
        },
      );
      return point;
    } catch (error) {
      if (this.isUniqueOrSerializationError(error)) {
        throw new ConflictException({ code: 'DEFAULT_ISSUANCE_POINT_CONCURRENT_CONFLICT' });
      }
      throw error;
    }
  }

  getDefaultIssuancePoint(tenantId: string, companyId: string, environment: Environment) {
    return this.prisma.fiscalIssuancePoint.findFirst({
      where: { tenantId, companyId, environment, active: true, isDefault: true },
      select: {
        id: true,
        environment: true,
        branchCode: true,
        terminalCode: true,
        branchId: true,
        terminalId: true,
        name: true,
        active: true,
        isDefault: true,
      },
    });
  }

  async configureInitialSequence(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    terminalId: string;
    documentType: DocumentType;
    nextValue: bigint;
    actor: string;
  }) {
    if (input.nextValue < 1n || input.nextValue > 9999999999n) {
      throw new BadRequestException({ code: 'INVALID_SEQUENCE_VALUE' });
    }
    const terminal = await this.prisma.fiscalTerminal.findFirst({
      where: {
        id: input.terminalId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        active: true,
        branch: { active: true },
      },
      include: { branch: true },
    });
    if (!terminal) throw new NotFoundException({ code: 'FISCAL_TERMINAL_NOT_FOUND' });

    const key = {
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: input.environment,
      branchCode: terminal.branch.code,
      terminalCode: terminal.code,
      documentType: input.documentType,
    };
    const existing = await this.prisma.fiscalSequence.findUnique({
      where: { tenantId_companyId_environment_branchCode_terminalCode_documentType: key },
    });
    if (existing) return this.resolveExistingSequence(existing, input.nextValue);

    try {
      const created = await this.prisma.fiscalSequence.create({
        data: { id: randomUUID(), ...key, nextValue: input.nextValue },
      });
      this.record(input.tenantId, input.companyId, input.actor, 'fiscal-sequence.initialized', {
        sequenceId: created.id,
        environment: input.environment,
        branchCode: created.branchCode,
        terminalCode: created.terminalCode,
        documentType: created.documentType,
        nextValue: created.nextValue.toString(),
      });
      return this.serializeSequence(created);
    } catch (error) {
      if (!this.isUniqueOrSerializationError(error)) throw error;
      const raced = await this.prisma.fiscalSequence.findUnique({
        where: { tenantId_companyId_environment_branchCode_terminalCode_documentType: key },
      });
      if (!raced) throw new ConflictException({ code: 'SEQUENCE_INITIALIZATION_CONFLICT' });
      return this.resolveExistingSequence(raced, input.nextValue);
    }
  }

  async getSequence(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    terminalId: string;
    documentType: DocumentType;
  }) {
    const terminal = await this.prisma.fiscalTerminal.findFirst({
      where: {
        id: input.terminalId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
      },
      include: { branch: true },
    });
    if (!terminal) throw new NotFoundException({ code: 'FISCAL_TERMINAL_NOT_FOUND' });
    const sequence = await this.prisma.fiscalSequence.findUnique({
      where: {
        tenantId_companyId_environment_branchCode_terminalCode_documentType: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          environment: input.environment,
          branchCode: terminal.branch.code,
          terminalCode: terminal.code,
          documentType: input.documentType,
        },
      },
    });
    if (!sequence) throw new NotFoundException({ code: 'FISCAL_SEQUENCE_NOT_FOUND' });
    return this.serializeSequence(sequence);
  }

  async evaluateReadiness(tenantId: string, companyId: string, environment: Environment) {
    const base = await this.readiness.evaluate({ tenantId, companyId, environment });
    const [company, profile, activities, connection, certificate, point] = await Promise.all([
      this.prisma.company.findFirst({
        where: { id: companyId, tenantId },
        select: { id: true, status: true, haciendaVerificationStatus: true },
      }),
      this.prisma.companyFiscalProfile.findFirst({
        where: { companyId, tenantId },
        select: { id: true, defaultEconomicActivityId: true },
      }),
      this.prisma.companyEconomicActivity.findMany({
        where: { companyId, tenantId },
        select: { id: true, code: true, haciendaStatus: true, billingEnabled: true },
      }),
      this.prisma.haciendaConnection.findFirst({
        where: { companyId, tenantId, environment },
        select: { id: true, status: true, lastValidatedAt: true },
      }),
      this.prisma.fiscalSigningCertificate.findFirst({
        where: { companyId, tenantId, environment, status: 'ACTIVE' },
        select: { id: true, status: true, fingerprintSha256: true, validFrom: true, validTo: true },
      }),
      this.getDefaultIssuancePoint(tenantId, companyId, environment),
    ]);
    const sequenceCount = point
      ? await this.prisma.fiscalSequence.count({
          where: {
            tenantId,
            companyId,
            environment,
            branchCode: point.branchCode,
            terminalCode: point.terminalCode,
          },
        })
      : 0;
    const blockerSet = new Set(base.reasonCodes);
    const dimension = (blockers: string[], metadata: Record<string, unknown> = {}) => ({
      state: blockers.some((code) => blockerSet.has(code as never)) ? 'NOT_READY' : 'READY',
      blockers: blockers.filter((code) => blockerSet.has(code as never)),
      metadata,
    });
    return {
      contractVersion: '1.0',
      profileVersion: INVENTORI_FISCAL_PROFILE,
      companyId,
      environment,
      status: base.readyToIssue ? 'READY' : 'NOT_READY',
      readyToIssue: base.readyToIssue,
      checkedAt: base.checkedAt,
      blockers: base.reasonCodes,
      warnings: base.warnings,
      dimensions: {
        issuer: dimension(
          ['TAXPAYER_VALIDATION_MISSING', 'TAXPAYER_IDENTITY_MISMATCH', 'TAXPAYER_NOT_ACTIVE'],
          {
            companyActive: company?.status === 'ACTIVE',
            verificationStatus: company?.haciendaVerificationStatus ?? null,
          },
        ),
        profile: dimension(['FISCAL_PROFILE_MISSING'], { configured: Boolean(profile) }),
        activity: dimension(
          [
            'ECONOMIC_ACTIVITY_MISSING',
            'DEFAULT_ECONOMIC_ACTIVITY_MISSING',
            'DEFAULT_ECONOMIC_ACTIVITY_INVALID',
          ],
          {
            count: activities.length,
            defaultActivityId: profile?.defaultEconomicActivityId ?? null,
          },
        ),
        hacienda: dimension(['HACIENDA_CONNECTION_MISSING', 'HACIENDA_CREDENTIALS_MISSING'], {
          status: connection?.status ?? 'NOT_CONFIGURED',
          lastValidatedAt: connection?.lastValidatedAt ?? null,
        }),
        certificate: dimension(
          [
            'ACTIVE_CERTIFICATE_MISSING',
            'CERTIFICATE_EXPIRED',
            'CERTIFICATE_NOT_YET_VALID',
            'CERTIFICATE_IDENTITY_UNVERIFIED',
            'CERTIFICATE_IDENTITY_MISMATCH',
            'FISCAL_SIGNING_CERTIFICATE_SECRET_UNAVAILABLE',
          ],
          certificate
            ? {
                id: certificate.id,
                status: certificate.status,
                fingerprintSha256: certificate.fingerprintSha256,
                validFrom: certificate.validFrom,
                validTo: certificate.validTo,
              }
            : { status: 'MISSING' },
        ),
        issuancePoint: dimension(['ISSUANCE_POINT_MISSING'], point ?? { status: 'MISSING' }),
        sequence: {
          state: point ? 'READY' : 'NOT_READY',
          blockers: point ? [] : ['ISSUANCE_POINT_MISSING'],
          metadata: { configuredTypes: sequenceCount, automaticInitialization: true },
        },
        operational: { state: 'READY', blockers: [], metadata: { database: 'AVAILABLE' } },
      },
    };
  }

  private resolveExistingSequence(
    sequence: {
      id: string;
      nextValue: bigint;
      lastAssigned: bigint | null;
      [key: string]: unknown;
    },
    requested: bigint,
  ) {
    if (sequence.lastAssigned !== null)
      throw new ConflictException({ code: 'FISCAL_SEQUENCE_ALREADY_STARTED' });
    if (sequence.nextValue !== requested)
      throw new ConflictException({ code: 'FISCAL_SEQUENCE_INITIAL_VALUE_CONFLICT' });
    return this.serializeSequence(sequence);
  }

  private serializeSequence(sequence: {
    nextValue: bigint;
    lastAssigned: bigint | null;
    [key: string]: unknown;
  }) {
    return {
      ...sequence,
      nextValue: sequence.nextValue.toString(),
      lastAssigned: sequence.lastAssigned?.toString() ?? null,
    };
  }

  private async assertCompany(tenantId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
  }

  private branchScope(input: {
    tenantId: string;
    companyId: string;
    environment: Environment;
    branchId: string;
  }) {
    return {
      id: input.branchId,
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: input.environment,
    };
  }

  private assertEquivalentAssociation(
    company: { id: string; identificationType: string; identificationNumber: string },
    dto: ProvisionFiscalIssuerDto,
  ) {
    if (
      (dto.companyId && company.id !== dto.companyId) ||
      company.identificationType !== dto.identificationType ||
      company.identificationNumber !== dto.identificationNumber.trim()
    ) {
      throw new ConflictException({ code: 'FISCAL_ASSOCIATION_PAYLOAD_CONFLICT' });
    }
  }

  private toAssociationResponse(association: {
    id: string;
    externalCompanyKey: string;
    profileVersion: string;
    createdAt: Date;
    updatedAt: Date;
    company: {
      id: string;
      tenantId: string;
      legalName: string;
      tradeName: string | null;
      identificationType: string;
      identificationNumber: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }) {
    return {
      associationId: association.id,
      externalCompanyKey: association.externalCompanyKey,
      profileVersion: association.profileVersion,
      company: association.company,
      createdAt: association.createdAt,
      updatedAt: association.updatedAt,
    };
  }

  private isUniqueOrSerializationError(error: unknown): boolean {
    const candidate = error as { code?: string };
    return (
      candidate?.code === 'P2002' || candidate?.code === 'P2034' || candidate?.code === '40001'
    );
  }

  private record(
    tenantId: string,
    companyId: string,
    actor: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    this.audit.record({
      tenantId,
      companyId,
      actor,
      action,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata,
    });
  }
}
