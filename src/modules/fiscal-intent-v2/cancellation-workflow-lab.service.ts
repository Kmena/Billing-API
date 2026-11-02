import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  FiscalCancellationWorkflow,
  Prisma,
} from '../../infrastructure/database/prisma-fiscal-types';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PrismaTransactionClient } from '../../infrastructure/database/prisma-fiscal-types';
import { PrismaConsumerV2Repository } from '../fiscal-consumers/infrastructure/persistence/prisma-consumer-v2.repository';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2Scope } from '../fiscal-consumers/domain/consumer-v2.policy';
import { W3ALabCorrectionService } from './w3-a-lab-correction.service';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';
import {
  replacementDraftFromInvoice,
  validateReplacementConfirmation,
} from './cancellation-replacement-draft';
import { prepareNdReversalLab } from './nd-reversal-lab-preparation';

type Tx = PrismaTransactionClient;
type Action = { principal: ConsumerV2Principal; key: string; correlationId: string };
const READ = 'fiscal-v2:operations:read' as const;
const CREDIT = 'fiscal-v2:credit-notes:create' as const;
const DEBIT = 'fiscal-v2:debit-notes:create' as const;
const INVOICE = 'fiscal-v2:invoices:create' as const;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validKey(key: string): void {
  if (!key || key.length > 128 || key.trim() !== key || !/^[\x21-\x7e]+$/.test(key))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_INVALID' });
}

function validReason(reason: unknown): asserts reason is string {
  if (
    typeof reason !== 'string' ||
    reason.trim() !== reason ||
    reason.length < 3 ||
    reason.length > 180
  )
    throw new BadRequestException({ code: 'CANCELLATION_REASON_INVALID' });
}

