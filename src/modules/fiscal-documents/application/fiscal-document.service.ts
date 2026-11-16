import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaTransactionClient } from '../../../infrastructure/database/prisma-fiscal-types';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../audit/application/audit.service';
import {
  ALLOWED_CURRENCY_CODES,
  ALLOWED_PAYMENT_METHODS,
  ALLOWED_SALE_CONDITIONS,
  DEFAULT_BRANCH_CODE,
  DEFAULT_TERMINAL_CODE,
  FISCAL_NORMAL_SITUATION,
  FiscalDocumentType,
  HaciendaEnvironment,
} from '../domain/fiscal.constants';
import {
  buildConsecutive,
  buildFiscalKey,
  generateSecurityCode,
} from '../domain/fiscal-key.generator';
import { isCanonicalHaciendaUnit, isHaciendaDiscountCode } from '../domain/fiscal-catalogs';
import { mapIdentificationTypeToXmlCode } from '../domain/fiscal-identification.mapper';
import { ScaledDecimal } from '../domain/scaled-decimal';
import { HACIENDA_V44_REFERENCE_CODES } from '../domain/fiscal-xml/hacienda-v44-contract';
import { classifyFiscalLineTax } from '../domain/fiscal-line-tax-treatment';
import {
  canonicalFiscalPayloadHash,
  FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
  fiscalPayloadInputFromCommand,
} from './fiscal-payload-equivalence';
import { FiscalIssuanceEligibilityService } from './fiscal-xml/fiscal-issuance-eligibility.service';

export interface AuthenticatedUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
}

export interface FiscalDocumentLineInput {
  readonly lineNumber: number;
  /** Stored only in corrective snapshots; never serialized as a Hacienda field. */
  readonly sourceLineNumber?: number;
  readonly commercialReference?: string;
  readonly cabysCode: string;
  readonly description: string;
  readonly unitMeasure: string;
  readonly transactionType?: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discountAmount?: string;
  readonly discountCode?: string;
  readonly discountNature?: string;
  readonly discountOther?: string;
  readonly taxAmount?: string;
  readonly taxCode?: string;
  readonly taxRateCode?: string;
  readonly taxRate?: string;
}

export interface CreateFiscalDocumentCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly type: FiscalDocumentType;
  readonly receiver?: Record<string, unknown>;
  readonly currency: string;
  readonly exchangeRate?: string;
  readonly saleCondition: string;
  readonly creditTermDays?: number;
  readonly paymentMethod?: string;
  readonly lines: FiscalDocumentLineInput[];
  readonly idempotencyKey?: string;
  readonly apiKeyId?: string;
  readonly actor?: string;
  readonly fiscalPayloadEquivalence?: {
    readonly contractVersion?: string;
    readonly hash?: string;
  };
  readonly sourceDocumentId?: string;
  readonly referenceCode?: string;
  readonly referenceReason?: string;
}

