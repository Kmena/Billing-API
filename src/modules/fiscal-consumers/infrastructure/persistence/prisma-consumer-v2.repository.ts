import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import type {
  ConsumerV2OperationCommand,
  IssueConsumerKeyV2,
  RegisterConsumerAssociationV2,
  ReassignConsumerIssuerV2,
  RevokeConsumerKeyV2,
} from '../../application/consumer-v2-lab.service';
import {
  authorizeConsumerV2,
  BILLING_CONSUMER_V2_PROFILE,
  ConsumerV2Scope,
  evaluateConsumerKeyIssue,
  evaluateConsumerKeyRevocation,
} from '../../domain/consumer-v2.policy';
import {
  evaluateConsumerV2Lookup,
  evaluateConsumerV2Replay,
  ConsumerV2Operation,
} from '../../domain/consumer-v2-idempotency.policy';
import type { ConsumerV2Principal } from '../http/consumer-v2.guard';

type Tx = Prisma.TransactionClient;

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Every sensitive mutation writes the audit row in its own DB transaction. */
async function audit(
  tx: Tx,
  input: {
    tenantId: string;
    companyId?: string;
    apiKeyId?: string;
    actor: string;
    action: string;
    resource: string;
    correlationId: string;
    eventClass: 'SECURITY' | 'FISCAL_AUDIT';
    metadata: Prisma.JsonObject;
  },
) {
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      apiKeyId: input.apiKeyId,
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      correlationId: input.correlationId,
      eventClass: input.eventClass,
      metadata: input.metadata,
    },
  });
}

