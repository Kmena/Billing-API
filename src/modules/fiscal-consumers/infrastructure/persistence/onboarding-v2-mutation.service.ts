import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { CrCertificateIdentityExtractorService } from '../../../fiscal-documents/application/fiscal-xml/cr-certificate-identity-extractor.service';
import { HaciendaTokenCache } from '../../../hacienda-connection/infrastructure/auth/hacienda-token-cache.service';
import { PrismaConsumerV2Repository } from './prisma-consumer-v2.repository';
import { ConsumerV2Principal } from '../http/consumer-v2.guard';
import { ConfigureBranchV2Dto, ConfigureCredentialsV2Dto } from '../http/onboarding-v2.dto';
import { ConsumerV2Scope } from '../../domain/consumer-v2.policy';

type Tx = Prisma.TransactionClient;
type SecretOperation = 'CERTIFICATE_UPLOAD' | 'CREDENTIALS_CONFIGURE' | 'CREDENTIALS_ROTATE';
type Mutation = Prisma.FiscalOnboardingMutationV2GetPayload<object>;
const RECOVERY_AGE_MS = 10 * 60 * 1000;

/** Same fiscal tables and SecretProvider as v1; v2 adds atomic authorization/audit. */
@Injectable()
export class OnboardingV2MutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PrismaConsumerV2Repository,
    private readonly extractor: CrCertificateIdentityExtractorService,
    private readonly tokenCache: HaciendaTokenCache,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  private async authorize(tx: Tx, p: ConsumerV2Principal, scope: ConsumerV2Scope) {
    await this.repository.assertPrincipalForScope(tx, p, scope);
  }

  private async audit(tx: Tx, p: ConsumerV2Principal, action: string, operationId: string) {
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
        metadata: { associationId: p.associationId, environment: p.environment },
      },
    });
  }

  private digest(parts: readonly (string | Buffer)[]): string {
    const key = process.env.FISCAL_ONBOARDING_V2_HMAC_KEY;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException({ code: 'ONBOARDING_IDEMPOTENCY_KEY_UNAVAILABLE' });
    const mac = createHmac('sha256', key);
    for (const part of parts) {
      const value = Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8');
      mac.update(Buffer.from(String(value.length) + ':'));
      mac.update(value);
    }
    return mac.digest('hex');
  }

  private validateIdempotencyKey(key: string) {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key))
      throw new BadRequestException({ code: 'ONBOARDING_IDEMPOTENCY_KEY_INVALID' });
  }

  private references(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((part): part is string => typeof part === 'string')
      : [];
  }

  private safeResponse(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async stage(
    p: ConsumerV2Principal,
    operation: SecretOperation,
    idempotencyKey: string,
    digest: string,
    newRefs: string[],
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.authorize(
            tx,
            p,
            operation === 'CERTIFICATE_UPLOAD'
              ? 'fiscal-v2:onboarding:certificate:write'
              : 'fiscal-v2:onboarding:credentials:write',
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${p.associationId}:${operation}:${idempotencyKey}`}, 0))`;
          const existing = await tx.fiscalOnboardingMutationV2.findUnique({
            where: {
              associationId_operation_idempotencyKey: {
                associationId: p.associationId,
                operation,
                idempotencyKey,
              },
            },
          });
          if (existing) {
            if (existing.requestDigest !== digest)
              throw new ConflictException({ code: 'ONBOARDING_IDEMPOTENCY_CONFLICT' });
            return { mutation: existing, created: false };
          }
          const mutation = await tx.fiscalOnboardingMutationV2.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              associationId: p.associationId,
              environment: p.environment,
              operation,
              idempotencyKey,
              requestDigest: digest,
              state: 'STAGED',
              newSecretReferences: newRefs,
              retiredSecretReferences: [],
            },
          });
          await this.audit(tx, p, 'onboarding-v2.mutation.staged', mutation.id);
          return { mutation, created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException({ code: 'ONBOARDING_CONCURRENT_CONFLICT' });
      }
      throw error;
    }
  }

  private replay(mutation: Mutation): Record<string, unknown> {
    if (mutation.state === 'COMMITTED' || mutation.state === 'COMMITTED_CLEANUP_PENDING')
      return this.safeResponse(mutation.response);
    throw new ConflictException({
      code: 'ONBOARDING_OPERATION_RECOVERY_REQUIRED',
      operationId: mutation.id,
    });
  }

  private async deleteIfUnreferenced(ref: string) {
    const [connection, certificate] = await Promise.all([
      this.prisma.haciendaConnection.count({ where: { secretReference: ref } }),
      this.prisma.fiscalSigningCertificate.count({
        where: {
          status: 'ACTIVE',
          OR: [{ certificateSecretReference: ref }, { passwordSecretReference: ref }],
        },
      }),
    ]);
    if (connection || certificate) return;
    try {
      await this.secrets.deleteSecret(ref);
    } catch (error) {
      if ((error as { name?: string }).name !== 'ParameterNotFound')
        throw new ServiceUnavailableException({ code: 'ONBOARDING_SECRET_CLEANUP_FAILED' });
    }
  }

  private async cleanup(mutation: Mutation, afterCommit: boolean): Promise<void> {
    const refs = this.references(
      afterCommit ? mutation.retiredSecretReferences : mutation.newSecretReferences,
    );
    try {
      for (const ref of refs) await this.deleteIfUnreferenced(ref);
      await this.prisma.$transaction(async (tx) => {
        const nextState = afterCommit ? 'COMMITTED' : 'COMPENSATED';
        await tx.fiscalOnboardingMutationV2.update({
          where: { id: mutation.id },
          data: { state: nextState },
        });
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: mutation.tenantId,
            companyId: mutation.companyId,
            actor: 'system:spec09-recovery',
            action: afterCommit
              ? 'onboarding-v2.mutation.retired'
              : 'onboarding-v2.mutation.compensated',
            eventClass: 'SECURITY',
            resource: `FiscalOnboardingMutationV2:${mutation.id}`,
            metadata: { associationId: mutation.associationId, environment: mutation.environment },
          },
        });
      });
    } catch {
      if (!afterCommit) {
        await this.prisma.fiscalOnboardingMutationV2
          .updateMany({
            where: { id: mutation.id, state: 'STAGED' },
            data: { state: 'RECOVERY_REQUIRED' },
          })
          .catch(() => undefined);
      }
      // A committed row stays active and its retired reference remains in the
      // durable ledger. Recovery can retry without guessing secret names.
    }
  }

  async recover(p: ConsumerV2Principal, operationId: string) {
    const mutation = await this.prisma.$transaction(async (tx) => {
      await this.authorize(tx, p, 'fiscal-v2:onboarding:recovery:write');
      await tx.$queryRaw`SELECT id FROM fiscal_onboarding_mutations_v2 WHERE id = ${operationId}::uuid FOR UPDATE`;
      const found = await tx.fiscalOnboardingMutationV2.findFirst({
        where: {
          id: operationId,
          tenantId: p.tenantId,
          companyId: p.companyId,
          associationId: p.associationId,
          environment: p.environment,
        },
      });
      if (found?.state === 'STAGED') {
        if (Date.now() - found.updatedAt.getTime() < RECOVERY_AGE_MS)
          throw new ConflictException({ code: 'ONBOARDING_OPERATION_IN_PROGRESS' });
        return tx.fiscalOnboardingMutationV2.update({
          where: { id: found.id },
          data: { state: 'RECOVERY_REQUIRED' },
        });
      }
      return found;
    });
    if (!mutation) throw new NotFoundException({ code: 'ONBOARDING_OPERATION_NOT_FOUND' });
    if (mutation.state === 'COMMITTED' || mutation.state === 'COMPENSATED')
      return { operationId, state: mutation.state };
    await this.cleanup(mutation, mutation.state === 'COMMITTED_CLEANUP_PENDING');
    const current = await this.prisma.fiscalOnboardingMutationV2.findUniqueOrThrow({
      where: { id: operationId },
      select: { state: true },
    });
    return { operationId, state: current.state };
  }

  async credentials(
    p: ConsumerV2Principal,
    dto: ConfigureCredentialsV2Dto,
    rotate: boolean,
    idempotencyKey: string,
  ) {
    if (!this.secrets.isDurable)
      throw new ServiceUnavailableException({ code: 'ONBOARDING_DURABLE_SECRET_STORE_REQUIRED' });
    const operation: SecretOperation = rotate ? 'CREDENTIALS_ROTATE' : 'CREDENTIALS_CONFIGURE';
    const reference = `hacienda-conn/${p.companyId}/${p.environment}/${randomUUID()}`;
    const digest = this.digest([operation, dto.username, dto.password]);
    const { mutation, created } = await this.stage(p, operation, idempotencyKey, digest, [
      reference,
    ]);
    if (!created) return this.replay(mutation);
    try {
      await this.secrets.storeSecret(
        reference,
        JSON.stringify({ username: dto.username, password: dto.password }),
      );
      const result = await this.prisma.$transaction(
        async (tx) => {
          await this.authorize(tx, p, 'fiscal-v2:onboarding:credentials:write');
          const current = await tx.fiscalOnboardingMutationV2.findUniqueOrThrow({
            where: { id: mutation.id },
          });
          if (current.state !== 'STAGED')
            throw new ConflictException({ code: 'ONBOARDING_OPERATION_STATE_CONFLICT' });
          const existing = await tx.haciendaConnection.findFirst({
            where: { tenantId: p.tenantId, companyId: p.companyId, environment: p.environment },
          });
          if (rotate && !existing)
            throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
          if (!rotate && existing)
            throw new ConflictException({ code: 'HACIENDA_CONNECTION_ALREADY_CONFIGURED' });
          if (existing?.status === 'DISABLED')
            throw new ConflictException({ code: 'HACIENDA_CONNECTION_DISABLED' });
          const data = {
            status: 'PENDING_VALIDATION' as const,
            secretReference: reference,
            lastValidatedAt: null,
            lastSuccessfulAuthAt: null,
            lastValidationErrorCode: null,
          };
          const saved = existing
            ? await tx.haciendaConnection.update({ where: { id: existing.id }, data })
            : await tx.haciendaConnection.create({
                data: {
                  id: randomUUID(),
                  tenantId: p.tenantId,
                  companyId: p.companyId,
                  environment: p.environment,
                  ...data,
                },
              });
          const response = {
            companyId: p.companyId,
            environment: p.environment,
            status: saved.status,
            lastValidatedAt: saved.lastValidatedAt,
          };
          const activated = await tx.fiscalOnboardingMutationV2.updateMany({
            where: { id: mutation.id, state: 'STAGED' },
            data: {
              state: existing ? 'COMMITTED_CLEANUP_PENDING' : 'COMMITTED',
              retiredSecretReferences: existing ? [existing.secretReference] : [],
              response,
            },
          });
          if (activated.count !== 1)
            throw new ConflictException({ code: 'ONBOARDING_OPERATION_STATE_CONFLICT' });
          await this.audit(
            tx,
            p,
            rotate ? 'onboarding-v2.credentials.rotated' : 'onboarding-v2.credentials.configured',
            mutation.id,
          );
          return { response, retired: existing?.secretReference ?? null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      this.tokenCache.invalidate(p.companyId, p.environment);
      if (result.retired) {
        const latest = await this.prisma.fiscalOnboardingMutationV2.findUniqueOrThrow({
          where: { id: mutation.id },
        });
        await this.cleanup(latest, true);
      }
      return result.response;
    } catch (error) {
      const latest = await this.prisma.fiscalOnboardingMutationV2.findUniqueOrThrow({
        where: { id: mutation.id },
      });
      if (latest.state === 'STAGED' || latest.state === 'RECOVERY_REQUIRED')
        await this.cleanup(latest, false);
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      throw new ServiceUnavailableException({ code: 'ONBOARDING_CREDENTIAL_MUTATION_FAILED' });
    }
  }

  async certificate(p: ConsumerV2Principal, bytes: Buffer, pin: string, idempotencyKey: string) {
    if (!this.secrets.isDurable)
      throw new ServiceUnavailableException({ code: 'ONBOARDING_DURABLE_SECRET_STORE_REQUIRED' });
    if (!bytes.length || bytes.length > 1_048_576 || !pin?.trim())
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_INPUT_INVALID' });
    if (bytes[0] !== 0x30)
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_FORMAT_INVALID' });
    const extracted = this.extractor.extractAndValidate(bytes, pin);
    const operation: SecretOperation = 'CERTIFICATE_UPLOAD';
    const base = `fiscal-certs/${p.companyId}/${p.environment.toLowerCase()}/${randomUUID()}`;
    const certRef = `${base}/cert`;
    const pinRef = `${base}/pin`;
    const digest = this.digest([operation, bytes, pin]);
    const { mutation, created } = await this.stage(p, operation, idempotencyKey, digest, [
      certRef,
      pinRef,
    ]);
    if (!created) return this.replay(mutation);
    try {
      await this.secrets.storeSecret(
        certRef,
        JSON.stringify({ pkcs12Base64: bytes.toString('base64') }),
      );
      await this.secrets.storeSecret(pinRef, pin);
      const result = await this.prisma.$transaction(
        async (tx) => {
          await this.authorize(tx, p, 'fiscal-v2:onboarding:certificate:write');
          const current = await tx.fiscalOnboardingMutationV2.findUniqueOrThrow({
            where: { id: mutation.id },
          });
          if (current.state !== 'STAGED')
            throw new ConflictException({ code: 'ONBOARDING_OPERATION_STATE_CONFLICT' });
          const company = await tx.company.findFirst({
            where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
            select: { identificationNumber: true, identificationType: true },
          });
          if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
          const expectedType = { FISICA: '01', JURIDICA: '02', DIMEX: '03', NITE: '04' }[
            company.identificationType
          ];
          if (
            extracted.extractedIdentityNumber !== company.identificationNumber ||
            extracted.extractedIdentityType !== expectedType
          )
            throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH' });
          const now = new Date();
          if (extracted.validFrom > now || extracted.validTo <= now)
            throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_DATE_INVALID' });
          const old = await tx.fiscalSigningCertificate.findFirst({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
              status: 'ACTIVE',
            },
          });
          if (old)
            await tx.fiscalSigningCertificate.update({
              where: { id: old.id },
              data: { status: 'REPLACED' },
            });
          const cert = await tx.fiscalSigningCertificate.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
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
              activeFrom: now,
            },
          });
          if (old)
            await tx.fiscalSigningCertificate.update({
              where: { id: old.id },
              data: { replacedById: cert.id },
            });
          const response = {
            id: cert.id,
            companyId: cert.companyId,
            environment: cert.environment,
            status: cert.status,
            fingerprintSha256: cert.fingerprintSha256,
            serialNumber: cert.serialNumber,
            subjectName: cert.subjectName,
            issuerName: cert.issuerName,
            validFrom: cert.validFrom,
            validTo: cert.validTo,
            extractedIdentityNumber: cert.extractedIdentityNumber,
            extractedIdentityType: cert.extractedIdentityType,
            activeFrom: cert.activeFrom,
            createdAt: cert.createdAt,
            updatedAt: cert.updatedAt,
          };
          const activated = await tx.fiscalOnboardingMutationV2.updateMany({
            where: { id: mutation.id, state: 'STAGED' },
            data: {
              // Replaced certificates remain encrypted for historical verification,
              // matching the v1 lifecycle. Only failed new references are compensated.
              state: 'COMMITTED',
              response,
            },
          });
          if (activated.count !== 1)
            throw new ConflictException({ code: 'ONBOARDING_OPERATION_STATE_CONFLICT' });
          await this.audit(tx, p, 'onboarding-v2.certificate.activated', mutation.id);
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return result;
    } catch (error) {
      const latest = await this.prisma.fiscalOnboardingMutationV2.findUniqueOrThrow({
        where: { id: mutation.id },
      });
      if (latest.state === 'STAGED' || latest.state === 'RECOVERY_REQUIRED')
        await this.cleanup(latest, false);
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      throw new ServiceUnavailableException({ code: 'ONBOARDING_CERTIFICATE_MUTATION_FAILED' });
    }
  }

  async issuancePoint(p: ConsumerV2Principal, dto: ConfigureBranchV2Dto) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.authorize(tx, p, 'fiscal-v2:onboarding:issuance-point:write');
          const company = await tx.company.findFirst({
            where: { id: p.companyId, tenantId: p.tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
          const branch = await tx.fiscalBranch.upsert({
            where: {
              companyId_environment_code: {
                companyId: p.companyId,
                environment: p.environment,
                code: dto.branchCode,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
              code: dto.branchCode,
              name: dto.branchName.trim(),
              active: true,
            },
            update: { name: dto.branchName.trim() },
          });
          if (!branch.active) throw new ConflictException({ code: 'FISCAL_BRANCH_INACTIVE' });
          const terminal = await tx.fiscalTerminal.upsert({
            where: { branchId_code: { branchId: branch.id, code: dto.terminalCode } },
            create: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              branchId: branch.id,
              environment: p.environment,
              code: dto.terminalCode,
              name: dto.terminalName.trim(),
              active: true,
            },
            update: { name: dto.terminalName.trim() },
          });
          if (!terminal.active) throw new ConflictException({ code: 'FISCAL_TERMINAL_INACTIVE' });
          await tx.fiscalIssuancePoint.updateMany({
            where: {
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
              isDefault: true,
            },
            data: { isDefault: false },
          });
          const point = await tx.fiscalIssuancePoint.upsert({
            where: {
              companyId_environment_branchCode_terminalCode: {
                companyId: p.companyId,
                environment: p.environment,
                branchCode: branch.code,
                terminalCode: terminal.code,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
              branchCode: branch.code,
              terminalCode: terminal.code,
              branchId: branch.id,
              terminalId: terminal.id,
              name: terminal.name,
              active: true,
              isDefault: true,
            },
            update: {
              branchId: branch.id,
              terminalId: terminal.id,
              name: terminal.name,
              active: true,
              isDefault: true,
            },
          });
          await this.audit(tx, p, 'onboarding-v2.issuance-point.configured', point.id);
          return { branch, terminal, issuancePoint: point };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034')
        throw new ConflictException({ code: 'ONBOARDING_CONCURRENT_CONFLICT' });
      throw error;
    }
  }
}
