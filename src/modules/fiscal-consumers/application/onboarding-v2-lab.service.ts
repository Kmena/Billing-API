import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../infrastructure/secrets/ports/secret-provider.port';
import { Inject } from '@nestjs/common';
import { FiscalOnboardingV1Service } from '../../fiscal-onboarding/application/fiscal-onboarding-v1.service';
import { ConfigureConnectionHandler } from '../../hacienda-connection/application/use-cases/configure-connection/configure-connection.handler';
import { UploadFiscalSigningCertificateService } from '../../fiscal-documents/application/fiscal-xml/upload-fiscal-signing-certificate.service';
import { FiscalReadCertificateMetadataService } from '../../fiscal-documents/application/fiscal-xml/fiscal-read-certificate-metadata.service';
import { ConsumerV2LabService } from './consumer-v2-lab.service';
import { PrismaConsumerV2Repository } from '../infrastructure/persistence/prisma-consumer-v2.repository';
import { ConsumerV2Principal } from '../infrastructure/http/consumer-v2.guard';
import {
  ConfigureBranchV2Dto,
  ConfigureCredentialsV2Dto,
  ConfigureIssuerV2Dto,
} from '../infrastructure/http/onboarding-v2.dto';
import { ConsumerV2Scope } from '../domain/consumer-v2.policy';