@Injectable()
export class PrismaConsumerV2Repository {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBillingAdmin(tx: Tx, tenantId: string, actorId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid AND tenant_id = ${tenantId}::uuid FOR SHARE`;
    const admin = await tx.user.findFirst({
      where: { id: actorId, tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new ForbiddenException({ code: 'TENANT_ADMIN_REQUIRED' });
  }

  /** DP-01: successor association for future operations; historical issuer IDs never change. */
  async reassignIssuer(command: ReassignConsumerIssuerV2) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM fiscal_consumer_associations
            WHERE id = ${command.associationId}::uuid AND tenant_id = ${command.tenantId}::uuid FOR UPDATE`;
          const old = await tx.fiscalConsumerAssociation.findFirst({
            where: { id: command.associationId, tenantId: command.tenantId },
            include: { consumerCompany: { include: { consumer: true } } },
          });
          if (!old || old.consumerCompany.consumerId !== command.consumerId)
            throw new NotFoundException({ code: 'CONSUMER_ASSOCIATION_NOT_FOUND' });
          await this.assertBillingAdmin(tx, command.tenantId, command.actorId);
          if (
            old.status !== 'ACTIVE' ||
            old.consumerCompany.status !== 'ACTIVE' ||
            old.consumerCompany.consumer.status !== 'ACTIVE'
          )
            throw new ConflictException({ code: 'CONSUMER_ASSOCIATION_INACTIVE' });
          if (old.consumerCompany.companyId === command.targetCompanyId)
            throw new ConflictException({ code: 'CONSUMER_ISSUER_UNCHANGED' });
          if (old.consumerCompany.externalCompanyKey === command.newExternalCompanyKey)
            throw new ConflictException({ code: 'CONSUMER_COMPANY_REMAP_FORBIDDEN' });
          const pending = await tx.fiscalIdempotencyKeyV2.count({
            where: { associationId: old.id, state: { in: ['RESERVED', 'RECOVERY_REQUIRED'] } },
          });
          const unfinishedDocuments = await tx.fiscalDocument.count({
            where: {
              originAssociationId: old.id,
              status: { notIn: ['ACCEPTED', 'REJECTED', 'SUPERSEDED'] },
            },
          });
          if (pending || unfinishedDocuments)
            throw new ConflictException({ code: 'CONSUMER_ASSOCIATION_PENDING_OPERATIONS' });

          await this.assertTargetIssuerConfigured(
            tx,
            command.tenantId,
            command.targetCompanyId,
            old.environment,
          );
          const mapping = await tx.fiscalConsumerCompany.upsert({
            where: {
              tenantId_consumerId_companyId: {
                tenantId: command.tenantId,
                consumerId: command.consumerId,
                companyId: command.targetCompanyId,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: command.tenantId,
              consumerId: command.consumerId,
              companyId: command.targetCompanyId,
              externalCompanyKey: command.newExternalCompanyKey,
            },
            update: {},
          });
          if (
            mapping.status !== 'ACTIVE' ||
            mapping.externalCompanyKey !== command.newExternalCompanyKey
          )
            throw new ConflictException({ code: 'CONSUMER_TARGET_MAPPING_CONFLICT' });
          const successor = await tx.fiscalConsumerAssociation.upsert({
            where: {
              consumerCompanyId_environment: {
                consumerCompanyId: mapping.id,
                environment: old.environment,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: command.tenantId,
              consumerCompanyId: mapping.id,
              environment: old.environment,
            },
            update: {},
          });
          if (successor.status !== 'ACTIVE')
            throw new ConflictException({ code: 'CONSUMER_TARGET_ASSOCIATION_INACTIVE' });

          const now = new Date();
          const oldBindings = await tx.fiscalConsumerKeyBinding.findMany({
            where: { associationId: old.id },
            select: { apiKeyId: true },
          });
          const revoked = await tx.apiKey.updateMany({
            where: {
              id: { in: oldBindings.map((binding) => binding.apiKeyId) },
              tenantId: command.tenantId,
              status: 'ACTIVE',
            },
            data: { status: 'REVOKED', revokedAt: now, revokedBy: command.actorId },
          });
          await tx.fiscalConsumerAssociation.update({
            where: { id: old.id },
            data: { status: 'SUSPENDED' },
          });
          await audit(tx, {
            tenantId: command.tenantId,
            companyId: command.targetCompanyId,
            actor: command.actorId,
            action: 'consumer.association.issuer.reassigned',
            resource: `FiscalConsumerAssociation:${successor.id}`,
            correlationId: command.correlationId,
            eventClass: 'SECURITY',
            metadata: {
              consumerId: command.consumerId,
              previousAssociationId: old.id,
              previousCompanyId: old.consumerCompany.companyId,
              successorAssociationId: successor.id,
              successorCompanyId: command.targetCompanyId,
              environment: old.environment,
              revokedKeyCount: revoked.count,
            },
          });
          return {
            consumerId: command.consumerId,
            previousAssociationId: old.id,
            associationId: successor.id,
            companyId: command.targetCompanyId,
            environment: old.environment,
            status: successor.status,
            revokedKeyCount: revoked.count,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 30000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (isUnique(error))
        throw new ConflictException({ code: 'CONSUMER_TARGET_MAPPING_CONFLICT' });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ConflictException({ code: 'CONSUMER_ISSUER_CHANGE_CONCURRENT' });
      throw error;
    }
  }

  private async assertTargetIssuerConfigured(
    tx: Tx,
    tenantId: string,
    companyId: string,
    environment: 'SANDBOX' | 'PRODUCTION',
  ) {
    const company = await tx.company.findFirst({
      where: { id: companyId, tenantId, status: 'ACTIVE' },
      select: {
        identificationNumber: true,
        identificationType: true,
        haciendaVerificationStatus: true,
      },
    });
    if (!company) throw new NotFoundException({ code: 'CONSUMER_TARGET_COMPANY_NOT_FOUND' });
    const blockers: string[] = [];
    if (
      !company.identificationNumber ||
      !company.identificationType ||
      company.haciendaVerificationStatus !== 'VERIFIED'
    )
      blockers.push('ISSUER_IDENTITY_UNVERIFIED');
    const profile = await tx.companyFiscalProfile.findFirst({
      where: { tenantId, companyId },
      select: { defaultEconomicActivityId: true },
    });
    const activity = profile?.defaultEconomicActivityId
      ? await tx.companyEconomicActivity.findFirst({
          where: {
            id: profile.defaultEconomicActivityId,
            tenantId,
            companyId,
            haciendaStatus: 'A',
            billingEnabled: true,
          },
          select: { id: true },
        })
      : null;
    if (!activity) blockers.push('ISSUER_ACTIVITY_NOT_CONFIGURED');
    const point = await tx.fiscalIssuancePoint.findFirst({
      where: {
        tenantId,
        companyId,
        environment,
        active: true,
        isDefault: true,
        branch: { is: { active: true, tenantId, companyId, environment } },
        terminal: { is: { active: true, tenantId, companyId, environment } },
      },
      select: { id: true },
    });
    if (!point) blockers.push('ISSUER_BRANCH_TERMINAL_NOT_CONFIGURED');
    const connection = await tx.haciendaConnection.findFirst({
      where: { tenantId, companyId, environment, status: 'CONNECTED' },
      select: { secretReference: true },
    });
    if (!connection?.secretReference) blockers.push('ISSUER_HACIENDA_CREDENTIALS_NOT_CONFIGURED');
    const cert = await tx.fiscalSigningCertificate.findFirst({
      where: { tenantId, companyId, environment, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        extractedIdentityNumber: true,
        extractedIdentityType: true,
        validFrom: true,
        validTo: true,
        certificateSecretReference: true,
        passwordSecretReference: true,
      },
    });
    const expectedType = { FISICA: '01', JURIDICA: '02', DIMEX: '03', NITE: '04' }[
      company.identificationType as 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE'
    ];
    const now = new Date();
    if (
      !cert ||
      cert.extractedIdentityNumber !== company.identificationNumber ||
      cert.extractedIdentityType !== expectedType ||
      (cert.validFrom && cert.validFrom > now) ||
      (cert.validTo && cert.validTo <= now) ||
      !cert.certificateSecretReference ||
      !cert.passwordSecretReference
    )
      blockers.push('ISSUER_CERTIFICATE_NOT_VERIFIED');
    if (blockers.length)
      throw new UnprocessableEntityException({
        code: 'CONSUMER_TARGET_ISSUER_NOT_READY',
        blockers,
      });
  }

  async registerAssociation(command: RegisterConsumerAssociationV2) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertBillingAdmin(tx, command.tenantId, command.actorId);
          const tenant = await tx.tenant.findFirst({
            where: { id: command.tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!tenant) throw new ForbiddenException({ code: 'CONSUMER_TENANT_INACTIVE' });
          const company = await tx.company.findFirst({
            where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!company) throw new NotFoundException({ code: 'CONSUMER_COMPANY_NOT_FOUND' });
          const previousAssociation = await tx.fiscalConsumerAssociation.findFirst({
            where: {
              tenantId: command.tenantId,
              environment: command.environment,
              consumerCompany: {
                externalCompanyKey: command.externalCompanyKey,
                consumer: {
                  provider: command.provider,
                  externalConsumerKey: command.externalConsumerKey,
                },
              },
            },
            select: { id: true },
          });
          const consumer = await tx.fiscalConsumer.upsert({
            where: {
              tenantId_provider_externalConsumerKey: {
                tenantId: command.tenantId,
                provider: command.provider,
                externalConsumerKey: command.externalConsumerKey,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: command.tenantId,
              provider: command.provider,
              externalConsumerKey: command.externalConsumerKey,
            },
            update: {},
          });
          if (consumer.status !== 'ACTIVE') {
            throw new ForbiddenException({ code: 'CONSUMER_INACTIVE' });
          }
          const mapping = await tx.fiscalConsumerCompany.upsert({
            where: {
              tenantId_consumerId_externalCompanyKey: {
                tenantId: command.tenantId,
                consumerId: consumer.id,
                externalCompanyKey: command.externalCompanyKey,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: command.tenantId,
              consumerId: consumer.id,
              companyId: command.companyId,
              externalCompanyKey: command.externalCompanyKey,
            },
            update: {},
          });
          if (mapping.companyId !== command.companyId) {
            throw new ConflictException({ code: 'CONSUMER_COMPANY_REMAP_FORBIDDEN' });
          }
          if (mapping.status !== 'ACTIVE') {
            throw new ForbiddenException({ code: 'CONSUMER_COMPANY_INACTIVE' });
          }
          const association = await tx.fiscalConsumerAssociation.upsert({
            where: {
              consumerCompanyId_environment: {
                consumerCompanyId: mapping.id,
                environment: command.environment,
              },
            },
            create: {
              id: randomUUID(),
              tenantId: command.tenantId,
              consumerCompanyId: mapping.id,
              environment: command.environment,
            },
            update: {},
          });
          await audit(tx, {
            tenantId: command.tenantId,
            companyId: command.companyId,
            actor: command.actorId,
            action: 'consumer.association.registered',
            resource: `FiscalConsumerAssociation:${association.id}`,
            correlationId: command.correlationId,
            eventClass: 'SECURITY',
            metadata: {
              consumerId: consumer.id,
              associationId: association.id,
              environment: command.environment,
            },
          });
          return {
            created: !previousAssociation,
            consumerId: consumer.id,
            associationId: association.id,
            companyId: mapping.companyId,
            environment: association.environment,
            status: association.status,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isUnique(error)) throw new ConflictException({ code: 'CONSUMER_ASSOCIATION_CONFLICT' });
      throw error;
    }
  }

  async getConsumer(tenantId: string, consumerId: string) {
    const consumer = await this.prisma.fiscalConsumer.findFirst({
      where: { id: consumerId, tenantId },
      include: { companies: { include: { associations: true } } },
    });
    if (!consumer) throw new NotFoundException({ code: 'CONSUMER_NOT_FOUND' });
    return {
      consumerId: consumer.id,
      provider: consumer.provider,
      externalConsumerKey: consumer.externalConsumerKey,
      associations: consumer.companies.flatMap((mapping) =>
        mapping.associations.map((association) => ({
          consumerId: consumer.id,
          associationId: association.id,
          companyId: mapping.companyId,
          environment: association.environment,
          status: association.status,
        })),
      ),
    };
  }

  async issueKey(command: IssueConsumerKeyV2) {
    const prefix = randomBytes(4).toString('hex');
    const secretPart = randomBytes(16).toString('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertBillingAdmin(tx, command.tenantId, command.actorId);
        await tx.$queryRaw`SELECT id FROM fiscal_consumer_associations
          WHERE id = ${command.associationId}::uuid AND tenant_id = ${command.tenantId}::uuid FOR UPDATE`;
        const now = new Date();
        const tenant = await tx.tenant.findFirst({
          where: { id: command.tenantId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!tenant) throw new ForbiddenException({ code: 'CONSUMER_TENANT_INACTIVE' });
        const association = await tx.fiscalConsumerAssociation.findFirst({
          where: { id: command.associationId, tenantId: command.tenantId },
          include: { consumerCompany: { include: { consumer: true, company: true } } },
        });
        if (!association) throw new NotFoundException({ code: 'CONSUMER_ASSOCIATION_NOT_FOUND' });
        if (command.consumerId && association.consumerCompany.consumerId !== command.consumerId) {
          throw new NotFoundException({ code: 'CONSUMER_ASSOCIATION_NOT_FOUND' });
        }
        if (
          association.status !== 'ACTIVE' ||
          association.consumerCompany.status !== 'ACTIVE' ||
          association.consumerCompany.consumer.status !== 'ACTIVE' ||
          association.consumerCompany.company.status !== 'ACTIVE'
        )
          throw new ForbiddenException({ code: 'CONSUMER_ASSOCIATION_INACTIVE' });
        const activeKeys = await tx.apiKey.findMany({
          where: {
            tenantId: command.tenantId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
            consumerKeyBinding: { associationId: association.id },
          },
          select: { id: true, expiresAt: true },
        });
        const issue = evaluateConsumerKeyIssue({
          activeKeys: activeKeys.map((key) => ({ id: key.id, expiresAt: key.expiresAt! })),
          now,
          rotation: command.rotationEndsAt ? { endsAt: command.rotationEndsAt } : undefined,
        });
        if (!issue.allowed) throw new ConflictException({ code: issue.code });
        if (command.rotationEndsAt) {
          // The old key cannot outlive the approved overlap, even if no later
          // revocation request arrives. Never extend an earlier expiry.
          const oldKey = activeKeys[0];
          await tx.apiKey.update({
            where: { id: oldKey.id },
            data: {
              expiresAt: new Date(
                Math.min(oldKey.expiresAt!.getTime(), command.rotationEndsAt.getTime()),
              ),
            },
          });
        }
        const environment = association.environment === 'SANDBOX' ? 'TEST' : 'LIVE';
        const fullKey = `bk_${environment === 'TEST' ? 'test' : 'live'}_${prefix}_${secretPart}`;
        const apiKeyId = randomUUID();
        await tx.apiKey.create({
          data: {
            id: apiKeyId,
            tenantId: command.tenantId,
            name: `consumer-v2:${association.id}`,
            environment,
            keyPrefix: prefix,
            keyHash: await argon2.hash(fullKey, { type: argon2.argon2id }),
            scopes: command.scopes,
            integrationProfile: BILLING_CONSUMER_V2_PROFILE,
            expiresAt: command.expiresAt,
          },
        });
        await tx.fiscalConsumerKeyBinding.create({
          data: { apiKeyId, tenantId: command.tenantId, associationId: association.id },
        });
        await audit(tx, {
          tenantId: command.tenantId,
          companyId: association.consumerCompany.companyId,
          apiKeyId,
          actor: command.actorId,
          action: command.rotationEndsAt ? 'consumer.key.rotated' : 'consumer.key.issued',
          resource: `ApiKey:${apiKeyId}`,
          correlationId: command.correlationId,
          eventClass: 'SECURITY',
          metadata: {
            associationId: association.id,
            consumerId: association.consumerCompany.consumerId,
            environment: association.environment,
            scopes: command.scopes,
          },
        });
        return {
          apiKeyId,
          associationId: association.id,
          secret: fullKey,
          integrationProfile: BILLING_CONSUMER_V2_PROFILE,
          scopes: command.scopes,
          expiresAt: command.expiresAt,
        };
      });
    } catch (error) {
      if (isUnique(error)) throw new ConflictException({ code: 'CONSUMER_KEY_CONFLICT' });
      throw error;
    }
  }

  async revokeKey(command: RevokeConsumerKeyV2) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertBillingAdmin(tx, command.tenantId, command.actorId);
      const selected = await tx.fiscalConsumerKeyBinding.findFirst({
        where: { apiKeyId: command.apiKeyId, tenantId: command.tenantId },
        include: { association: { include: { consumerCompany: true } } },
      });
      if (
        !selected ||
        (command.associationId && selected.associationId !== command.associationId) ||
        (command.consumerId &&
          selected.association.consumerCompany.consumerId !== command.consumerId)
      ) {
        throw new NotFoundException({ code: 'CONSUMER_KEY_NOT_FOUND' });
      }
      await tx.$queryRaw`SELECT id FROM fiscal_consumer_associations
        WHERE id = ${selected.associationId}::uuid AND tenant_id = ${command.tenantId}::uuid FOR UPDATE`;
      const binding = await tx.fiscalConsumerKeyBinding.findFirst({
        where: {
          apiKeyId: command.apiKeyId,
          tenantId: command.tenantId,
          associationId: selected.associationId,
        },
        include: { apiKey: true, association: { include: { consumerCompany: true } } },
      });
      if (!binding) throw new NotFoundException({ code: 'CONSUMER_KEY_NOT_FOUND' });
      const decision = evaluateConsumerKeyRevocation({
        key: binding.apiKey,
        binding,
        association: binding.association,
      });
      if (!decision.allowed) throw new NotFoundException({ code: decision.code });
      if (decision.action === 'REVOKE') {
        await tx.apiKey.update({
          where: { id: command.apiKeyId },
          data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: command.actorId },
        });
      }
      await audit(tx, {
        tenantId: command.tenantId,
        companyId: binding.association.consumerCompany.companyId,
        apiKeyId: command.apiKeyId,
        actor: command.actorId,
        action: 'consumer.key.revoked',
        resource: `ApiKey:${command.apiKeyId}`,
        correlationId: command.correlationId,
        eventClass: 'SECURITY',
        metadata: {
          associationId: selected.associationId,
          alreadyRevoked: decision.action === 'ALREADY_REVOKED',
        },
      });
      return { revoked: decision.action === 'REVOKE' };
    });
  }

  async reserveSyntheticLab(command: ConsumerV2OperationCommand) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertPrincipal(tx, command.principal, 'fiscal-v2:operations:read');
        const p = command.principal;
        const id = randomUUID();
        const inserted = await tx.$executeRaw`
        INSERT INTO fiscal_idempotency_keys_v2
          (id, tenant_id, association_id, environment, operation, key,
           request_hash_version, request_hash, state, first_api_key_id, updated_at)
        VALUES (${id}::uuid, ${p.tenantId}::uuid, ${p.associationId}::uuid,
          ${p.environment}::"HaciendaEnvironment", ${command.operation}, ${command.idempotencyKey},
          ${command.requestHashVersion}, ${command.requestHash}, 'RESERVED', ${p.apiKeyId}::uuid, now())
        ON CONFLICT (association_id, environment, operation, key) DO NOTHING`;
        const reservation = await tx.fiscalIdempotencyKeyV2.findFirstOrThrow({
          where: {
            associationId: p.associationId,
            environment: p.environment,
            operation: command.operation,
            key: command.idempotencyKey,
          },
        });
        const replay = evaluateConsumerV2Replay(
          {
            associationId: p.associationId,
            environment: p.environment,
            operation: command.operation,
            idempotencyKey: command.idempotencyKey,
            requestHashVersion: command.requestHashVersion,
            requestHash: command.requestHash,
          },
          {
            associationId: reservation.associationId,
            environment: reservation.environment,
            operation: 'CREATE_INVOICE',
            idempotencyKey: reservation.key,
            requestHashVersion: reservation.requestHashVersion,
            requestHash: reservation.requestHash,
            state: reservation.state as 'RESERVED',
            fiscalDocumentId: reservation.fiscalDocumentId,
          },
        );
        if (replay === 'CONFLICT') {
          throw new ConflictException({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
        }
        if (inserted === 1) {
          await audit(tx, {
            tenantId: p.tenantId,
            companyId: p.companyId,
            apiKeyId: p.apiKeyId,
            actor: p.apiKeyId,
            action: 'consumer.operation.reserved',
            resource: `FiscalIdempotencyKeyV2:${reservation.id}`,
            correlationId: command.correlationId,
            eventClass: 'FISCAL_AUDIT',
            metadata: {
              associationId: p.associationId,
              environment: p.environment,
              operation: command.operation,
              requestHashVersion: command.requestHashVersion,
              requestHash: command.requestHash.toLowerCase(),
            },
          });
        }
        return { created: inserted === 1, reservationId: reservation.id, state: reservation.state };
      },
      { maxWait: 30000, timeout: 30000 },
    );
  }