/** Persistent SANDBOX-only coordination around existing fiscal document engines. */
@Injectable()
export class CancellationWorkflowLabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: PrismaConsumerV2Repository,
    private readonly corrections: W3ALabCorrectionService,
    private readonly invoices: W2B2LabInvoiceService,
  ) {}

  private assertLab(p: ConsumerV2Principal): void {
    if (process.env.NODE_ENV !== 'test' || p.environment !== 'SANDBOX')
      throw new ForbiddenException({ code: 'CANCELLATION_LAB_ONLY' });
  }

  private async scoped(
    tx: Tx,
    id: string,
    p: ConsumerV2Principal,
    scope: ConsumerV2Scope,
    lock = false,
  ) {
    await this.consumers.assertPrincipalForScope(tx, p, scope);
    if (lock)
      await tx.$queryRaw`SELECT id FROM fiscal_cancellation_workflows
        WHERE id = ${id}::uuid AND tenant_id = ${p.tenantId}::uuid
          AND company_id = ${p.companyId}::uuid AND association_id = ${p.associationId}::uuid
        FOR UPDATE`;
    const row = await tx.fiscalCancellationWorkflow.findFirst({
      where: {
        id,
        tenantId: p.tenantId,
        companyId: p.companyId,
        environment: 'SANDBOX',
        consumerId: p.consumerId,
        associationId: p.associationId,
      },
    });
    if (!row) throw new NotFoundException({ code: 'CANCELLATION_WORKFLOW_NOT_FOUND' });
    return row;
  }

  private async audit(
    tx: Tx,
    row: FiscalCancellationWorkflow,
    input: Action,
    action: string,
    extra: Record<string, string> = {},
  ) {
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: row.tenantId,
        companyId: row.companyId,
        apiKeyId: input.principal.apiKeyId,
        actor: input.principal.apiKeyId,
        action: `cancellation.${action}`,
        resource: `FiscalCancellationWorkflow:${row.id}`,
        correlationId: input.correlationId,
        eventClass: 'FISCAL_AUDIT',
        metadata: {
          state: row.state,
          version: row.version,
          originalDocumentId: row.originalDocumentId,
          ...extra,
        },
      },
    });
  }

  private async transition(
    tx: Tx,
    row: FiscalCancellationWorkflow,
    input: Action,
    state: string,
    data: Prisma.FiscalCancellationWorkflowUpdateInput = {},
  ) {
    const updated = await tx.fiscalCancellationWorkflow.update({
      where: { id: row.id },
      data: { ...data, state, version: { increment: 1 } },
    });
    await this.audit(tx, updated, input, state.toLowerCase());
    return updated;
  }

  private view(row: FiscalCancellationWorkflow) {
    return {
      workflowId: row.id,
      state: row.state,
      version: row.version,
      originalDocumentId: row.originalDocumentId,
      cancellationNoteId: row.cancellationNoteId,
      replacementDocumentId: row.replacementDocumentId,
      replacementCancellationNoteId: row.replacementCancellationNoteId,
      reversalNoteId: row.reversalNoteId,
      policyBlock:
        row.state === 'BLOCKED_FISCAL_POLICY' ? 'DF_06_REFERENCE_AND_TAX_TREATMENT_PENDING' : null,
      reversalPreparation: row.reversalPlan,
    };
  }

  async cancel(originalDocumentId: string, reason: unknown, input: Action) {
    this.assertLab(input.principal);
    validKey(input.key);
    validReason(reason);
    const p = input.principal;
    const requestHash = digest({
      operation: 'CANCEL_TOTAL',
      originalDocumentId,
      reason,
      tenantId: p.tenantId,
      associationId: p.associationId,
    });
    const row = await this.prisma.$transaction(
      async (tx) => {
        await this.consumers.assertPrincipalForScope(tx, p, CREDIT);
        await tx.$queryRaw`SELECT id FROM fiscal_documents
        WHERE id = ${originalDocumentId}::uuid AND tenant_id = ${p.tenantId}::uuid
          AND company_id = ${p.companyId}::uuid AND origin_association_id = ${p.associationId}::uuid
        FOR UPDATE`;
        const source = await tx.fiscalDocument.findFirst({
          where: {
            id: originalDocumentId,
            tenantId: p.tenantId,
            companyId: p.companyId,
            environment: 'SANDBOX',
            type: { in: ['INVOICE', 'TICKET'] },
            originConsumerId: p.consumerId,
            originAssociationId: p.associationId,
            disposedAt: null,
          },
        });
        if (!source) throw new NotFoundException({ code: 'CANCELLATION_SOURCE_NOT_FOUND' });
        const existing = await tx.fiscalCancellationWorkflow.findUnique({
          where: { originalDocumentId },
        });
        if (existing) {
          if (existing.cancellationKey !== input.key || existing.cancellationHash !== requestHash)
            throw new ConflictException({ code: 'CANCELLATION_ALREADY_REQUESTED' });
          return existing;
        }
        if (source.status !== 'ACCEPTED')
          throw new UnprocessableEntityException({ code: 'CANCELLATION_SOURCE_NOT_ACCEPTED' });
        const prior = await tx.fiscalDocument.count({
          where: {
            sourceFiscalDocumentId: source.id,
            type: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
            status: { not: 'REJECTED' },
          },
        });
        if (prior) throw new ConflictException({ code: 'CANCELLATION_EXISTING_CORRECTION' });
        const created = await tx.fiscalCancellationWorkflow.create({
          data: {
            id: randomUUID(),
            tenantId: p.tenantId,
            companyId: p.companyId,
            environment: 'SANDBOX',
            consumerId: p.consumerId,
            associationId: p.associationId,
            originalDocumentId,
            state: 'CANCEL_REQUESTED',
            reason,
            cancellationKey: input.key,
            cancellationHash: requestHash,
          },
        });
        await this.audit(tx, created, input, 'requested');
        return created;
      },
      { maxWait: 30000, timeout: 30000 },
    );
    if (!row.cancellationNoteId) await this.ensureCancellationNote(row.id, input);
    return this.view(await this.reconcile(row.id, input, CREDIT));
  }

  private async ensureCancellationNote(id: string, input: Action): Promise<void> {
    const row = await this.prisma.fiscalCancellationWorkflow.findUniqueOrThrow({ where: { id } });
    if (row.cancellationNoteId) return;
    try {
      const result = await this.corrections.create('CREDIT_NOTE', {
        principal: input.principal,
        idempotencyKey: `cancel:${id}`,
        correlationId: input.correlationId,
        intent: {
          sourceDocumentId: row.originalDocumentId,
          mode: 'TOTAL',
          referenceReasonCode: '01',
          reason: row.reason,
          externalCorrectionId: id,
          correctionLines: [],
        },
      });
      await this.prisma.$transaction(async (tx) => {
        const current = await this.scoped(tx, id, input.principal, CREDIT, true);
        if (!current.cancellationNoteId)
          await this.transition(tx, current, input, 'CREDIT_NOTE_PENDING', {
            cancellationNote: { connect: { id: result.documentId } },
          });
      });
    } catch (error) {
      await this.markRecovery(id, input, CREDIT);
      throw error;
    }
  }

  private async markRecovery(id: string, input: Action, scope: ConsumerV2Scope): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.scoped(tx, id, input.principal, scope, true);
      if (row.state !== 'RECOVERY_REQUIRED')
        await this.transition(tx, row, input, 'RECOVERY_REQUIRED');
    });
  }

  /** Reconcile only observed terminal fiscal states; no document status is fabricated. */
  private async reconcile(
    id: string,
    input: Action,
    scope: ConsumerV2Scope = READ,
  ): Promise<FiscalCancellationWorkflow> {
    return this.prisma.$transaction(async (tx) => {
      let row = await this.scoped(tx, id, input.principal, scope, true);
      if (
        row.cancellationNoteId &&
        ['CREDIT_NOTE_PENDING', 'CANCEL_REQUESTED'].includes(row.state)
      ) {
        const note = await tx.fiscalDocument.findUniqueOrThrow({
          where: { id: row.cancellationNoteId },
        });
        if (note.status === 'REJECTED')
          row = await this.transition(tx, row, input, 'RECOVERY_REQUIRED');
        else if (note.status === 'ACCEPTED') {
          row = await this.transition(tx, row, input, 'CREDIT_NOTE_ACCEPTED');
          row = await this.transition(tx, row, input, 'CANCELLED');
        }
      }
      if (row.replacementDocumentId && row.state === 'REPLACEMENT_ISSUED') {
        const replacement = await tx.fiscalDocument.findUniqueOrThrow({
          where: { id: row.replacementDocumentId },
        });
        if (replacement.status === 'REJECTED')
          row = await this.transition(tx, row, input, 'RECOVERY_REQUIRED');
      }
      if (row.replacementCancellationNoteId && row.state === 'REPLACEMENT_CANCELLATION_PENDING') {
        const note = await tx.fiscalDocument.findUniqueOrThrow({
          where: { id: row.replacementCancellationNoteId },
        });
        if (note.status === 'REJECTED')
          row = await this.transition(tx, row, input, 'RECOVERY_REQUIRED');
        else if (note.status === 'ACCEPTED') {
          row = await this.transition(tx, row, input, 'REPLACEMENT_CANCELLATION_ACCEPTED');
          const plan = await this.reversalPlan(tx, row);
          row = await this.transition(tx, row, input, 'BLOCKED_FISCAL_POLICY', {
            reversalPlan: json(plan),
          });
        }
      }
      return row;
    });
  }

  async status(id: string, p: ConsumerV2Principal) {
    this.assertLab(p);
    return this.view(
      await this.reconcile(id, { principal: p, key: '', correlationId: randomUUID() }),
    );
  }

  async createDraft(id: string, observation: unknown, input: Action) {
    this.assertLab(input.principal);
    validKey(input.key);
    if (observation !== undefined && (typeof observation !== 'string' || observation.length > 180))
      throw new BadRequestException({ code: 'REPLACEMENT_OBSERVATION_INVALID' });
    await this.reconcile(id, input, INVOICE);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scoped(tx, id, input.principal, INVOICE, true);
      const requestHash = digest({ id, observation: observation ?? null });
      if (row.draftKey) {
        if (row.draftKey !== input.key || row.draftHash !== requestHash)
          throw new ConflictException({ code: 'REPLACEMENT_DRAFT_EXISTS' });
        return {
          ...this.view(row),
          draft: row.replacementDraft,
          observation: row.replacementObservation,
        };
      }
      if (row.state !== 'CANCELLED')
        throw new UnprocessableEntityException({ code: 'CANCELLATION_NOT_CONFIRMED' });
      const source = await tx.fiscalDocument.findUniqueOrThrow({
        where: { id: row.originalDocumentId },
      });
      const draft = replacementDraftFromInvoice(source, row.id, input.principal);
      const updated = await this.transition(tx, row, input, 'REPLACEMENT_DRAFT', {
        draftKey: input.key,
        draftHash: requestHash,
        replacementDraft: json(draft),
        replacementObservation: typeof observation === 'string' ? observation : null,
      });
      return { ...this.view(updated), draft, observation: updated.replacementObservation };
    });
  }

  async confirmReplacement(id: string, intent: unknown, input: Action) {
    this.assertLab(input.principal);
    validKey(input.key);
    const row = await this.reconcile(id, input, INVOICE);
    if (!row.replacementDraft)
      throw new UnprocessableEntityException({ code: 'REPLACEMENT_DRAFT_REQUIRED' });
    const expected = (row.replacementDraft as Record<string, unknown>).externalOperationId;
    const confirmed = validateReplacementConfirmation(intent, String(expected), input.principal);
    const requestHash = digest({ id, confirmed });
    const claimed = await this.prisma.$transaction(async (tx) => {
      const current = await this.scoped(tx, id, input.principal, INVOICE, true);
      if (current.confirmKey) {
        if (current.confirmKey !== input.key || current.confirmHash !== requestHash)
          throw new ConflictException({ code: 'REPLACEMENT_ALREADY_CONFIRMED' });
        return current;
      }
      if (current.state !== 'REPLACEMENT_DRAFT')
        throw new UnprocessableEntityException({ code: 'REPLACEMENT_NOT_EDITABLE' });
      const updated = await tx.fiscalCancellationWorkflow.update({
        where: { id },
        data: {
          confirmKey: input.key,
          confirmHash: requestHash,
          replacementDraft: json(confirmed),
          version: { increment: 1 },
        },
      });
      await this.audit(tx, updated, input, 'replacement_confirmed');
      return updated;
    });
    const linkedReplacement = claimed.replacementDocumentId
      ? await this.prisma.fiscalDocument.findUniqueOrThrow({
          where: { id: claimed.replacementDocumentId },
        })
      : null;
    if (
      !linkedReplacement ||
      (claimed.state === 'RECOVERY_REQUIRED' && linkedReplacement.status !== 'REJECTED')
    ) {
      try {
        const result = await this.invoices.create({
          principal: input.principal,
          idempotencyKey: `replacement:${id}`,
          correlationId: input.correlationId,
          intent: confirmed,
        });
        await this.prisma.$transaction(async (tx) => {
          const current = await this.scoped(tx, id, input.principal, INVOICE, true);
          if (!current.replacementDocumentId)
            await this.transition(
              tx,
              current,
              input,
              result.httpStatus === 202 ? 'RECOVERY_REQUIRED' : 'REPLACEMENT_ISSUED',
              { replacementDocument: { connect: { id: result.documentId } } },
            );
          else if (current.state === 'RECOVERY_REQUIRED' && result.httpStatus !== 202)
            await this.transition(tx, current, input, 'REPLACEMENT_ISSUED');
        });
      } catch (error) {
        await this.markRecovery(id, input, INVOICE);
        throw error;
      }
    }
    return this.view(await this.reconcile(id, input, INVOICE));
  }

  private async reversalPlan(tx: Tx, row: FiscalCancellationWorkflow) {
    if (!row.cancellationNoteId) throw new ConflictException({ code: 'CANCELLATION_NOTE_MISSING' });
    if (row.reversalNoteId) throw new ConflictException({ code: 'CANCELLATION_ALREADY_REVERSED' });
    const note = await tx.fiscalDocument.findUniqueOrThrow({
      where: { id: row.cancellationNoteId },
    });
    if (note.type !== 'CREDIT_NOTE' || note.status !== 'ACCEPTED')
      throw new UnprocessableEntityException({ code: 'CANCELLATION_NOTE_NOT_ACCEPTED' });
    const original = await tx.fiscalDocument.findUniqueOrThrow({
      where: { id: row.originalDocumentId },
    });
    const company = await tx.company.findUniqueOrThrow({
      where: { id: row.companyId },
      select: { identificationNumber: true },
    });
    const existingDebit = await tx.fiscalDocument.count({
      where: { sourceFiscalDocumentId: note.id, type: 'DEBIT_NOTE', status: { not: 'REJECTED' } },
    });
    if (existingDebit) throw new ConflictException({ code: 'CANCELLATION_ALREADY_REVERSED' });
    const signed = await tx.fiscalXmlArtifact.findFirst({
      where: {
        fiscalDocumentId: note.id,
        tenantId: row.tenantId,
        companyId: row.companyId,
        xsdValidationStatus: 'VALID',
        signedXmlStorageKey: { not: null },
        signatureVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    if (!signed)
      throw new UnprocessableEntityException({ code: 'ND_REVERSAL_CREDIT_XML_UNVERIFIED' });
    if (row.replacementDocumentId) {
      const replacement = await tx.fiscalDocument.findUniqueOrThrow({
        where: { id: row.replacementDocumentId },
      });
      if (replacement.status !== 'REJECTED') {
        if (replacement.status !== 'ACCEPTED' || !row.replacementCancellationNoteId)
          throw new UnprocessableEntityException({ code: 'ND_REVERSAL_REPLACEMENT_NOT_CANCELLED' });
        const replacementNc = await tx.fiscalDocument.findUniqueOrThrow({
          where: { id: row.replacementCancellationNoteId },
        });
        prepareNdReversalLab(replacement, replacementNc, company.identificationNumber);
        const signedReplacementNc = await tx.fiscalXmlArtifact.findFirst({
          where: {
            fiscalDocumentId: replacementNc.id,
            tenantId: row.tenantId,
            companyId: row.companyId,
            xsdValidationStatus: 'VALID',
            signedXmlStorageKey: { not: null },
            signatureVerifiedAt: { not: null },
          },
          select: { id: true },
        });
        if (!signedReplacementNc)
          throw new UnprocessableEntityException({
            code: 'ND_REVERSAL_REPLACEMENT_CREDIT_XML_UNVERIFIED',
          });
      }
    }
    const preparation = prepareNdReversalLab(original, note, company.identificationNumber);
    return {
      ...preparation,
      referenceClave: note.clave,
      referenceConsecutive: note.consecutive,
      replacementCancellationNoteId: row.replacementCancellationNoteId,
    };
  }

  async reverse(id: string, input: Action) {
    this.assertLab(input.principal);
    validKey(input.key);
    await this.reconcile(id, input, DEBIT);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.scoped(tx, id, input.principal, DEBIT, true);
      if (current.reversalKey) {
        if (
          current.reversalKey !== input.key ||
          current.reversalHash !== digest({ id, operation: 'REVERSE_CANCELLATION' })
        )
          throw new ConflictException({ code: 'REVERSAL_ALREADY_REQUESTED' });
        return current;
      }
      const note = current.cancellationNoteId
        ? await tx.fiscalDocument.findUniqueOrThrow({ where: { id: current.cancellationNoteId } })
        : null;
      if (!note || note.status !== 'ACCEPTED')
        throw new UnprocessableEntityException({ code: 'CANCELLATION_NOTE_NOT_ACCEPTED' });
      if (current.replacementDocumentId) {
        const replacement = await tx.fiscalDocument.findUniqueOrThrow({
          where: { id: current.replacementDocumentId },
        });
        if (replacement.status !== 'ACCEPTED' && replacement.status !== 'REJECTED')
          throw new UnprocessableEntityException({ code: 'REPLACEMENT_FISCAL_STATUS_PENDING' });
        if (replacement.status === 'ACCEPTED')
          await this.consumers.assertPrincipalForScope(tx, input.principal, CREDIT);
        else await this.reversalPlan(tx, current);
      } else await this.reversalPlan(tx, current);
      return this.transition(tx, current, input, 'REVERSAL_REQUESTED', {
        reversalKey: input.key,
        reversalHash: digest({ id, operation: 'REVERSE_CANCELLATION' }),
      });
    });
    if (!row.replacementDocumentId) return this.blockReversal(id, input);
    const replacement = await this.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: row.replacementDocumentId },
    });
    if (replacement.status === 'REJECTED') return this.blockReversal(id, input);
    if (!row.replacementCancellationNoteId) await this.ensureReplacementCancellation(id, input);
    return this.view(await this.reconcile(id, input, DEBIT));
  }

  private async blockReversal(id: string, input: Action) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.scoped(tx, id, input.principal, DEBIT, true);
      if (row.state === 'BLOCKED_FISCAL_POLICY') return;
      const plan = await this.reversalPlan(tx, row);
      await this.transition(tx, row, input, 'BLOCKED_FISCAL_POLICY', { reversalPlan: json(plan) });
    });
    return this.view(await this.reconcile(id, input, DEBIT));
  }

  private async ensureReplacementCancellation(id: string, input: Action): Promise<void> {
    const row = await this.prisma.fiscalCancellationWorkflow.findUniqueOrThrow({ where: { id } });
    if (!row.replacementDocumentId || row.replacementCancellationNoteId) return;
    try {
      const result = await this.corrections.create('CREDIT_NOTE', {
        principal: input.principal,
        idempotencyKey: `replacement-cancel:${id}`,
        correlationId: input.correlationId,
        intent: {
          sourceDocumentId: row.replacementDocumentId,
          mode: 'TOTAL',
          referenceReasonCode: '01',
          reason: 'Anulación de sustituta para reversión',
          externalCorrectionId: `${id}:replacement-cancel`,
          correctionLines: [],
        },
      });
      await this.prisma.$transaction(async (tx) => {
        const current = await this.scoped(tx, id, input.principal, CREDIT, true);
        if (!current.replacementCancellationNoteId)
          await this.transition(tx, current, input, 'REPLACEMENT_CANCELLATION_PENDING', {
            replacementCancellationNote: { connect: { id: result.documentId } },
          });
      });
    } catch (error) {
      await this.markRecovery(id, input, DEBIT);
      throw error;
    }
  }

  async history(id: string, p: ConsumerV2Principal) {
    this.assertLab(p);
    const row = await this.reconcile(id, { principal: p, key: '', correlationId: randomUUID() });
    return this.prisma.$transaction(async (tx) => {
      await this.scoped(tx, id, p, READ);
      const events = await tx.auditLog.findMany({
        where: {
          tenantId: p.tenantId,
          companyId: p.companyId,
          resource: `FiscalCancellationWorkflow:${id}`,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, createdAt: true, metadata: true, correlationId: true },
      });
      const ids = [
        row.originalDocumentId,
        row.cancellationNoteId,
        row.replacementDocumentId,
        row.replacementCancellationNoteId,
        row.reversalNoteId,
      ].filter((value): value is string => Boolean(value));
      const documents = await tx.fiscalDocument.findMany({
        where: {
          id: { in: ids },
          tenantId: p.tenantId,
          companyId: p.companyId,
          originConsumerId: p.consumerId,
          originAssociationId: p.associationId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          clave: true,
          consecutive: true,
          sourceFiscalDocumentId: true,
        },
      });
      return { ...this.view(row), events, documents };
    });
  }
}
