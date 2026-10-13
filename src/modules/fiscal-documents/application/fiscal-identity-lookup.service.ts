import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../domain/fiscal.constants';

const LOOKUP_OPERATIONS = {
  'fiscal-document.create.invoice': 'INVOICE',
  'fiscal-document.create.ticket': 'TICKET',
} as const satisfies Record<string, FiscalDocumentType>;

export type FiscalIdentityLookupOperation = keyof typeof LOOKUP_OPERATIONS;

export interface FiscalIdentityLookupResponse {
  readonly fiscalDocumentId: string;
  readonly companyId: string;
  readonly environment: HaciendaEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly status: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly idempotencyKey: string;
  readonly operation: FiscalIdentityLookupOperation;
  readonly reservationStatus: 'COMPLETED';
  readonly requestHashVerified: true;
}

/**
 * Finds a previously-created fiscal identity without changing fiscal state.
 *
 * `api_key_id` deliberately is not part of the search predicate. It scopes
 * creation, but would make a legitimate original reservation invisible after
 * API-key rotation. The current API key must still be authorized for the
 * company, and an exact request hash proves the caller knows the original
 * request identity.
 */
@Injectable()
export class FiscalIdentityLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly environment: HaciendaEnvironment;
    readonly apiKeyId: string;
    readonly scopes: string[];
    readonly idempotencyKey: string;
    readonly operation: FiscalIdentityLookupOperation;
    readonly requestHash: string;
  }): Promise<FiscalIdentityLookupResponse> {
    const expectedType = LOOKUP_OPERATIONS[input.operation];
    if (!expectedType) throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });

    const requiredScope = expectedType === 'INVOICE' ? 'invoices:read' : 'tickets:read';
    if (!input.scopes.includes(requiredScope)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    }

    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: input.apiKeyId, companyId: input.companyId } },
      select: { apiKeyId: true },
    });
    if (!authorization) {
      throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
    }

    const reservations = await this.prisma.fiscalIdempotencyKey.findMany({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        key: input.idempotencyKey,
        operation: input.operation,
      },
      select: {
        id: true,
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
          },
        },
      },
    });

    if (reservations.length === 0) {
      throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    }
    if (reservations.length !== 1) {
      throw new ConflictException({ code: 'FISCAL_IDENTITY_AMBIGUOUS' });
    }

    const reservation = reservations[0];
    // A mismatched hash is not a verified association. Return the same safe result
    // as an unknown key so callers cannot enumerate another request's identity.
    if (reservation.requestHash !== input.requestHash) {
      throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    }

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
      document.requestHash !== reservation.requestHash
    ) {
      throw new ConflictException({ code: 'FISCAL_IDENTITY_INTEGRITY_ERROR' });
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
      requestHashVerified: true,
    };
  }
}
