import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
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
import { mapIdentificationTypeToXmlCode } from '../domain/fiscal-identification.mapper';
import { ScaledDecimal } from '../domain/scaled-decimal';

export interface AuthenticatedUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
}

export interface FiscalDocumentLineInput {
  readonly lineNumber: number;
  readonly cabysCode: string;
  readonly description: string;
  readonly unitMeasure: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discountAmount?: string;
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
  readonly paymentMethod: string;
  readonly lines: FiscalDocumentLineInput[];
  readonly idempotencyKey?: string;
  readonly apiKeyId?: string;
  readonly actor?: string;
}

@Injectable()
export class FiscalDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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

  async createDocument(command: CreateFiscalDocumentCommand) {
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

      const fiscalProfile = await this.getReadyCompanyFiscalProfile(
        tx,
        command.tenantId,
        command.companyId,
      );

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

      const haciendaConnection = await tx.haciendaConnection.findFirst({
        where: {
          tenantId: command.tenantId,
          companyId: command.companyId,
          environment: command.environment,
          NOT: { status: 'DISABLED' },
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
            codigoActividad: fiscalProfile.economicActivityCode,
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
          paymentMethod: command.paymentMethod,
          lines: command.lines as never,
          totals: totals as never,
          idempotencyKey,
          requestHash,
        },
      });

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
          consecutive,
          status: 'READY_FOR_XML',
        },
      });
      return this.toFiscalDocumentResponse(document);
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
        tenantId_companyId_apiKeyId_operation_key: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          apiKeyId: input.apiKeyId,
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
      ON CONFLICT ("tenant_id", "company_id", "api_key_id", "operation", "key")
      DO NOTHING
      RETURNING "id"
    `;
    if (inserted[0]) return { id: inserted[0].id };

    const raced = await tx.fiscalIdempotencyKey.findUnique({
      where: {
        tenantId_companyId_apiKeyId_operation_key: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          apiKeyId: input.apiKeyId,
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
    tx: Pick<PrismaService, 'companyFiscalProfile'>,
    tenantId: string,
    companyId: string,
  ) {
    const profile = await tx.companyFiscalProfile.findFirst({
      where: { tenantId, companyId },
    });
    if (!profile) throw new BadRequestException({ code: 'COMPANY_FISCAL_PROFILE_REQUIRED' });

    const requiredProfileFields = [
      profile.economicActivityCode,
      profile.proveedorSistemas,
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
    return profile;
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
    if (!command.apiKeyId) {
      throw new BadRequestException({ code: 'API_KEY_CONTEXT_REQUIRED' });
    }
    if (!command.idempotencyKey) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    if (!ALLOWED_CURRENCY_CODES.includes(command.currency as never)) {
      throw new BadRequestException({ code: 'INVALID_CURRENCY' });
    }
    if (!ALLOWED_SALE_CONDITIONS.includes(command.saleCondition as never))
      throw new BadRequestException({ code: 'INVALID_SALE_CONDITION' });
    if (['02', '09', '11', '99'].includes(command.saleCondition))
      throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_SALE_CONDITION' });
    if (!ALLOWED_PAYMENT_METHODS.includes(command.paymentMethod as never))
      throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD' });
    if (command.paymentMethod === '99')
      throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_PAYMENT_METHOD' });
    if (command.currency !== 'CRC' && !command.exchangeRate)
      throw new BadRequestException({ code: 'EXCHANGE_RATE_REQUIRED' });
    this.validateReceiver(command);
    if (command.lines.length === 0)
      throw new BadRequestException({ code: 'FISCAL_DOCUMENT_LINES_REQUIRED' });
    for (const line of command.lines) {
      if (!/^\d{13}$/.test(line.cabysCode))
        throw new BadRequestException({ code: 'INVALID_CABYS_CODE' });
      if (line.lineNumber < 1) throw new BadRequestException({ code: 'INVALID_LINE_NUMBER' });
      if (!['Sp', 'Unid'].includes(line.unitMeasure)) {
        throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_UNIT_MEASURE' });
      }
      if (
        ScaledDecimal.from(line.quantity).isNegative() ||
        ScaledDecimal.from(line.unitPrice).isNegative()
      ) {
        throw new BadRequestException({ code: 'INVALID_LINE_AMOUNT' });
      }
      if (ScaledDecimal.from(line.taxAmount ?? '0').toString() !== '0.00000') {
        if (!line.taxCode || !line.taxRateCode || !line.taxRate) {
          throw new BadRequestException({ code: 'FISCAL_TAX_METADATA_REQUIRED' });
        }
        if (!/^\d{2}$/.test(line.taxCode) || !/^\d{2}$/.test(line.taxRateCode)) {
          throw new BadRequestException({ code: 'INVALID_FISCAL_TAX_METADATA' });
        }
      }
      if (ScaledDecimal.from(line.discountAmount ?? '0').toString() !== '0.00000') {
        throw new BadRequestException({ code: 'UNSUPPORTED_FISCAL_DISCOUNT_METADATA' });
      }
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
    });
    return createHash('sha256').update(normalized).digest('hex');
  }
}