@Injectable()
export class FiscalDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly issuanceEligibility?: FiscalIssuanceEligibilityService,
  ) {}

  async ensureDefaultIssuancePoint(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
    name?: string;
    actor: string;
  }) {
    this.assertTenantAdmin(input.actor);
    const company = await this.findTenantCompany(input.tenantId, input.companyId);
    const point = await this.prisma.fiscalIssuancePoint.upsert({
      where: {
        companyId_environment_branchCode_terminalCode: {
          companyId: company.id,
          environment: input.environment,
          branchCode: DEFAULT_BRANCH_CODE,
          terminalCode: DEFAULT_TERMINAL_CODE,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: company.id,
        environment: input.environment,
        branchCode: DEFAULT_BRANCH_CODE,
        terminalCode: DEFAULT_TERMINAL_CODE,
        name: input.name ?? 'Default fiscal issuance point',
        active: true,
        isDefault: true,
      },
      update: { active: true, isDefault: true, name: input.name },
    });
    this.auditService.record({
      tenantId: input.tenantId,
      companyId: company.id,
      actor: input.actor,
      action: 'fiscal-issuance-point.upserted',
      resource: `FiscalIssuancePoint:${point.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: {
        environment: input.environment,
        branchCode: point.branchCode,
        terminalCode: point.terminalCode,
      },
    });
    return point;
  }

  async configureSequence(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
    documentType: FiscalDocumentType;
    nextValue: string;
    actor: string;
  }) {
    this.assertTenantAdmin(input.actor);
    const company = await this.findTenantCompany(input.tenantId, input.companyId);
    const point = await this.findDefaultIssuancePoint(
      input.tenantId,
      company.id,
      input.environment,
    );
    const nextValue = BigInt(input.nextValue);
    if (nextValue < 1n || nextValue > 9999999999n)
      throw new BadRequestException({ code: 'INVALID_SEQUENCE_VALUE' });

    const existing = await this.prisma.fiscalSequence.findUnique({
      where: {
        tenantId_companyId_environment_branchCode_terminalCode_documentType: {
          tenantId: input.tenantId,
          companyId: company.id,
          environment: input.environment,
          branchCode: point.branchCode,
          terminalCode: point.terminalCode,
          documentType: input.documentType,
        },
      },
    });
    if (existing?.lastAssigned !== null && existing?.lastAssigned !== undefined) {
      throw new ConflictException({ code: 'FISCAL_SEQUENCE_ALREADY_STARTED' });
    }

    const sequence = await this.prisma.fiscalSequence.upsert({
      where: {
        tenantId_companyId_environment_branchCode_terminalCode_documentType: {
          tenantId: input.tenantId,
          companyId: company.id,
          environment: input.environment,
          branchCode: point.branchCode,
          terminalCode: point.terminalCode,
          documentType: input.documentType,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: company.id,
        environment: input.environment,
        branchCode: point.branchCode,
        terminalCode: point.terminalCode,
        documentType: input.documentType,
        nextValue,
      },
      update: { nextValue },
    });
    this.auditService.record({
      tenantId: input.tenantId,
      companyId: company.id,
      actor: input.actor,
      action: 'fiscal-sequence.configured',
      resource: `FiscalSequence:${sequence.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: {
        environment: input.environment,
        documentType: input.documentType,
        nextValue: nextValue.toString(),
      },
    });
    return this.toSerializableRecord(sequence);
  }

  async getDocument(input: {
    tenantId: string;
    documentId: string;
    apiKeyId: string;
    scopes: string[];
  }) {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: { id: input.documentId, tenantId: input.tenantId },
    });
    if (!document) throw new NotFoundException({ code: 'FISCAL_DOCUMENT_NOT_FOUND' });
    if (document.type === 'CREDIT_NOTE' || document.type === 'DEBIT_NOTE') {
      throw new ForbiddenException({ code: 'FISCAL_ISSUANCE_BLOCKED' });
    }
    const requiredScope = document.type === 'INVOICE' ? 'invoices:read' : 'tickets:read';
    if (!input.scopes.includes(requiredScope))
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: input.apiKeyId, companyId: document.companyId } },
    });
    if (!authorization) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
    this.auditService.record({
      tenantId: input.tenantId,
      companyId: document.companyId,
      action: 'fiscal-document.read',
      resource: `FiscalDocument:${document.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: { type: document.type, status: document.status },
    });
    return this.toFiscalDocumentResponse(document);
  }

  async getCorrectiveNoteLab(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
    apiKeyId: string;
    type: 'CREDIT_NOTE' | 'DEBIT_NOTE';
    documentId?: string;
    idempotencyKey?: string;
  }) {
    if (process.env.NODE_ENV !== 'test' || input.environment !== 'SANDBOX') {
      throw new ForbiddenException({ code: 'FISCAL_ISSUANCE_BLOCKED' });
    }
    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: input.apiKeyId, companyId: input.companyId } },
    });
    if (!authorization) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
    let documentId = input.documentId;
    if (input.idempotencyKey) {
      const key = await this.prisma.fiscalIdempotencyKey.findUnique({
        where: {
          tenantId_companyId_operation_key: {
            tenantId: input.tenantId,
            companyId: input.companyId,
            operation: `fiscal-document.create.${input.type.toLowerCase()}`,
            key: input.idempotencyKey,
          },
        },
      });
      if (!key) throw new NotFoundException({ code: 'CORRECTION_NOT_FOUND' });
      if (!key.fiscalDocumentId) {
        throw new ConflictException({ code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' });
      }
      documentId = key.fiscalDocumentId;
    }
    const document = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: documentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        type: input.type,
      },
    });
    if (!document) throw new NotFoundException({ code: 'CORRECTION_NOT_FOUND' });
    await this.prisma.fiscalNoteAudit.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalDocumentId: document.id,
        sourceDocumentId: document.sourceFiscalDocumentId as string,
        apiKeyId: input.apiKeyId,
        action: input.idempotencyKey ? 'NOTE.RECOVERED_LAB' : 'NOTE.READ_LAB',
        requestHash: document.requestHash as string,
      },
    });
    return this.toFiscalDocumentResponse(document);
  }

  async createDocument(command: CreateFiscalDocumentCommand) {
    const isNote = command.type === 'CREDIT_NOTE' || command.type === 'DEBIT_NOTE';
    if (isNote && (process.env.NODE_ENV !== 'test' || command.environment !== 'SANDBOX')) {
      throw new ForbiddenException({ code: 'FISCAL_ISSUANCE_BLOCKED' });
    }
    if (!isNote && (command.sourceDocumentId || command.referenceCode || command.referenceReason)) {
      throw new BadRequestException({ code: 'CORRECTION_FIELDS_NOT_ALLOWED' });
    }
    this.validateCreateCommand(command);
    const requestHash = this.hashRequest(command);
    const apiKeyId = command.apiKeyId as string;

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findFirst({
        where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
      });
      if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

      if (apiKeyId) {
        const authorization = await tx.apiKeyCompany.findUnique({
          where: {
            apiKeyId_companyId: { apiKeyId, companyId: command.companyId },
          },
        });
        if (!authorization)
          throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
      }

      await this.getReadyCompanyFiscalProfile(tx, command.tenantId, command.companyId);

      const idempotencyKey = command.idempotencyKey as string;
      const operation = `fiscal-document.create.${command.type.toLowerCase()}`;
      const idempotency = await this.reserveIdempotencyKey(tx, {
        tenantId: command.tenantId,
        companyId: command.companyId,
        apiKeyId,
        operation,
        key: idempotencyKey,
        requestHash,
      });
      if ('response' in idempotency) return idempotency.response;

      let source: Awaited<ReturnType<typeof tx.fiscalDocument.findFirst>> = null;
      if (isNote) {
        // Lock before checking the source and allocating a consecutive. This
        // also serializes direct total notes without blocking partial v2 notes.
        await tx.$queryRaw`SELECT "id" FROM "fiscal_documents" WHERE "id" = ${command.sourceDocumentId}::uuid FOR UPDATE`;
        source = await tx.fiscalDocument.findFirst({
          where: {
            id: command.sourceDocumentId,
            tenantId: command.tenantId,
            companyId: command.companyId,
            environment: 'SANDBOX',
            type: 'INVOICE',
            status: 'ACCEPTED',
            disposedAt: null,
          },
        });
        if (!source) throw new NotFoundException({ code: 'CORRECTION_SOURCE_NOT_FOUND' });
        const issuer = source.issuerSnapshot as Record<string, unknown>;
        if (issuer.identificationNumber !== company.identificationNumber) {
          throw new ConflictException({ code: 'CORRECTION_ISSUER_CHANGED' });
        }
        if (
          !source.receiverSnapshot ||
          JSON.stringify(source.receiverSnapshot) !== JSON.stringify(command.receiver)
        ) {
          throw new BadRequestException({ code: 'CORRECTION_RECEIVER_MISMATCH' });
        }
        if (command.type === 'CREDIT_NOTE') {
          if (JSON.stringify(source.lines) !== JSON.stringify(command.lines)) {
            throw new BadRequestException({ code: 'CREDIT_NOTE_MUST_BE_TOTAL' });
          }
          const prior = await tx.fiscalDocument.findFirst({
            where: { sourceFiscalDocumentId: source.id, type: 'CREDIT_NOTE' },
          });
          if (prior) throw new ConflictException({ code: 'CREDIT_NOTE_ALREADY_EXISTS' });
        }
        const verifiedSourceXml = await tx.fiscalXmlArtifact.findFirst({
          where: {
            fiscalDocumentId: source.id,
            tenantId: command.tenantId,
            companyId: command.companyId,
            xsdValidationStatus: 'VALID',
            signedXmlStorageKey: { not: null },
            signatureVerifiedAt: { not: null },
          },
          select: { id: true },
        });
        if (!verifiedSourceXml) {
          throw new ConflictException({ code: 'CORRECTION_SOURCE_XML_UNVERIFIED' });
        }
      }

      const document = await this.createDocumentCore(
        tx,
        command,
        requestHash,
        idempotencyKey,
        undefined,
        source
          ? {
              sourceFiscalDocumentId: source.id,
              referenceSnapshot: {
                documentTypeCode: '01',
                clave: source.clave,
                issueDate: source.issueDate.toISOString(),
                code: command.referenceCode,
                reason: command.referenceReason,
              },
            }
          : undefined,
      );

      if (source) {
        await tx.fiscalNoteAudit.create({
          data: {
            id: randomUUID(),
            tenantId: command.tenantId,
            companyId: command.companyId,
            fiscalDocumentId: document.id,
            sourceDocumentId: source.id,
            apiKeyId,
            action: `${command.type}.CREATED_LAB`,
            requestHash,
          },
        });
      }

      await tx.fiscalIdempotencyKey.update({
        where: { id: idempotency.id },
        data: { status: 'COMPLETED', fiscalDocumentId: document.id },
      });
      this.auditService.record({
        tenantId: command.tenantId,
        companyId: command.companyId,
        actor: command.actor,
        action: 'fiscal-document.created',
        resource: `FiscalDocument:${document.id}`,
        eventClass: EventClass.FISCAL_AUDIT,
        metadata: {
          type: command.type,
          environment: command.environment,
          consecutive: document.consecutive,
          status: 'READY_FOR_XML',
        },
      });
      return this.toFiscalDocumentResponse(document);
    });
  }

  /**
   * Shared allocation and immutable snapshot writer. The caller owns authorization,
   * idempotency and the surrounding transaction; this method never writes either key table.
   */
  async createDocumentV2LabInTransaction(
    tx: PrismaTransactionClient,
    command: CreateFiscalDocumentCommand,
    requestHash: string,
    origin: { consumerId: string; associationId: string },
  ) {
    this.validateV2LabCommand(command);
    return this.createDocumentCore(tx, command, requestHash, null, origin);
  }

  async createCorrectiveDocumentV3LabInTransaction(
    tx: PrismaTransactionClient,
    command: CreateFiscalDocumentCommand,
    requestHash: string,
    origin: { consumerId: string; associationId: string },
    correction: { sourceFiscalDocumentId: string; referenceSnapshot: Record<string, unknown> },
  ) {
    if (
      process.env.NODE_ENV !== 'test' ||
      command.environment !== 'SANDBOX' ||
      !['CREDIT_NOTE', 'DEBIT_NOTE'].includes(command.type) ||
      (!command.receiver &&
        !(
          command.type === 'CREDIT_NOTE' &&
          correction.referenceSnapshot.documentTypeCode === '04' &&
          correction.referenceSnapshot.mode === 'TOTAL'
        ))
    ) {
      throw new ForbiddenException({ code: 'W3_A_LAB_ONLY' });
    }
    this.validateFiscalContent(command);
    return this.createDocumentCore(tx, command, requestHash, null, origin, correction);
  }

  validateV2LabCommand(command: CreateFiscalDocumentCommand): void {
    if (
      process.env.NODE_ENV !== 'test' ||
      command.environment !== 'SANDBOX' ||
      !['INVOICE', 'TICKET'].includes(command.type)
    ) {
      throw new ForbiddenException({ code: 'W2_B2_LAB_ONLY' });
    }
    this.validateFiscalContent(command);
  }

  private async createDocumentCore(
    tx: PrismaTransactionClient,
    command: CreateFiscalDocumentCommand,
    requestHash: string,
    idempotencyKey: string | null,
    origin?: { consumerId: string; associationId: string },
    correction?: { sourceFiscalDocumentId: string; referenceSnapshot: Record<string, unknown> },
  ) {
    const company = await tx.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId, status: 'ACTIVE' },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    const fiscalProfile = await this.getReadyCompanyFiscalProfile(
      tx,
      command.tenantId,
      command.companyId,
    );
    // Perform the shared read-only predicate before allocation. A production
    // module always injects it; the fallback keeps isolated legacy tests valid.
    let eligibleConnection:
      { readonly connectionId: string; readonly secretReference: string } | undefined;
    if (this.issuanceEligibility) {
      const eligibility = await this.issuanceEligibility.haciendaEligibility({
        tenantId: command.tenantId,
        companyId: command.companyId,
        environment: command.environment,
      });
      if (!eligibility.eligible) {
        throw new BadRequestException({ code: 'HACIENDA_CONNECTION_REQUIRED' });
      }
      eligibleConnection = eligibility;
    }

    // Recheck the exact validated connection/reference in the allocation
    // transaction. A concurrent rotation or revocation must restart readiness
    // rather than allocate against credential state that was never validated.
    const haciendaConnection = await tx.haciendaConnection.findFirst({
      where: {
        tenantId: command.tenantId,
        companyId: command.companyId,
        environment: command.environment,
        status: 'CONNECTED',
        ...(eligibleConnection
          ? {
              id: eligibleConnection.connectionId,
              secretReference: eligibleConnection.secretReference,
            }
          : {}),
      },
    });
    if (!haciendaConnection)
      throw new BadRequestException({ code: 'HACIENDA_CONNECTION_REQUIRED' });

    const point = await tx.fiscalIssuancePoint.findFirst({
      where: {
        tenantId: command.tenantId,
        companyId: command.companyId,
        environment: command.environment,
        active: true,
        isDefault: true,
      },
      orderBy: { id: 'asc' },
    });
    if (!point) throw new BadRequestException({ code: 'FISCAL_ISSUANCE_POINT_REQUIRED' });

    const allocated = await tx.$queryRaw<Array<{ assigned: bigint }>>`
        INSERT INTO "fiscal_sequences" (
          "id", "tenant_id", "company_id", "environment", "branch_code", "terminal_code",
          "document_type", "next_value", "last_assigned", "created_at", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${command.tenantId}::uuid, ${command.companyId}::uuid,
          ${command.environment}::"HaciendaEnvironment", ${point.branchCode}, ${point.terminalCode},
          ${command.type}::"FiscalDocumentType", 2, 1, NOW(), NOW()
        )
        ON CONFLICT ("tenant_id", "company_id", "environment", "branch_code", "terminal_code", "document_type")
        DO UPDATE SET "last_assigned" = "fiscal_sequences"."next_value",
          "next_value" = "fiscal_sequences"."next_value" + 1,
          "updated_at" = NOW()
        RETURNING "last_assigned" AS assigned
      `;
    const sequenceValue = allocated[0]?.assigned ?? 1n;
    if (sequenceValue > 9999999999n)
      throw new ConflictException({ code: 'FISCAL_SEQUENCE_EXHAUSTED' });
    const issueDate = new Date();
    const consecutive = buildConsecutive({
      branchCode: point.branchCode,
      terminalCode: point.terminalCode,
      documentType: command.type,
      sequenceValue,
    });
    const securityCode = generateSecurityCode();
    const clave = buildFiscalKey({
      issuedAt: issueDate,
      issuerIdentificationNumber: company.identificationNumber,
      consecutive,
      securityCode,
    });
    const totals = this.calculateTotals(command.lines);

    const document = await tx.fiscalDocument.create({
      data: {
        id: randomUUID(),
        tenantId: command.tenantId,
        companyId: command.companyId,
        environment: command.environment,
        type: command.type,
        status: 'READY_FOR_XML',
        issuancePointId: point.id,
        branchCode: point.branchCode,
        terminalCode: point.terminalCode,
        sequenceValue,
        consecutive,
        clave,
        securityCode,
        situation: FISCAL_NORMAL_SITUATION,
        issueDate,
        issuerSnapshot: {
          legalName: company.legalName,
          tradeName: company.tradeName,
          identificationType: company.identificationType,
          identificationNumber: company.identificationNumber,
          codigoActividad: fiscalProfile.resolvedActivityCode,
          proveedorSistemas: fiscalProfile.proveedorSistemas,
          provincia: fiscalProfile.province,
          canton: fiscalProfile.canton,
          distrito: fiscalProfile.district,
          barrio: fiscalProfile.barrio,
          otrasSenas: fiscalProfile.otrasSenas,
          email: fiscalProfile.email,
          phoneCountryCode: fiscalProfile.phoneCountryCode,
          phoneNumber: fiscalProfile.phoneNumber,
        },
        receiverSnapshot: command.receiver as never,
        currency: command.currency,
        exchangeRate: command.exchangeRate ?? null,
        saleCondition: command.saleCondition,
        creditTermDays: command.creditTermDays ?? null,
        paymentMethod: command.paymentMethod ?? null,
        lines: command.lines as never,
        totals: totals as never,
        idempotencyKey,
        requestHash,
        ...(correction
          ? {
              sourceFiscalDocumentId: correction.sourceFiscalDocumentId,
              referenceSnapshot: correction.referenceSnapshot as never,
            }
          : {}),
        ...(origin
          ? { originConsumerId: origin.consumerId, originAssociationId: origin.associationId }
          : {}),
      },
    });

    return document;
  }

  async createCorrectiveNoteLab(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
    type: 'CREDIT_NOTE' | 'DEBIT_NOTE';
    sourceDocumentId: string;
    referenceCode: string;
    referenceReason: string;
    lines?: FiscalDocumentLineInput[];
    idempotencyKey: string;
    apiKeyId: string;
    actor: string;
  }) {
    if (process.env.NODE_ENV !== 'test' || input.environment !== 'SANDBOX') {
      throw new ForbiddenException({ code: 'FISCAL_ISSUANCE_BLOCKED' });
    }
    const source = await this.prisma.fiscalDocument.findFirst({
      where: {
        id: input.sourceDocumentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        status: 'ACCEPTED',
      },
    });
    if (!source) throw new NotFoundException({ code: 'CORRECTION_SOURCE_NOT_FOUND' });
    return this.createDocument({
      ...input,
      receiver: source.receiverSnapshot as Record<string, unknown> | undefined,
      currency: source.currency,
      exchangeRate: source.exchangeRate?.toString(),
      saleCondition: source.saleCondition,
      creditTermDays: source.creditTermDays ?? undefined,
      paymentMethod: source.paymentMethod ?? undefined,
      lines:
        input.type === 'CREDIT_NOTE'
          ? (source.lines as unknown as FiscalDocumentLineInput[])
          : (input.lines ?? []),
    });
  }

  private async reserveIdempotencyKey(
    tx: Pick<PrismaService, 'fiscalIdempotencyKey' | 'fiscalDocument' | '$queryRaw'>,
    input: {
      tenantId: string;
      companyId: string;
      apiKeyId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
  ): Promise<{ id: string } | { response: Record<string, unknown> }> {
    const existing = await tx.fiscalIdempotencyKey.findUnique({
      where: {
        tenantId_companyId_operation_key: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          operation: input.operation,
          key: input.key,
        },
      },
    });
    if (existing) return this.resolveExistingIdempotencyKey(tx, existing, input.requestHash);

    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "fiscal_idempotency_keys" (
        "id", "tenant_id", "company_id", "key", "api_key_id", "operation",
        "request_hash", "status", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.companyId}::uuid,
        ${input.key}, ${input.apiKeyId}::uuid, ${input.operation}, ${input.requestHash},
        'IN_PROGRESS'::"FiscalIdempotencyStatus", NOW(), NOW()
      )
      ON CONFLICT ("tenant_id", "company_id", "operation", "key")
      DO NOTHING
      RETURNING "id"
    `;
    if (inserted[0]) return { id: inserted[0].id };

    const raced = await tx.fiscalIdempotencyKey.findUnique({
      where: {
        tenantId_companyId_operation_key: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          operation: input.operation,
          key: input.key,
        },
      },
    });
    if (!raced) throw new ConflictException({ code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' });
    return this.resolveExistingIdempotencyKey(tx, raced, input.requestHash);
  }

  private async resolveExistingIdempotencyKey(
    tx: Pick<PrismaService, 'fiscalDocument'>,
    existing: { requestHash: string; fiscalDocumentId: string | null },
    requestHash: string,
  ): Promise<{ response: Record<string, unknown> }> {
    if (existing.requestHash !== requestHash)
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' });
    if (existing.fiscalDocumentId) {
      const existingDocument = await tx.fiscalDocument.findUnique({
        where: { id: existing.fiscalDocumentId },
      });
      if (existingDocument) return { response: this.toFiscalDocumentResponse(existingDocument) };
    }
    throw new ConflictException({ code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' });
  }

  private async getReadyCompanyFiscalProfile(
    tx: Pick<PrismaService, 'companyFiscalProfile' | 'companyEconomicActivity'>,
    tenantId: string,
    companyId: string,
  ) {
    const profile = await tx.companyFiscalProfile.findFirst({
      where: { tenantId, companyId },
    });
    if (!profile) throw new BadRequestException({ code: 'COMPANY_FISCAL_PROFILE_REQUIRED' });

    // Economic activity used for NEW fiscal issuance must come from Billing's
    // verified CompanyEconomicActivity projection. The legacy
    // economicActivityCode remains a compatibility projection only; it is never
    // an independent source of truth for emission. This focused validator runs
    // before idempotency reservation and before fiscal sequence allocation.
    const resolvedActivityCode = await this.resolveIssuerEconomicActivity(tx, profile, companyId);

    const requiredProfileFields = [
      resolvedActivityCode,
      profile.province,
      profile.canton,
      profile.district,
      profile.otrasSenas,
      profile.email,
    ];
    const hasMissingField = requiredProfileFields.some((value) => !value?.trim());
    if (hasMissingField) {
      throw new BadRequestException({ code: 'COMPANY_FISCAL_PROFILE_INCOMPLETE' });
    }
    return { ...profile, resolvedActivityCode };
  }

  private async resolveIssuerEconomicActivity(
    tx: Pick<PrismaService, 'companyEconomicActivity'>,
    profile: { defaultEconomicActivityId: string | null },
    companyId: string,
  ): Promise<string> {
    if (profile.defaultEconomicActivityId) {
      const defaultActivity = await tx.companyEconomicActivity.findUnique({
        where: { id: profile.defaultEconomicActivityId },
        select: {
          id: true,
          companyId: true,
          code: true,
          haciendaStatus: true,
          billingEnabled: true,
        },
      });
      if (!defaultActivity || defaultActivity.companyId !== companyId) {
        throw new BadRequestException({ code: 'DEFAULT_ECONOMIC_ACTIVITY_INVALID' });
      }
      if (!this.isValidIssuerEconomicActivity(defaultActivity)) {
        throw new BadRequestException({ code: 'DEFAULT_ECONOMIC_ACTIVITY_INVALID' });
      }
      return defaultActivity.code;
    }

    const activities = await tx.companyEconomicActivity.findMany({
      where: { companyId },
      select: { id: true, code: true, haciendaStatus: true, billingEnabled: true },
    });
    const validActivities = activities.filter((activity) =>
      this.isValidIssuerEconomicActivity(activity),
    );

    if (validActivities.length === 1) return validActivities[0].code;
    if (activities.length === 0) {
      throw new BadRequestException({ code: 'ECONOMIC_ACTIVITY_MISSING' });
    }
    throw new BadRequestException({ code: 'DEFAULT_ECONOMIC_ACTIVITY_MISSING' });
  }

  private isValidIssuerEconomicActivity(activity: {
    haciendaStatus: string;
    billingEnabled: boolean;
  }): boolean {
    return activity.haciendaStatus === 'A' && activity.billingEnabled;
  }

  private async findTenantCompany(tenantId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    return company;
  }

  private async findDefaultIssuancePoint(
    tenantId: string,
    companyId: string,
    environment: HaciendaEnvironment,
  ) {
    const point = await this.prisma.fiscalIssuancePoint.findFirst({
      where: { tenantId, companyId, environment, active: true, isDefault: true },
    });
    if (!point) throw new BadRequestException({ code: 'FISCAL_ISSUANCE_POINT_REQUIRED' });
    return point;
  }

  private assertTenantAdmin(role: string): void {
    if (role !== 'TENANT_ADMIN') throw new ForbiddenException({ code: 'ADMIN_ROLE_REQUIRED' });
  }

  private validateCreateCommand(command: CreateFiscalDocumentCommand): void {
    if (command.type === 'CREDIT_NOTE' || command.type === 'DEBIT_NOTE') {
      if (!command.sourceDocumentId || !/^[0-9a-f-]{36}$/i.test(command.sourceDocumentId)) {
        throw new BadRequestException({ code: 'CORRECTION_SOURCE_REQUIRED' });
      }
      if (
        !command.referenceCode ||
        !HACIENDA_V44_REFERENCE_CODES.some((code) => code === command.referenceCode) ||
        !command.referenceReason ||
        command.referenceReason.trim().length < 3 ||
        command.referenceReason.length > 180
      ) {
        throw new BadRequestException({ code: 'CORRECTION_REFERENCE_INVALID' });
      }
    }
    if (!command.apiKeyId) {
      throw new BadRequestException({ code: 'API_KEY_CONTEXT_REQUIRED' });
    }
    if (!command.idempotencyKey) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    this.validateFiscalContent(command);
  }

  private validateFiscalContent(command: CreateFiscalDocumentCommand): void {
    if (!ALLOWED_CURRENCY_CODES.includes(command.currency as never)) {
      throw new BadRequestException({ code: 'INVALID_CURRENCY' });
    }
    if (!ALLOWED_SALE_CONDITIONS.includes(command.saleCondition as never))
      throw new BadRequestException({ code: 'INVALID_SALE_CONDITION' });
    if (['09', '11', '99'].includes(command.saleCondition))
      throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_SALE_CONDITION' });
    this.validateSalePaymentTerms(command);
    if (command.currency !== 'CRC' && !command.exchangeRate)
      throw new BadRequestException({ code: 'EXCHANGE_RATE_REQUIRED' });
    this.validateReceiver(command);
    this.validateFiscalPayloadEquivalence(command);
    if (command.lines.length === 0)
      throw new BadRequestException({ code: 'FISCAL_DOCUMENT_LINES_REQUIRED' });
    for (const line of command.lines) {
      if (!/^\d{13}$/.test(line.cabysCode))
        throw new BadRequestException({ code: 'INVALID_CABYS_CODE' });
      if (line.lineNumber < 1) throw new BadRequestException({ code: 'INVALID_LINE_NUMBER' });
      if (!isCanonicalHaciendaUnit(line.unitMeasure)) {
        throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_UNIT_MEASURE' });
      }
      if (
        ScaledDecimal.from(line.quantity).isNegative() ||
        ScaledDecimal.from(line.unitPrice).isNegative()
      ) {
        throw new BadRequestException({ code: 'INVALID_LINE_AMOUNT' });
      }
      if (
        line.taxAmount === undefined ||
        !line.taxCode ||
        !line.taxRateCode ||
        line.taxRate === undefined
      ) {
        throw new BadRequestException({ code: 'FISCAL_TAX_METADATA_REQUIRED' });
      }
      if (!/^\d{2}$/.test(line.taxCode) || !/^\d{2}$/.test(line.taxRateCode)) {
        throw new BadRequestException({ code: 'INVALID_FISCAL_TAX_METADATA' });
      }
      const zeroTax = ScaledDecimal.from(line.taxAmount).isZero();
      const zeroRate = ScaledDecimal.from(line.taxRate).isZero();
      if (line.taxRateCode === '10' && (line.taxCode !== '01' || !zeroTax || !zeroRate)) {
        throw new BadRequestException({ code: 'FISCAL_EXEMPT_TAX_INCONSISTENT' });
      }
      if (zeroTax && line.taxRateCode !== '10') {
        if (
          line.taxCode !== '01' ||
          line.taxRateCode !== '08' ||
          ScaledDecimal.from(line.taxRate).toString() !== '13.00000'
        ) {
          throw new BadRequestException({ code: 'FISCAL_ZERO_TAX_TREATMENT_UNSUPPORTED' });
        }
        const gross = ScaledDecimal.from(line.quantity).multiply(
          ScaledDecimal.from(line.unitPrice),
        );
        const net = gross.subtract(ScaledDecimal.from(line.discountAmount ?? '0'));
        if (
          !net
            .multiply(ScaledDecimal.from(line.taxRate))
            .multiply(ScaledDecimal.from('0.01'))
            .isZero()
        ) {
          throw new BadRequestException({ code: 'FISCAL_ZERO_TAX_AMOUNT_INCONSISTENT' });
        }
      }
      if (line.transactionType !== undefined) {
        if (command.type !== 'INVOICE' || !/^(0[1-9]|1[0-3])$/.test(line.transactionType)) {
          throw new BadRequestException({ code: 'FISCAL_TRANSACTION_TYPE_INVALID' });
        }
        if (
          (line.transactionType === '07' && line.taxRateCode !== '10') ||
          (line.transactionType === '06' && line.taxRateCode === '10')
        ) {
          throw new BadRequestException({ code: 'FISCAL_AFFILIATION_TREATMENT_MISMATCH' });
        }
      }
      this.validateLineDiscount(line);
      const gross = ScaledDecimal.from(line.quantity).multiply(ScaledDecimal.from(line.unitPrice));
      const subtotal = gross.subtract(ScaledDecimal.from(line.discountAmount ?? '0'));
      try {
        classifyFiscalLineTax(line, subtotal);
      } catch (error) {
        const reason = error instanceof Error ? error.message.split(':')[0] : '';
        const code =
          reason === 'FISCAL_XML_TAX_METADATA_REQUIRED' ||
          reason === 'FISCAL_XML_IVA_RATE_CODE_REQUIRED'
            ? 'FISCAL_TAX_METADATA_REQUIRED'
            : reason.startsWith('FISCAL_XML_')
              ? reason
              : 'INVALID_FISCAL_TAX_METADATA';
        throw new BadRequestException({ code });
      }
    }
  }

  private validateFiscalPayloadEquivalence(command: CreateFiscalDocumentCommand): void {
    const evidence = command.fiscalPayloadEquivalence;
    if (!evidence) return;
    if (!evidence.contractVersion || !evidence.hash) {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_EQUIVALENCE_HEADERS_REQUIRED' });
    }
    if (evidence.contractVersion !== FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION) {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_CONTRACT_VERSION_UNSUPPORTED' });
    }
    if (!/^[a-fA-F0-9]{64}$/.test(evidence.hash)) {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_HASH_INVALID' });
    }
    if (
      canonicalFiscalPayloadHash(fiscalPayloadInputFromCommand(command)) !==
      evidence.hash.toLowerCase()
    ) {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_HASH_INVALID' });
    }
  }
  private validateSalePaymentTerms(command: CreateFiscalDocumentCommand): void {
    if (command.saleCondition === '02') {
      const creditTermDays = command.creditTermDays;
      if (
        typeof creditTermDays !== 'number' ||
        !Number.isInteger(creditTermDays) ||
        creditTermDays < 1 ||
        creditTermDays > 99999
      ) {
        throw new BadRequestException({ code: 'FISCAL_CREDIT_TERM_REQUIRED' });
      }
      if (command.paymentMethod) {
        throw new BadRequestException({ code: 'CREDIT_PAYMENT_METHOD_NOT_ALLOWED' });
      }
      return;
    }

    if (command.creditTermDays !== undefined) {
      throw new BadRequestException({ code: 'FISCAL_CREDIT_TERM_NOT_ALLOWED' });
    }
    if (!command.paymentMethod) {
      throw new BadRequestException({ code: 'PAYMENT_METHOD_REQUIRED' });
    }
    if (!ALLOWED_PAYMENT_METHODS.includes(command.paymentMethod as never)) {
      throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD' });
    }
    if (command.paymentMethod === '99') {
      throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_PAYMENT_METHOD' });
    }
  }

  private validateLineDiscount(line: FiscalDocumentLineInput): void {
    const discount = ScaledDecimal.from(line.discountAmount ?? '0');
    if (discount.isZero()) {
      if (line.discountCode || line.discountNature || line.discountOther) {
        throw new BadRequestException({ code: 'FISCAL_DISCOUNT_METADATA_WITHOUT_AMOUNT' });
      }
      return;
    }

    const gross = ScaledDecimal.from(line.quantity).multiply(ScaledDecimal.from(line.unitPrice));
    if (discount.isNegative() || gross.subtract(discount).isNegative()) {
      throw new BadRequestException({ code: 'INVALID_FISCAL_DISCOUNT_AMOUNT' });
    }
    if (!line.discountCode || !line.discountNature) {
      throw new BadRequestException({ code: 'FISCAL_DISCOUNT_METADATA_REQUIRED' });
    }
    if (!isHaciendaDiscountCode(line.discountCode)) {
      throw new BadRequestException({ code: 'INVALID_FISCAL_DISCOUNT_CODE' });
    }
    const nature = line.discountNature.trim();
    if (nature.length < 3 || nature.length > 80) {
      throw new BadRequestException({ code: 'INVALID_FISCAL_DISCOUNT_NATURE' });
    }
    if (line.discountCode === '99') {
      const other = line.discountOther?.trim() ?? '';
      if (other.length < 5 || other.length > 100) {
        throw new BadRequestException({ code: 'FISCAL_DISCOUNT_OTHER_REQUIRED' });
      }
    } else if (line.discountOther) {
      throw new BadRequestException({ code: 'FISCAL_DISCOUNT_OTHER_NOT_ALLOWED' });
    }
  }

  private validateReceiver(command: CreateFiscalDocumentCommand): void {
    if (command.type === 'INVOICE' && !command.receiver) {
      throw new BadRequestException({ code: 'INVOICE_RECEIVER_REQUIRED' });
    }
    if (!command.receiver) return;

    const receiverName = this.requiredReceiverText(command.receiver, 'name');
    const receiverIdentificationType = this.requiredReceiverText(
      command.receiver,
      'identificationType',
    );
    const receiverIdentificationNumber = this.requiredReceiverText(
      command.receiver,
      'identificationNumber',
    );
    if (!receiverName || !receiverIdentificationType || !receiverIdentificationNumber) {
      throw new BadRequestException({ code: 'RECEIVER_IDENTIFICATION_REQUIRED' });
    }

    try {
      mapIdentificationTypeToXmlCode(receiverIdentificationType);
    } catch {
      throw new BadRequestException({ code: 'INVALID_RECEIVER_IDENTIFICATION_TYPE' });
    }
    if (!/^\d{1,12}$/.test(receiverIdentificationNumber)) {
      throw new BadRequestException({ code: 'INVALID_RECEIVER_IDENTIFICATION_NUMBER' });
    }
    if (command.type === 'INVOICE' && !this.requiredReceiverText(command.receiver, 'email')) {
      throw new BadRequestException({ code: 'INVOICE_RECEIVER_EMAIL_REQUIRED' });
    }
  }

  private requiredReceiverText(receiver: Record<string, unknown>, field: string): string {
    const value = receiver[field];
    return typeof value === 'string' ? value.trim() : '';
  }

  private calculateTotals(lines: FiscalDocumentLineInput[]): Record<string, string> {
    return lines.reduce(
      (totals, line) => {
        const gross = ScaledDecimal.from(line.quantity).multiply(
          ScaledDecimal.from(line.unitPrice),
        );
        const discount = ScaledDecimal.from(line.discountAmount ?? '0');
        const tax = ScaledDecimal.from(line.taxAmount ?? '0');
        const net = gross.subtract(discount);
        return {
          grossAmount: ScaledDecimal.from(totals.grossAmount).add(gross).toString(),
          discountAmount: ScaledDecimal.from(totals.discountAmount).add(discount).toString(),
          taxAmount: ScaledDecimal.from(totals.taxAmount).add(tax).toString(),
          totalAmount: ScaledDecimal.from(totals.totalAmount).add(net).add(tax).toString(),
        };
      },
      {
        grossAmount: '0.00000',
        discountAmount: '0.00000',
        taxAmount: '0.00000',
        totalAmount: '0.00000',
      },
    );
  }

  private toFiscalDocumentResponse(document: Record<string, unknown>): Record<string, unknown> {
    const safeDocument = this.toSerializableRecord(document);
    delete safeDocument.securityCode;
    delete safeDocument.requestHash;
    return safeDocument;
  }

  private toSerializableRecord(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? value.toString() : value,
      ]),
    );
  }

  private hashRequest(command: CreateFiscalDocumentCommand): string {
    const normalized = JSON.stringify({
      ...command,
      actor: undefined,
      apiKeyId: undefined,
      idempotencyKey: undefined,
      fiscalPayloadEquivalence: undefined,
    });
    return createHash('sha256').update(normalized).digest('hex');
  }
}