  async lookupOperation(command: ConsumerV2OperationCommand) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPrincipal(tx, command.principal, 'fiscal-v2:operations:read');
      const p = command.principal;
      const reservation = await tx.fiscalIdempotencyKeyV2.findFirst({
        where: {
          associationId: p.associationId,
          environment: p.environment,
          operation: command.operation,
          key: command.idempotencyKey,
        },
      });
      const result = evaluateConsumerV2Lookup({
        query: {
          associationId: p.associationId,
          environment: p.environment,
          operation: command.operation,
          idempotencyKey: command.idempotencyKey,
          requestHashVersion: command.requestHashVersion,
          requestHash: command.requestHash,
        },
        reservation: reservation && {
          associationId: reservation.associationId,
          environment: reservation.environment,
          operation: reservation.operation as ConsumerV2Operation,
          idempotencyKey: reservation.key,
          requestHashVersion: reservation.requestHashVersion,
          requestHash: reservation.requestHash,
          state: reservation.state as 'RESERVED',
          fiscalDocumentId: reservation.fiscalDocumentId,
        },
        retryAfterSeconds: 3,
      });
      await audit(tx, {
        tenantId: p.tenantId,
        companyId: p.companyId,
        apiKeyId: p.apiKeyId,
        actor: p.apiKeyId,
        action: 'consumer.operation.lookup',
        resource: `FiscalConsumerAssociation:${p.associationId}`,
        correlationId: command.correlationId,
        eventClass: 'SECURITY',
        metadata: { associationId: p.associationId, outcome: result.status },
      });
      return result;
    });
  }

  async findOwnedDocument(principal: ConsumerV2Principal, documentId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertPrincipal(tx, principal, 'fiscal-v2:operations:read');
      return tx.fiscalDocument.findFirst({
        where: {
          id: documentId,
          tenantId: principal.tenantId,
          companyId: principal.companyId,
          environment: principal.environment,
          originConsumerId: principal.consumerId,
          originAssociationId: principal.associationId,
        },
        select: { id: true, status: true },
      });
    });
  }

  /** Recheck the key and association inside every fiscal mutation transaction. */
  async assertPrincipalForScope(tx: Tx, principal: ConsumerV2Principal, scope: ConsumerV2Scope) {
    return this.assertPrincipal(tx, principal, scope);
  }

  private async assertPrincipal(tx: Tx, p: ConsumerV2Principal, scope: ConsumerV2Scope) {
    // Serialize v2 fiscal mutations with DP-01 association suspension.
    await tx.$queryRaw`SELECT id FROM fiscal_consumer_associations
      WHERE id = ${p.associationId}::uuid AND tenant_id = ${p.tenantId}::uuid FOR SHARE`;
    const binding = await tx.fiscalConsumerKeyBinding.findUnique({
      where: { apiKeyId: p.apiKeyId },
      include: {
        apiKey: { include: { tenant: true, companies: true } },
        association: {
          include: { consumerCompany: { include: { consumer: true, company: true } } },
        },
      },
    });
    const key = binding?.apiKey;
    const association = binding?.association;
    const mapping = association?.consumerCompany;
    const decision = authorizeConsumerV2({
      key: key
        ? {
            id: key.id,
            tenantId: key.tenantId,
            environment: key.environment,
            integrationProfile: key.integrationProfile,
            status: key.status,
            expiresAt: key.expiresAt,
            scopes: key.scopes,
          }
        : null,
      binding: binding && {
        apiKeyId: binding.apiKeyId,
        tenantId: binding.tenantId,
        associationId: binding.associationId,
      },
      association:
        association && mapping
          ? {
              id: association.id,
              tenantId: association.tenantId,
              consumerId: mapping.consumerId,
              companyId: mapping.companyId,
              environment: association.environment,
              status:
                association.status === 'ACTIVE' && mapping.status === 'ACTIVE'
                  ? 'ACTIVE'
                  : 'SUSPENDED',
            }
          : null,
      consumer: mapping
        ? {
            id: mapping.consumer.id,
            tenantId: mapping.consumer.tenantId,
            status: mapping.consumer.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
          }
        : null,
      requestedCompany: mapping
        ? {
            id: mapping.company.id,
            tenantId: mapping.company.tenantId,
            status: mapping.company.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
          }
        : null,
      requestedCompanyId: p.companyId,
      requestedEnvironment: p.environment,
      requiredScope: scope,
      now: new Date(),
      tenantActive: key?.tenant.status === 'ACTIVE',
      grantCompanyIds: key?.companies.map((company) => company.companyId),
    });
    if (
      !decision.allowed ||
      decision.principal.associationId !== p.associationId ||
      decision.principal.consumerId !== p.consumerId ||
      decision.principal.tenantId !== p.tenantId
    ) {
      throw new ForbiddenException({ code: 'CONSUMER_PRINCIPAL_REVOKED' });
    }
  }
}
