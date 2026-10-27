import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaTransactionClient } from '../../infrastructure/database/prisma-fiscal-types';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  FiscalDocumentService,
  CreateFiscalDocumentCommand,
} from '../fiscal-documents/application/fiscal-document.service';
import { PrepareFiscalXmlService } from '../fiscal-documents/application/fiscal-xml/prepare-fiscal-xml.service';
import { FISCAL_XML_ERROR } from '../fiscal-documents/domain/fiscal-xml/fiscal-xml.errors';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { PrismaConsumerV2Repository } from '../fiscal-consumers/infrastructure/persistence/prisma-consumer-v2.repository';
import { projectW2BInvoiceLab, W2B_LAB_HASH_VERSION } from './w2-b-lab-projection';

type Tx = PrismaTransactionClient;
const CREATE_SCOPE = 'fiscal-v2:invoices:create' as const;
const READ_SCOPE = 'fiscal-v2:operations:read' as const;
const OPERATION = 'CREATE_INVOICE' as const;
const XML_LEASE_MS = 5 * 60_000;

export interface W2B2CreateInput {
  principal: ConsumerV2Principal;
  idempotencyKey: string;
  intent: unknown;
  correlationId: string;
}

/** Test-only workflow. AppModule does not import its module or register its routes. */
@Injectable()
export class W2B2LabInvoiceService {
  private interruptAfterReserve = false;
  private interruptAfterDocument = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: PrismaConsumerV2Repository,
    private readonly documents: FiscalDocumentService,
    private readonly prepareXml: PrepareFiscalXmlService,
  ) {}

  /** Single-use fault injection for disposable-PostgreSQL recovery tests. */
  interruptOnceAfterReservation(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('W2_B2_LAB_ONLY');
    this.interruptAfterReserve = true;
  }

  interruptOnceAfterDocument(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('W2_B2_LAB_ONLY');
    this.interruptAfterDocument = true;
  }

  async create(input: W2B2CreateInput) {
    this.assertLab(input.principal);
    if (
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      !/^[\x21-\x7e]+$/.test(input.idempotencyKey)
    ) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_INVALID' });
    }
    const p = input.principal;
    const projection = projectW2BInvoiceLab(input.intent, {
      tenantId: p.tenantId,
      consumerId: p.consumerId,
      associationId: p.associationId,
      companyId: p.companyId,
      environment: p.environment,
    });
    const command: CreateFiscalDocumentCommand = {
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: 'SANDBOX',
      type: 'INVOICE',
      receiver: projection.intent.receiver as unknown as Record<string, unknown>,
      currency: projection.intent.currency,
      saleCondition: projection.intent.saleCondition,
      paymentMethod: projection.intent.paymentMethods[0].code,
      lines: projection.lines,
    };
    this.documents.validateV2LabCommand(command);
    const reservation = await this.reserve(input, projection.requestHash);
    if (this.interruptAfterReserve) {
      this.interruptAfterReserve = false;
      throw new ServiceUnavailableException({ code: 'W2_B2_LAB_INTERRUPTED_AFTER_RESERVATION' });
    }
    let created = false;
    let documentId: string;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await this.consumers.assertPrincipalForScope(tx, p, CREATE_SCOPE);
          await tx.$queryRaw`SELECT id FROM fiscal_idempotency_keys_v2 WHERE id = ${reservation.id}::uuid FOR UPDATE`;
          const current = await tx.fiscalIdempotencyKeyV2.findUniqueOrThrow({
            where: { id: reservation.id },
          });
          this.assertSameReservation(current, input, projection.requestHash);
          if (current.state === 'ABORTED_BEFORE_ALLOCATION') {
            throw new ConflictException({ code: 'FISCAL_OPERATION_ABORTED' });
          }
          if (current.fiscalDocumentId) {
            const owned = await tx.fiscalDocument.findFirst({
              where: {
                id: current.fiscalDocumentId,
                tenantId: p.tenantId,
                companyId: p.companyId,
                environment: 'SANDBOX',
                originConsumerId: p.consumerId,
                originAssociationId: p.associationId,
              },
              select: { id: true },
            });
            if (!owned) throw new ConflictException({ code: 'FISCAL_OPERATION_INTEGRITY_ERROR' });
            return { documentId: owned.id, created: false };
          }
          const document = await this.documents.createDocumentV2LabInTransaction(
            tx,
            command,
            projection.requestHash,
            { consumerId: p.consumerId, associationId: p.associationId },
          );
          await tx.fiscalIdempotencyKeyV2.update({
            where: { id: current.id },
            data: {
              state: 'COMMITTED',
              fiscalDocumentId: document.id,
              attemptCount: { increment: 1 },
              version: { increment: 1 },
            },
          });
          await this.audit(tx, input, current.id, 'fiscal-v2.document.created', document.id);
          return { documentId: document.id, created: true };
        },
        { maxWait: 30000, timeout: 30000 },
      );
      created = result.created;
      documentId = result.documentId;
    } catch (error) {
      if (!(error instanceof ConflictException) && !(error instanceof ForbiddenException)) {
        await this.markRecovery(
          input,
          reservation.id,
          null,
          'fiscal-v2.creation.recovery-required',
        );
      }
      throw error;
    }

    if (this.interruptAfterDocument) {
      this.interruptAfterDocument = false;
      await this.markRecovery(
        input,
        reservation.id,
        documentId,
        'fiscal-v2.document.recovery-required',
      );
      throw new ServiceUnavailableException({ code: 'W2_B2_LAB_INTERRUPTED_AFTER_DOCUMENT' });
    }

    const claim = await this.claimXml(input, reservation.id, documentId);
    if (claim === 'TERMINAL') {
      throw new UnprocessableEntityException({ code: 'FISCAL_OPERATION_TERMINAL' });
    }
    if (claim === 'BUSY')
      return this.operation(input, reservation.id, documentId, 202, 'RECOVERY_REQUIRED');
    if (claim === 'READY')
      return this.operation(input, reservation.id, documentId, created ? 201 : 200, 'COMMITTED');
    try {
      await this.prepareXml.executeV2Lab({
        tenantId: p.tenantId,
        companyId: p.companyId,
        environment: 'SANDBOX',
        consumerId: p.consumerId,
        associationId: p.associationId,
        documentId,
        actor: p.apiKeyId,
      });
      await this.finishXml(input, reservation.id, documentId, 'COMMITTED');
      return this.operation(input, reservation.id, documentId, created ? 201 : 200, 'COMMITTED');
    } catch (error) {
      if (this.isTerminalXmlFailure(error)) {
        await this.finishXml(input, reservation.id, documentId, 'FAILED_TERMINAL');
        throw new UnprocessableEntityException({ code: 'FISCAL_OPERATION_TERMINAL' });
      }
      await this.finishXml(input, reservation.id, documentId, 'RECOVERY_REQUIRED');
      return this.operation(input, reservation.id, documentId, 202, 'RECOVERY_REQUIRED');
    }
  }

  async getDocument(principal: ConsumerV2Principal, documentId: string) {
    this.assertLab(principal);
    return this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, principal, READ_SCOPE);
      const document = await tx.fiscalDocument.findFirst({
        where: {
          id: documentId,
          tenantId: principal.tenantId,
          companyId: principal.companyId,
          environment: 'SANDBOX',
          originConsumerId: principal.consumerId,
          originAssociationId: principal.associationId,
        },
        select: { id: true, status: true, clave: true, consecutive: true },
      });
      if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
      return document;
    });
  }

  private assertLab(p: ConsumerV2Principal): void {
    if (process.env.NODE_ENV !== 'test' || p.environment !== 'SANDBOX') {
      throw new ForbiddenException({ code: 'W2_B2_LAB_ONLY' });
    }
  }

  private async reserve(input: W2B2CreateInput, hash: string) {
    const p = input.principal;
    return this.prisma.$transaction(
      async (tx) => {
        await this.consumers.assertPrincipalForScope(tx, p, CREATE_SCOPE);
        const id = randomUUID();
        const inserted = await tx.$executeRaw`
        INSERT INTO fiscal_idempotency_keys_v2
          (id, tenant_id, association_id, environment, operation, key,
           request_hash_version, request_hash, state, first_api_key_id, updated_at)
        VALUES (${id}::uuid, ${p.tenantId}::uuid, ${p.associationId}::uuid,
          'SANDBOX'::"HaciendaEnvironment", ${OPERATION}, ${input.idempotencyKey},
          ${W2B_LAB_HASH_VERSION}, ${hash}, 'RESERVED', ${p.apiKeyId}::uuid, now())
        ON CONFLICT (association_id, environment, operation, key) DO NOTHING`;
        const row = await tx.fiscalIdempotencyKeyV2.findFirstOrThrow({
          where: {
            associationId: p.associationId,
            environment: 'SANDBOX',
            operation: OPERATION,
            key: input.idempotencyKey,
          },
        });
        this.assertSameReservation(row, input, hash);
        if (inserted === 1) await this.audit(tx, input, row.id, 'fiscal-v2.operation.reserved');
        return row;
      },
      { maxWait: 30000, timeout: 30000 },
    );
  }

  private assertSameReservation(
    row: {
      associationId: string;
      environment: string;
      operation: string;
      key: string;
      requestHashVersion: string;
      requestHash: string;
    },
    input: W2B2CreateInput,
    hash: string,
  ): void {
    if (
      row.associationId !== input.principal.associationId ||
      row.environment !== 'SANDBOX' ||
      row.operation !== OPERATION ||
      row.key !== input.idempotencyKey ||
      row.requestHashVersion !== W2B_LAB_HASH_VERSION ||
      row.requestHash !== hash
    ) {
      throw new ConflictException({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
    }
  }

  private async claimXml(input: W2B2CreateInput, reservationId: string, documentId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, input.principal, CREATE_SCOPE);
      await tx.$queryRaw`SELECT id FROM fiscal_idempotency_keys_v2 WHERE id = ${reservationId}::uuid FOR UPDATE`;
      const row = await tx.fiscalIdempotencyKeyV2.findUniqueOrThrow({
        where: { id: reservationId },
      });
      if (row.fiscalDocumentId !== documentId)
        throw new ConflictException({ code: 'FISCAL_OPERATION_INTEGRITY_ERROR' });
      const doc = await tx.fiscalDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: { status: true },
      });
      if (row.state === 'FAILED_TERMINAL') return 'TERMINAL' as const;
      if (doc.status === 'READY_TO_SUBMIT') {
        if (row.state !== 'COMMITTED' || row.leaseExpiresAt) {
          await tx.fiscalIdempotencyKeyV2.update({
            where: { id: reservationId },
            data: { state: 'COMMITTED', leaseExpiresAt: null, version: { increment: 1 } },
          });
          await this.audit(tx, input, reservationId, 'fiscal-v2.operation.reconciled', documentId);
        }
        return 'READY' as const;
      }
      if (row.leaseExpiresAt && row.leaseExpiresAt > new Date()) return 'BUSY' as const;
      await tx.fiscalIdempotencyKeyV2.update({
        where: { id: reservationId },
        data: {
          state: 'RECOVERY_REQUIRED',
          leaseExpiresAt: new Date(Date.now() + XML_LEASE_MS),
          attemptCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await this.audit(tx, input, reservationId, 'fiscal-v2.xml.processing', documentId);
      return 'CLAIMED' as const;
    });
  }

  private async finishXml(
    input: W2B2CreateInput,
    reservationId: string,
    documentId: string,
    state: 'COMMITTED' | 'RECOVERY_REQUIRED' | 'FAILED_TERMINAL',
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalIdempotencyKeyV2.updateMany({
        where: { id: reservationId, fiscalDocumentId: documentId },
        data: {
          state,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      await this.audit(
        tx,
        input,
        reservationId,
        state === 'COMMITTED'
          ? 'fiscal-v2.xml.ready'
          : state === 'FAILED_TERMINAL'
            ? 'fiscal-v2.xml.failed-terminal'
            : 'fiscal-v2.xml.recovery-required',
        documentId,
      );
    });
  }

  private async markRecovery(
    input: W2B2CreateInput,
    reservationId: string,
    documentId: string | null,
    action: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalIdempotencyKeyV2.updateMany({
        where: {
          id: reservationId,
          state: { in: ['RESERVED', 'COMMITTED', 'RECOVERY_REQUIRED'] },
          ...(documentId ? { fiscalDocumentId: documentId } : {}),
        },
        data: { state: 'RECOVERY_REQUIRED', leaseExpiresAt: null, version: { increment: 1 } },
      });
      await this.audit(tx, input, reservationId, action, documentId ?? undefined);
    });
  }

  private isTerminalXmlFailure(error: unknown): boolean {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse();
    const code =
      typeof response === 'object' && response !== null && 'code' in response
        ? response.code
        : undefined;
    return (
      code === FISCAL_XML_ERROR.xmlValidationFailed ||
      code === FISCAL_XML_ERROR.signatureVerificationFailed
    );
  }

  private async operation(
    input: W2B2CreateInput,
    reservationId: string,
    documentId: string,
    httpStatus: 200 | 201 | 202,
    state: 'COMMITTED' | 'RECOVERY_REQUIRED',
  ) {
    const p = input.principal;
    const document = await this.prisma.$transaction(async (tx) => {
      await this.consumers.assertPrincipalForScope(tx, p, CREATE_SCOPE);
      const owned = await tx.fiscalDocument.findFirst({
        where: {
          id: documentId,
          tenantId: p.tenantId,
          companyId: p.companyId,
          environment: 'SANDBOX',
          originConsumerId: p.consumerId,
          originAssociationId: p.associationId,
        },
        select: { status: true, clave: true, consecutive: true },
      });
      if (!owned) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
      return owned;
    });
    return {
      httpStatus,
      operationId: reservationId,
      documentId,
      documentStatus: document.status,
      state,
      clave: document.clave,
      consecutive: document.consecutive,
      correlationId: input.correlationId,
    };
  }

  private audit(
    tx: Tx,
    input: W2B2CreateInput,
    reservationId: string,
    action: string,
    documentId?: string,
  ) {
    const p = input.principal;
    return tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: p.tenantId,
        companyId: p.companyId,
        apiKeyId: p.apiKeyId,
        actor: p.apiKeyId,
        action,
        resource: `FiscalIdempotencyKeyV2:${reservationId}`,
        correlationId: input.correlationId,
        eventClass: 'FISCAL_AUDIT',
        metadata: {
          associationId: p.associationId,
          environment: p.environment,
          requestHashVersion: W2B_LAB_HASH_VERSION,
          ...(documentId ? { documentId } : {}),
        },
      },
    });
  }
}
