import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../domain/fiscal.constants';
import type { FiscalDocumentLineInput } from './fiscal-document.service';
import {
  canonicalFiscalPayloadHash,
  FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
  fiscalPayloadInputFromStoredDocument,
} from './fiscal-payload-equivalence';

const LOOKUP_OPERATIONS = {
  'fiscal-document.create.invoice': 'INVOICE',
  'fiscal-document.create.ticket': 'TICKET',
} as const satisfies Record<string, FiscalDocumentType>;

export type FiscalIdentityEvidenceLookupOperation = keyof typeof LOOKUP_OPERATIONS;

export interface FiscalIdentityEvidencePayload {
  readonly receiver?: Record<string, unknown> | null;
  readonly currency: string;
  readonly exchangeRate?: string | null;
  readonly saleCondition: string;
  readonly creditTermDays?: number | null;
  readonly paymentMethod?: string | null;
  readonly lines: readonly FiscalDocumentLineInput[];
}

export interface FiscalIdentityEvidenceLookupResponse {
  readonly fiscalDocumentId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly status: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly idempotencyKey: string;
  readonly operation: FiscalIdentityEvidenceLookupOperation;
  readonly reservationStatus: 'COMPLETED';
  readonly equivalenceContractVersion: typeof FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION;
  readonly fiscalPayloadEquivalent: true;
}

/**
 * Historical recovery uses independent canonical fiscal evidence. It never
 * accepts a FiscalDocument id from callers and it never substitutes for the
 * original internal request hash used by Billing's idempotency reservation.
 */
@Injectable()
export class FiscalIdentityEvidenceLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly environment: HaciendaEnvironment;
    readonly apiKeyId: string;
    readonly scopes: string[];
    readonly idempotencyKey: string;
    readonly operation: FiscalIdentityEvidenceLookupOperation;
    readonly equivalenceContractVersion: string;
    readonly fiscalPayload: FiscalIdentityEvidencePayload;
  }): Promise<FiscalIdentityEvidenceLookupResponse> {
    const expectedType = LOOKUP_OPERATIONS[input.operation];
    if (!expectedType) throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    if (input.equivalenceContractVersion !== FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION) {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_CONTRACT_VERSION_UNSUPPORTED' });
    }

    const requiredScope = expectedType === 'INVOICE' ? 'invoices:read' : 'tickets:read';
    if (!input.scopes.includes(requiredScope)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    }
    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: input.apiKeyId, companyId: input.companyId } },
      select: { apiKeyId: true },
    });
    if (!authorization) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });

    let suppliedEvidenceHash: string;
    try {
      suppliedEvidenceHash = canonicalFiscalPayloadHash(input.fiscalPayload);
    } catch {
      throw new BadRequestException({ code: 'FISCAL_PAYLOAD_EVIDENCE_INVALID' });
    }

    // api_key_id is deliberately omitted to preserve discoverability after key rotation.
    const reservations = await this.prisma.fiscalIdempotencyKey.findMany({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        key: input.idempotencyKey,
        operation: input.operation,
      },
      select: {
        key: true,
        operation: true,
        requestHash: true,
        status: true,
        fiscalDocumentId: true,
        fiscalDocument: {
          select: {
            id: true,
            tenantId: true,
            companyId: true,
            environment: true,
            type: true,
            status: true,
            clave: true,
            consecutive: true,
            idempotencyKey: true,
            requestHash: true,
            receiverSnapshot: true,
            currency: true,
            exchangeRate: true,
            saleCondition: true,
            creditTermDays: true,
            paymentMethod: true,
            lines: true,
          },
        },
      },
    });
    if (reservations.length === 0)
      throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    if (reservations.length !== 1)
      throw new ConflictException({ code: 'FISCAL_IDENTITY_AMBIGUOUS' });

    const reservation = reservations[0];
    const document = reservation.fiscalDocument;
    if (
      reservation.status !== 'COMPLETED' ||
      !reservation.fiscalDocumentId ||
      !document ||
      document.id !== reservation.fiscalDocumentId ||
      document.tenantId !== input.tenantId ||
      document.companyId !== input.companyId ||
      document.environment !== input.environment ||
      document.type !== expectedType ||
      document.idempotencyKey !== reservation.key ||
      !document.requestHash ||
      document.requestHash !== reservation.requestHash
    ) {
      throw new ConflictException({ code: 'FISCAL_IDENTITY_INTEGRITY_ERROR' });
    }

    let historicalEvidenceHash: string;
    try {
      historicalEvidenceHash = canonicalFiscalPayloadHash(
        fiscalPayloadInputFromStoredDocument(document),
      );
    } catch {
      throw new ConflictException({ code: 'FISCAL_IDENTITY_EVIDENCE_INTEGRITY_ERROR' });
    }
    // A payload mismatch is safe non-disclosure: it never authorizes creation
    // and it never reveals a historical document to a caller.
    if (historicalEvidenceHash !== suppliedEvidenceHash) {
      throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    }

    return {
      fiscalDocumentId: document.id,
      companyId: document.companyId,
      environment: document.environment,
      documentType: document.type,
      status: document.status,
      clave: document.clave,
      consecutive: document.consecutive,
      idempotencyKey: reservation.key,
      operation: input.operation,
      reservationStatus: 'COMPLETED',
      equivalenceContractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
      fiscalPayloadEquivalent: true,
    };
  }
}
