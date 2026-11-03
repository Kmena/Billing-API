import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { assertSafeSpec09SandboxStorage } from '../../../../infrastructure/storage/test-storage-safety';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { CrCertificateIdentityExtractorService } from '../../../fiscal-documents/application/fiscal-xml/cr-certificate-identity-extractor.service';
import {
  AFFILIATIONS_ENROLLMENT_V2_PROFILE,
  AFFILIATIONS_ENROLLMENT_V2_SCOPES,
} from '../../domain/consumer-v2.policy';
import { EnrollmentV2Principal } from '../http/enrollment-v2.guard';

type Tx = Prisma.TransactionClient;
const OPERATION = 'INITIAL_ENROLLMENT';
const RECOVERY_AGE_MS = 10 * 60 * 1000;

/** The association stays suspended until secrets, identity and audit commit together. */
@Injectable()
export class EnrollmentV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: CrCertificateIdentityExtractorService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  private digest(parts: readonly (Buffer | string)[]): string {
    const secret = process.env.FISCAL_ONBOARDING_V2_HMAC_KEY;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException({ code: 'ONBOARDING_IDEMPOTENCY_KEY_UNAVAILABLE' });
    const hmac = createHmac('sha256', secret);
    for (const part of parts) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      hmac.update(`${bytes.length}:`).update(bytes);
    }
    return hmac.digest('hex');
  }

  private async assertGrant(tx: Tx, p: EnrollmentV2Principal) {
    await tx.$queryRaw`SELECT id FROM api_keys WHERE id = ${p.apiKeyId}::uuid FOR UPDATE`;
    const key = await tx.apiKey.findFirst({
      where: { id: p.apiKeyId, tenantId: p.tenantId },
      include: { tenant: true, companies: true },
    });
    if (
      !key ||
      key.status !== 'ACTIVE' ||
      !key.expiresAt ||
      key.expiresAt <= new Date() ||
      key.tenant.status !== 'ACTIVE' ||
      key.integrationProfile !== AFFILIATIONS_ENROLLMENT_V2_PROFILE ||
      key.environment !== 'TEST' ||
      key.name !== `affiliations-enrollment:${p.externalCompanyKey}` ||
      key.companies.length !== 1 ||
      key.companies[0].companyId !== p.companyId ||
      key.scopes.length !== AFFILIATIONS_ENROLLMENT_V2_SCOPES.length ||
      !AFFILIATIONS_ENROLLMENT_V2_SCOPES.every((scope) => key.scopes.includes(scope))
    ) {
      throw new ForbiddenException({ code: 'ENROLLMENT_GRANT_REVOKED' });
    }
    const company = await tx.company.findFirst({
      where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
      select: {
        identificationNumber: true,
        identificationType: true,
        legalName: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!company) throw new ForbiddenException({ code: 'ENROLLMENT_COMPANY_INACTIVE' });
    return company;
  }

  private async audit(tx: Tx, p: EnrollmentV2Principal, action: string, operationId: string) {
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: p.tenantId,
        companyId: p.companyId,
        apiKeyId: p.apiKeyId,
        actor: `apikey:${p.apiKeyId}`,
        action,
        eventClass: 'SECURITY',
        resource: `FiscalOnboardingMutationV2:${operationId}`,
        metadata: { environment: p.environment, externalCompanyKey: p.externalCompanyKey },
      },
    });
  }

  private refs(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  private async compensate(operationId: string): Promise<void> {
    // Claim before external cleanup. Activation must fail if recovery wins.
    await this.prisma.fiscalOnboardingMutationV2.updateMany({
      where: { id: operationId, state: 'STAGED' },
      data: { state: 'RECOVERY_REQUIRED' },
    });
    const row = await this.prisma.fiscalOnboardingMutationV2.findUnique({
      where: { id: operationId },
    });
    if (!row || row.state === 'COMMITTED' || row.state === 'COMPENSATED') return;
    try {
      for (const ref of this.refs(row.newSecretReferences)) {
        const [cert, connection] = await Promise.all([
          this.prisma.fiscalSigningCertificate.count({
            where: {
              status: 'ACTIVE',
              OR: [{ certificateSecretReference: ref }, { passwordSecretReference: ref }],
            },
          }),
          this.prisma.haciendaConnection.count({ where: { secretReference: ref } }),
        ]);
        if (cert || connection) throw new Error('ACTIVE_REFERENCE');
        try {
          await this.secrets.deleteSecret(ref);
        } catch (error) {
          if ((error as { name?: string }).name !== 'ParameterNotFound') throw error;
        }
      }
      await this.prisma.$transaction(async (tx) => {
        const marked = await tx.fiscalOnboardingMutationV2.updateMany({
          where: { id: operationId, state: 'RECOVERY_REQUIRED' },
          data: { state: 'COMPENSATED' },
        });
        if (marked.count !== 1) return;
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: row.tenantId,
            companyId: row.companyId,
            actor: 'system:spec09-recovery',
            action: 'onboarding-v2.enrollment.compensated',
            eventClass: 'SECURITY',
            resource: `FiscalOnboardingMutationV2:${operationId}`,
            metadata: { environment: row.environment },
          },
        });
      });
    } catch {
      await this.prisma.fiscalOnboardingMutationV2
        .updateMany({
          where: { id: operationId, state: 'STAGED' },
          data: { state: 'RECOVERY_REQUIRED' },
        })
        .catch(() => undefined);
    }
  }

  async recover(p: EnrollmentV2Principal, operationId: string) {
    await this.prisma.$transaction((tx) => this.assertGrant(tx, p));
    const row = await this.prisma.fiscalOnboardingMutationV2.findFirst({
      where: {
        id: operationId,
        tenantId: p.tenantId,
        companyId: p.companyId,
        environment: p.environment,
        operation: OPERATION,
        association: { keyBindings: { some: { apiKeyId: p.apiKeyId } } },
      },
    });
    if (!row) throw new ForbiddenException({ code: 'ENROLLMENT_REQUEST_NOT_FOUND' });
    if (row.state === 'STAGED' && Date.now() - row.updatedAt.getTime() < RECOVERY_AGE_MS)
      throw new ConflictException({ code: 'ENROLLMENT_REQUEST_IN_PROGRESS' });
    if (row.state === 'STAGED' || row.state === 'RECOVERY_REQUIRED') await this.compensate(row.id);
    const current = await this.prisma.fiscalOnboardingMutationV2.findUniqueOrThrow({
      where: { id: row.id },
      select: { state: true },
    });
    return { requestId: row.id, state: current.state };
  }

  async request(
    p: EnrollmentV2Principal,
    input: {
      externalCompanyKey: string;
      issuerIdentificationNumber?: string;
      pin: string;
      username: string;
      password: string;
    },
    bytes: Buffer,
    idempotencyKey: string,
  ) {
    if (!this.secrets.isDurable)
      throw new ServiceUnavailableException({ code: 'ONBOARDING_DURABLE_SECRET_STORE_REQUIRED' });
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey))
      throw new BadRequestException({ code: 'ONBOARDING_IDEMPOTENCY_KEY_INVALID' });
    if (
      input.externalCompanyKey !== p.externalCompanyKey ||
      (input.issuerIdentificationNumber !== undefined &&
        !/^\d{9,12}$/.test(input.issuerIdentificationNumber)) ||
      !input.pin?.trim() ||
      input.pin.length > 256 ||
      !input.username?.trim() ||
      input.username.length > 255 ||
      !input.password?.trim() ||
      input.password.length > 1024 ||
      !bytes.length ||
      bytes.length > 1_048_576 ||
      bytes[0] !== 0x30
    )
      throw new BadRequestException({ code: 'ENROLLMENT_INPUT_INVALID' });
    const extracted = this.extractor.extractAndValidate(bytes, input.pin);
    const now = new Date();
    if (extracted.validFrom > now || extracted.validTo <= now)
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_DATE_INVALID' });
    if (
      input.issuerIdentificationNumber !== undefined &&
      input.issuerIdentificationNumber !== extracted.extractedIdentityNumber
    )
      throw new BadRequestException({ code: 'ENROLLMENT_CERTIFICATE_IDENTITY_INPUT_MISMATCH' });
    const digest = this.digest([
      OPERATION,
      p.externalCompanyKey,
      input.issuerIdentificationNumber ?? '',
      bytes,
      input.pin,
      input.username,
      input.password,
    ]);
    const base = `fiscal-certs/${p.companyId}/sandbox/${randomUUID()}`;
    const certRef = `${base}/cert`;
    const pinRef = `${base}/pin`;
    const credentialRef = `hacienda-conn/${p.companyId}/SANDBOX/${randomUUID()}`;
    const refs = [certRef, pinRef, credentialRef];
    const staged = await this.prisma.$transaction(
      async (tx) => {
        const company = await this.assertGrant(tx, p);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enrollment:${p.tenantId}:${p.companyId}`}, 0))`;
        const expectedType = { FISICA: '01', JURIDICA: '02', DIMEX: '03', NITE: '04' }[
          company.identificationType
        ];
        const needsIdentityAdoption =
          extracted.extractedIdentityNumber !== company.identificationNumber;
        if (needsIdentityAdoption) {
          // Only the explicitly guarded, empty synthetic Docker sandbox may adopt
          // the identity from a test certificate during its first enrollment.
          try {
            assertSafeSpec09SandboxStorage(process.env.LOCAL_STORAGE_PATH ?? '');
          } catch {
            throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH' });
          }
          if (
            !input.issuerIdentificationNumber ||
            company.tenant.slug !== 'spec09-sandbox-synthetic' ||
            company.legalName !== 'SPEC-09 EMISOR DEMO' ||
            !['01', '02', '03'].includes(extracted.extractedIdentityType ?? '') ||
            (await tx.fiscalDocument.count({ where: { companyId: p.companyId } })) ||
            (await tx.fiscalSigningCertificate.count({ where: { companyId: p.companyId } })) ||
            (await tx.haciendaConnection.count({ where: { companyId: p.companyId } })) ||
            (await tx.fiscalIntegrationAssociation.count({ where: { companyId: p.companyId } }))
          )
            throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH' });
        } else if (extracted.extractedIdentityType !== expectedType)
          throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH' });
        const consumer = await tx.fiscalConsumer.upsert({
          where: {
            tenantId_provider_externalConsumerKey: {
              tenantId: p.tenantId,
              provider: 'AFFILIATIONS',
              externalConsumerKey: 'afiliaciones-spec09',
            },
          },
          create: {
            id: randomUUID(),
            tenantId: p.tenantId,
            provider: 'AFFILIATIONS',
            externalConsumerKey: 'afiliaciones-spec09',
          },
          update: {},
        });
        if (consumer.status !== 'ACTIVE')
          throw new ForbiddenException({ code: 'ENROLLMENT_CONSUMER_INACTIVE' });
        const mapping = await tx.fiscalConsumerCompany.upsert({
          where: {
            tenantId_consumerId_externalCompanyKey: {
              tenantId: p.tenantId,
              consumerId: consumer.id,
              externalCompanyKey: p.externalCompanyKey,
            },
          },
          create: {
            id: randomUUID(),
            tenantId: p.tenantId,
            consumerId: consumer.id,
            companyId: p.companyId,
            externalCompanyKey: p.externalCompanyKey,
          },
          update: {},
        });
        if (mapping.companyId !== p.companyId || mapping.status !== 'ACTIVE')
          throw new ConflictException({ code: 'ENROLLMENT_COMPANY_REMAP_FORBIDDEN' });
        const association = await tx.fiscalConsumerAssociation.upsert({
          where: {
            consumerCompanyId_environment: {
              consumerCompanyId: mapping.id,
              environment: 'SANDBOX',
            },
          },
          create: {
            id: randomUUID(),
            tenantId: p.tenantId,
            consumerCompanyId: mapping.id,
            environment: 'SANDBOX',
            status: 'SUSPENDED',
          },
          update: {},
        });
        const binding = await tx.fiscalConsumerKeyBinding.upsert({
          where: { apiKeyId: p.apiKeyId },
          create: {
            apiKeyId: p.apiKeyId,
            tenantId: p.tenantId,
            associationId: association.id,
          },
          update: {},
        });
        if (binding.associationId !== association.id)
          throw new ConflictException({ code: 'ENROLLMENT_KEY_ALREADY_BOUND' });
        const existing = await tx.fiscalOnboardingMutationV2.findUnique({
          where: {
            associationId_operation_idempotencyKey: {
              associationId: association.id,
              operation: OPERATION,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestDigest !== digest)
            throw new ConflictException({ code: 'ONBOARDING_IDEMPOTENCY_CONFLICT' });
          if (existing.state === 'COMPENSATED') {
            const reset = await tx.fiscalOnboardingMutationV2.update({
              where: { id: existing.id },
              data: { state: 'STAGED', newSecretReferences: refs, response: Prisma.JsonNull },
            });
            await this.audit(tx, p, 'onboarding-v2.enrollment.restaged', reset.id);
            return {
              row: reset,
              created: true,
              associationId: association.id,
              originalIdentificationNumber: company.identificationNumber,
              needsIdentityAdoption,
            };
          }
          return {
            row: existing,
            created: false,
            associationId: association.id,
            originalIdentificationNumber: company.identificationNumber,
            needsIdentityAdoption,
          };
        }
        if (
          association.status !== 'SUSPENDED' ||
          (await tx.fiscalOnboardingMutationV2.count({
            where: {
              associationId: association.id,
              operation: OPERATION,
              state: { not: 'COMPENSATED' },
            },
          }))
        )
          throw new ConflictException({ code: 'ENROLLMENT_ALREADY_REQUESTED' });
        if (
          (await tx.fiscalSigningCertificate.count({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: 'SANDBOX',
              status: 'ACTIVE',
            },
          })) ||
          (await tx.haciendaConnection.count({
            where: { tenantId: p.tenantId, companyId: p.companyId, environment: 'SANDBOX' },
          }))
        )
          throw new ConflictException({ code: 'ENROLLMENT_ISSUER_ALREADY_CONFIGURED' });
        const row = await tx.fiscalOnboardingMutationV2.create({
          data: {
            id: randomUUID(),
            tenantId: p.tenantId,
            companyId: p.companyId,
            associationId: association.id,
            environment: 'SANDBOX',
            operation: OPERATION,
            idempotencyKey,
            requestDigest: digest,
            state: 'STAGED',
            newSecretReferences: refs,
            retiredSecretReferences: [],
          },
        });
        await this.audit(tx, p, 'onboarding-v2.enrollment.staged', row.id);
        return {
          row,
          created: true,
          associationId: association.id,
          originalIdentificationNumber: company.identificationNumber,
          needsIdentityAdoption,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!staged.created) {
      if (staged.row.state === 'COMMITTED') return staged.row.response;
      throw new ConflictException({
        code: 'ENROLLMENT_REQUEST_RECOVERY_REQUIRED',
        requestId: staged.row.id,
      });
    }
    try {
      await this.secrets.storeSecret(
        certRef,
        JSON.stringify({ pkcs12Base64: bytes.toString('base64') }),
      );
      await this.secrets.storeSecret(pinRef, input.pin);
      await this.secrets.storeSecret(
        credentialRef,
        JSON.stringify({ username: input.username, password: input.password }),
      );
      const response = await this.prisma.$transaction(
        async (tx) => {
          await this.assertGrant(tx, p);
          await tx.$queryRaw`SELECT id FROM fiscal_consumer_associations
          WHERE id = ${staged.associationId}::uuid FOR UPDATE`;
          const row = await tx.fiscalOnboardingMutationV2.findUniqueOrThrow({
            where: { id: staged.row.id },
          });
          if (row.state !== 'STAGED')
            throw new ConflictException({ code: 'ENROLLMENT_REQUEST_STATE_CONFLICT' });
          if (staged.needsIdentityAdoption) {
            if (await tx.fiscalDocument.count({ where: { companyId: p.companyId } }))
              throw new ConflictException({ code: 'ENROLLMENT_ISSUER_HISTORY_CHANGED' });
            const changed = await tx.company.updateMany({
              where: {
                id: p.companyId,
                tenantId: p.tenantId,
                identificationNumber: staged.originalIdentificationNumber,
              },
              data: {
                identificationNumber: extracted.extractedIdentityNumber,
                identificationType: extracted.canonicalIdentity.identityType!,
              },
            });
            if (changed.count !== 1)
              throw new ConflictException({ code: 'ENROLLMENT_ISSUER_IDENTITY_CHANGED' });
            await tx.auditLog.create({
              data: {
                id: randomUUID(),
                tenantId: p.tenantId,
                companyId: p.companyId,
                apiKeyId: p.apiKeyId,
                actor: `apikey:${p.apiKeyId}`,
                action: 'onboarding-v2.synthetic-issuer.identity-adopted',
                eventClass: 'SECURITY',
                resource: `Company:${p.companyId}`,
                metadata: {
                  environment: 'SANDBOX',
                  previousIdentificationNumber: staged.originalIdentificationNumber,
                  identificationNumber: extracted.extractedIdentityNumber,
                },
              },
            });
          }
          const cert = await tx.fiscalSigningCertificate.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: 'SANDBOX',
              status: 'ACTIVE',
              certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
              certificateSecretReference: certRef,
              passwordSecretReference: pinRef,
              fingerprintSha256: extracted.fingerprintSha256,
              serialNumber: extracted.x509SerialNumber,
              subjectName: extracted.subjectName,
              issuerName: extracted.issuerName,
              validFrom: extracted.validFrom,
              validTo: extracted.validTo,
              extractedIdentityNumber: extracted.extractedIdentityNumber,
              extractedIdentityType: extracted.extractedIdentityType,
              activeFrom: new Date(),
            },
          });
          await tx.haciendaConnection.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: 'SANDBOX',
              status: 'PENDING_VALIDATION',
              secretReference: credentialRef,
            },
          });
          await tx.fiscalConsumerAssociation.update({
            where: { id: staged.associationId },
            data: { status: 'ACTIVE' },
          });
          const safe = {
            requestId: row.id,
            associationId: staged.associationId,
            companyId: p.companyId,
            environment: 'SANDBOX',
            status: 'APPROVED',
            certificateId: cert.id,
            haciendaStatus: 'PENDING_VALIDATION',
            productionAuthorized: false,
          };
          const committed = await tx.fiscalOnboardingMutationV2.updateMany({
            where: { id: row.id, state: 'STAGED' },
            data: { state: 'COMMITTED', response: safe },
          });
          if (committed.count !== 1)
            throw new ConflictException({ code: 'ENROLLMENT_REQUEST_STATE_CONFLICT' });
          await this.audit(tx, p, 'onboarding-v2.enrollment.approved', row.id);
          return safe;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return response;
    } catch (error) {
      await this.compensate(staged.row.id);
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      )
        throw error;
      throw new ServiceUnavailableException({
        code: 'ENROLLMENT_REQUEST_FAILED',
        requestId: staged.row.id,
      });
    }
  }
}