/** Isolated lab facade over Billing's existing company, secret and fiscal tables. */
@Injectable()
export class OnboardingV2LabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: FiscalOnboardingV1Service,
    private readonly configureConnection: ConfigureConnectionHandler,
    private readonly uploadCertificate: UploadFiscalSigningCertificateService,
    private readonly readCertificate: FiscalReadCertificateMetadataService,
    private readonly consumers: ConsumerV2LabService,
    private readonly repository: PrismaConsumerV2Repository,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  private actor(p: ConsumerV2Principal) {
    return `apikey:${p.apiKeyId}`;
  }

  private async assertCurrent(p: ConsumerV2Principal, scope: ConsumerV2Scope) {
    await this.prisma.$transaction((tx) => this.repository.assertPrincipalForScope(tx, p, scope));
  }

  async configuration(p: ConsumerV2Principal) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:read');
    const [issuer, connection, certificate, point] = await Promise.all([
      this.prisma.company.findFirst({
        where: { id: p.companyId, tenantId: p.tenantId },
        select: {
          id: true,
          legalName: true,
          identificationType: true,
          identificationNumber: true,
          haciendaVerificationStatus: true,
          status: true,
        },
      }),
      this.prisma.haciendaConnection.findFirst({
        where: { tenantId: p.tenantId, companyId: p.companyId, environment: p.environment },
        select: { status: true, lastValidatedAt: true },
      }),
      this.prisma.fiscalSigningCertificate.findFirst({
        where: {
          tenantId: p.tenantId,
          companyId: p.companyId,
          environment: p.environment,
          status: 'ACTIVE',
        },
        select: { id: true, status: true, fingerprintSha256: true, validFrom: true, validTo: true },
      }),
      this.onboarding.getDefaultIssuancePoint(p.tenantId, p.companyId, p.environment),
    ]);
    if (!issuer) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    return {
      contractVersion: '2.0-lab',
      companyId: p.companyId,
      environment: p.environment,
      associationId: p.associationId,
      issuer,
      hacienda: {
        status: connection?.status ?? 'NOT_CONFIGURED',
        lastValidatedAt: connection?.lastValidatedAt ?? null,
      },
      certificate: certificate ?? { status: 'MISSING' },
      issuancePoint: point,
      productionAuthorized: false,
    };
  }

  async status(p: ConsumerV2Principal) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:read');
    return this.onboarding.evaluateReadiness(p.tenantId, p.companyId, p.environment);
  }

  async configureIssuer(p: ConsumerV2Principal, dto: ConfigureIssuerV2Dto) {
    // This operation can affirm or update the display name only. A legal identity change
    // is a successor-association operation, never an in-place historical rewrite.
    return this.prisma.$transaction(async (tx) => {
      await this.repository.assertPrincipalForScope(tx, p, 'fiscal-v2:onboarding:issuer:write');
      const company = await tx.company.findFirst({
        where: { id: p.companyId, tenantId: p.tenantId },
      });
      if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
      if (
        company.identificationNumber !== dto.identificationNumber ||
        company.identificationType !== dto.identificationType
      )
        throw new ConflictException({ code: 'ISSUER_LEGAL_IDENTITY_IMMUTABLE' });
      const pending = await tx.fiscalDocument.count({
        where: {
          tenantId: p.tenantId,
          companyId: p.companyId,
          environment: p.environment,
          status: { notIn: ['ACCEPTED', 'REJECTED', 'SUPERSEDED'] },
        },
      });
      const reservations = await tx.fiscalIdempotencyKeyV2.count({
        where: {
          associationId: p.associationId,
          tenantId: p.tenantId,
          state: { in: ['RESERVED', 'RECOVERY_REQUIRED'] },
        },
      });
      if (pending || reservations)
        throw new ConflictException({ code: 'ISSUER_PENDING_OPERATIONS' });
      const result = await tx.company.update({
        where: { id: p.companyId },
        data: { legalName: dto.legalName.trim() },
        select: { id: true, legalName: true, identificationType: true, identificationNumber: true },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: p.tenantId,
          companyId: p.companyId,
          apiKeyId: p.apiKeyId,
          actor: this.actor(p),
          action: 'onboarding-v2.issuer.configured',
          eventClass: 'SECURITY',
          metadata: { environment: p.environment, associationId: p.associationId },
        },
      });
      return result;
    });
  }

  async associate(p: ConsumerV2Principal, externalCompanyKey: string) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:association:write');
    const association = await this.prisma.fiscalConsumerAssociation.findFirst({
      where: {
        id: p.associationId,
        tenantId: p.tenantId,
        environment: p.environment,
        consumerCompany: { companyId: p.companyId, consumerId: p.consumerId },
      },
      select: { id: true, status: true, consumerCompany: { select: { externalCompanyKey: true } } },
    });
    if (!association || association.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'CONSUMER_RESOURCE_NOT_FOUND' });
    if (association.consumerCompany.externalCompanyKey !== externalCompanyKey)
      throw new ConflictException({ code: 'CONSUMER_COMPANY_REMAP_FORBIDDEN' });
    return {
      associationId: association.id,
      companyId: p.companyId,
      environment: p.environment,
      externalCompanyKey,
      status: association.status,
    };
  }

  async credentials(p: ConsumerV2Principal, dto: ConfigureCredentialsV2Dto, rotate: boolean) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:credentials:write');
    const previous = await this.prisma.haciendaConnection.findFirst({
      where: { tenantId: p.tenantId, companyId: p.companyId, environment: p.environment },
      select: { secretReference: true },
    });
    if (rotate && !previous) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
    if (!rotate && previous)
      throw new ConflictException({ code: 'HACIENDA_CONNECTION_ALREADY_CONFIGURED' });
    const saved = await this.configureConnection.execute({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
      username: dto.username,
      password: dto.password,
    });
    if (rotate && previous?.secretReference !== saved.secretReference) {
      // The previous reference is no longer in the connection row. Retire it only
      // after the new credential is committed and its cache entry invalidated.
      await this.secrets.deleteSecret(previous!.secretReference);
    }
    await this.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: p.tenantId,
        companyId: p.companyId,
        apiKeyId: p.apiKeyId,
        actor: this.actor(p),
        action: rotate
          ? 'onboarding-v2.credentials.rotated'
          : 'onboarding-v2.credentials.configured',
        eventClass: 'SECURITY',
        metadata: { environment: p.environment, associationId: p.associationId },
      },
    });
    return {
      companyId: p.companyId,
      environment: p.environment,
      status: saved.status,
      lastValidatedAt: saved.lastValidatedAt,
    };
  }

  async certificate(p: ConsumerV2Principal, bytes: Buffer, pin: string) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:certificate:write');
    if (!bytes.length || bytes.length > 1_048_576 || !pin?.trim())
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_INPUT_INVALID' });
    if (bytes[0] !== 0x30)
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_FORMAT_INVALID' });
    return this.uploadCertificate.execute({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
      pkcs12Bytes: bytes,
      pin,
      actorUserId: this.actor(p),
    });
  }

  async certificateMetadata(p: ConsumerV2Principal) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:read');
    return this.readCertificate.execute({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
    });
  }

  async configureBranch(p: ConsumerV2Principal, dto: ConfigureBranchV2Dto) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:issuance-point:write');
    const branch = await this.onboarding.createBranch({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
      code: dto.branchCode,
      name: dto.branchName,
      actor: this.actor(p),
    });
    const terminal = await this.onboarding.createTerminal({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
      branchId: branch.id,
      code: dto.terminalCode,
      name: dto.terminalName,
      actor: this.actor(p),
    });
    const point = await this.onboarding.selectDefaultIssuancePoint({
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: p.environment,
      terminalId: terminal.id,
      actor: this.actor(p),
    });
    return { branch, terminal, issuancePoint: point };
  }

  async testConnection(p: ConsumerV2Principal) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:connection:test');
    const config = await this.configurationForTest(p);
    const checks = {
      service: true,
      m2mIdentity: true,
      association: true,
      environment: true,
      scopes: true,
      certificate: config.certificate === 'ACTIVE',
      hacienda: config.hacienda === 'CONNECTED',
      issuancePoint: config.point,
      fe: config.scopes.includes('fiscal-v2:invoices:create'),
      te: config.scopes.includes('fiscal-v2:tickets:create'),
    };
    return {
      companyId: p.companyId,
      environment: p.environment,
      technicalConnection: Object.values(checks).every(Boolean) ? 'READY' : 'INCOMPLETE',
      productionAuthorization: 'NOT_VERIFIED',
      checks,
      issuedDocument: false,
      externalCall: false,
    };
  }

  private async configurationForTest(p: ConsumerV2Principal) {
    const [cert, connection, point, key, company] = await Promise.all([
      this.prisma.fiscalSigningCertificate.findFirst({
        where: {
          tenantId: p.tenantId,
          companyId: p.companyId,
          environment: p.environment,
          status: 'ACTIVE',
          validFrom: { lte: new Date() },
          validTo: { gt: new Date() },
        },
        select: {
          id: true,
          extractedIdentityNumber: true,
          extractedIdentityType: true,
          certificateSecretReference: true,
          passwordSecretReference: true,
        },
      }),
      this.prisma.haciendaConnection.findFirst({
        where: { tenantId: p.tenantId, companyId: p.companyId, environment: p.environment },
        select: { status: true },
      }),
      this.onboarding.getDefaultIssuancePoint(p.tenantId, p.companyId, p.environment),
      this.prisma.apiKey.findFirst({
        where: { id: p.apiKeyId, tenantId: p.tenantId },
        select: { scopes: true },
      }),
      this.prisma.company.findFirst({
        where: { id: p.companyId, tenantId: p.tenantId },
        select: { identificationNumber: true, identificationType: true },
      }),
    ]);
    const expectedType = company
      ? { FISICA: '01', JURIDICA: '02', DIMEX: '03', NITE: '04' }[company.identificationType]
      : undefined;
    return {
      certificate:
        cert &&
        company &&
        cert.extractedIdentityNumber === company.identificationNumber &&
        cert.extractedIdentityType === expectedType &&
        cert.certificateSecretReference &&
        cert.passwordSecretReference
          ? 'ACTIVE'
          : 'MISSING',
      hacienda: connection?.status ?? 'MISSING',
      point: Boolean(point),
      scopes: key?.scopes ?? [],
    };
  }

  async audit(p: ConsumerV2Principal) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:audit:read');
    return this.prisma.auditLog.findMany({
      where: {
        tenantId: p.tenantId,
        companyId: p.companyId,
        action: { startsWith: 'onboarding-v2.' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, createdAt: true, actor: true },
    });
  }

  async reassign(p: ConsumerV2Principal, targetCompanyId: string, newExternalCompanyKey: string) {
    await this.assertCurrent(p, 'fiscal-v2:onboarding:association:write');
    return this.consumers.reassignIssuer({
      tenantId: p.tenantId,
      consumerId: p.consumerId,
      associationId: p.associationId,
      targetCompanyId,
      newExternalCompanyKey,
      actorId: p.apiKeyId,
      correlationId: randomUUID(),
    });
  }
}
