import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  FiscalIdentityEvidenceLookupService,
  type FiscalIdentityEvidencePayload,
} from '../fiscal-identity-evidence-lookup.service';
import { FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION } from '../fiscal-payload-equivalence';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const API_KEY_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '3eb5ce42-be1a-4eaa-acb4-39cc7ae29659';
const KEY = 'inventori:1:invoice:1890';
const INTERNAL_HASH = 'a'.repeat(64);
const PAYLOAD: FiscalIdentityEvidencePayload = {
  receiver: {
    name: 'SANITIZED RECEIVER',
    identificationType: 'FISICA',
    identificationNumber: '123456789',
    email: 'receiver@example.test',
  },
  currency: 'CRC',
  exchangeRate: null,
  saleCondition: '01',
  creditTermDays: null,
  paymentMethod: '01',
  lines: [
    {
      lineNumber: 1,
      cabysCode: '1234567890123',
      description: 'Sanitized fiscal line',
      unitMeasure: 'Unid',
      quantity: '1',
      unitPrice: '20000.0',
      discountAmount: '0',
      taxAmount: '2600',
      taxCode: '01',
      taxRateCode: '08',
      taxRate: '13',
    },
  ],
};

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    companyId: COMPANY_ID,
    environment: 'SANDBOX',
    type: 'INVOICE',
    status: 'ACCEPTED',
    clave: '50608102600020753025100100001010000000006181741622',
    consecutive: '00100001010000000006',
    idempotencyKey: KEY,
    requestHash: INTERNAL_HASH,
    receiverSnapshot: PAYLOAD.receiver,
    currency: PAYLOAD.currency,
    exchangeRate: null,
    saleCondition: PAYLOAD.saleCondition,
    creditTermDays: null,
    paymentMethod: PAYLOAD.paymentMethod,
    lines: PAYLOAD.lines,
    ...overrides,
  };
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    key: KEY,
    operation: 'fiscal-document.create.invoice',
    requestHash: INTERNAL_HASH,
    status: 'COMPLETED',
    fiscalDocumentId: DOCUMENT_ID,
    fiscalDocument: makeDocument(),
    ...overrides,
  };
}

function makePrisma(options: { authorized?: boolean; reservations?: unknown[] } = {}) {
  return {
    apiKeyCompany: {
      findUnique: jest.fn().mockResolvedValue(options.authorized === false ? null : { apiKeyId: API_KEY_ID }),
    },
    fiscalIdempotencyKey: {
      findMany: jest.fn().mockResolvedValue(options.reservations ?? [makeReservation()]),
      create: jest.fn(),
      update: jest.fn(),
    },
    fiscalDocument: { create: jest.fn(), update: jest.fn() },
    fiscalSubmission: { create: jest.fn(), update: jest.fn() },
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    companyId: COMPANY_ID,
    environment: 'SANDBOX' as const,
    apiKeyId: API_KEY_ID,
    scopes: ['invoices:read'],
    idempotencyKey: KEY,
    operation: 'fiscal-document.create.invoice' as const,
    equivalenceContractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
    fiscalPayload: PAYLOAD,
    ...overrides,
  };
}

function errorCode(error: unknown) {
  return (error as { getResponse(): { code?: string } }).getResponse().code;
}

describe('FiscalIdentityEvidenceLookupService', () => {
  it('recovers the sanitized INV-966 historical identity from matching independent evidence', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityEvidenceLookupService(prisma as never);

    await expect(service.execute(command())).resolves.toEqual({
      fiscalDocumentId: DOCUMENT_ID,
      companyId: COMPANY_ID,
      environment: 'SANDBOX',
      documentType: 'INVOICE',
      status: 'ACCEPTED',
      clave: '50608102600020753025100100001010000000006181741622',
      consecutive: '00100001010000000006',
      idempotencyKey: KEY,
      operation: 'fiscal-document.create.invoice',
      reservationStatus: 'COMPLETED',
      equivalenceContractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
      fiscalPayloadEquivalent: true,
    });
    expect(prisma.fiscalIdempotencyKey.findMany.mock.calls[0][0].where).not.toHaveProperty('apiKeyId');
    expect(prisma.fiscalIdempotencyKey.create).not.toHaveBeenCalled();
    expect(prisma.fiscalIdempotencyKey.update).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.update).not.toHaveBeenCalled();
    expect(prisma.fiscalSubmission.create).not.toHaveBeenCalled();
  });

  it('does not recover an identity when the independent fiscal payload differs', async () => {
    const service = new FiscalIdentityEvidenceLookupService(makePrisma() as never);
    const fiscalPayload = { ...PAYLOAD, lines: [{ ...PAYLOAD.lines[0], quantity: '2' }] };
    await expect(service.execute(command({ fiscalPayload }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['wrong operation', { operation: 'fiscal-document.create.ticket' }],
    ['wrong environment', { environment: 'PRODUCTION' }],
  ])('fails closed on %s', async (_label, overrides) => {
    const service = new FiscalIdentityEvidenceLookupService(makePrisma() as never);
    const scoped = _label === 'wrong operation' ? { ...overrides, scopes: ['invoices:read', 'tickets:read'] } : overrides;
    await expect(service.execute(command(scoped))).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when historical candidates conflict', async () => {
    const service = new FiscalIdentityEvidenceLookupService(
      makePrisma({ reservations: [makeReservation(), makeReservation({ fiscalDocumentId: 'other' })] }) as never,
    );
    await expect(service.execute(command())).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing or unverifiable evidence before reading historical reservations', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityEvidenceLookupService(prisma as never);
    await expect(service.execute(command({ fiscalPayload: { ...PAYLOAD, lines: undefined } }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.fiscalIdempotencyKey.findMany).not.toHaveBeenCalled();
  });

  it('supports an authorized API-key rotation without relying on api_key_id', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityEvidenceLookupService(prisma as never);
    await expect(service.execute(command({ apiKeyId: 'rotated-key-id' }))).resolves.toMatchObject({
      fiscalDocumentId: DOCUMENT_ID,
      fiscalPayloadEquivalent: true,
    });
  });

  it('enforces tenant/company authorization and read scope', async () => {
    const unauthorized = new FiscalIdentityEvidenceLookupService(makePrisma({ authorized: false }) as never);
    await expect(unauthorized.execute(command())).rejects.toBeInstanceOf(ForbiddenException);
    const noScope = new FiscalIdentityEvidenceLookupService(makePrisma() as never);
    await expect(noScope.execute(command({ scopes: [] }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is stable for concurrent read-only historical recovery', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityEvidenceLookupService(prisma as never);
    const results = await Promise.all(Array.from({ length: 8 }, () => service.execute(command())));
    expect(results.every((result) => result.fiscalDocumentId === DOCUMENT_ID)).toBe(true);
    expect(prisma.fiscalIdempotencyKey.create).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported evidence-contract version without changing v1 lookup behavior', async () => {
    const service = new FiscalIdentityEvidenceLookupService(makePrisma() as never);
    await service.execute(command({ equivalenceContractVersion: 'unsupported.v1' })).catch((error) =>
      expect(errorCode(error)).toBe('FISCAL_PAYLOAD_CONTRACT_VERSION_UNSUPPORTED'),
    );
  });
});