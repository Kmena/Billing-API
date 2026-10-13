import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FiscalIdentityLookupService } from '../fiscal-identity-lookup.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const API_KEY_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const KEY = 'inventori:1:invoice:1890';
const HASH = 'a'.repeat(64);

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
    requestHash: HASH,
    ...overrides,
  };
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    key: KEY,
    operation: 'fiscal-document.create.invoice',
    requestHash: HASH,
    status: 'COMPLETED',
    fiscalDocumentId: DOCUMENT_ID,
    fiscalDocument: makeDocument(),
    ...overrides,
  };
}

function makePrisma(options: { authorized?: boolean; reservations?: unknown[] } = {}) {
  return {
    apiKeyCompany: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.authorized === false ? null : { apiKeyId: API_KEY_ID }),
    },
    fiscalIdempotencyKey: {
      findMany: jest.fn().mockResolvedValue(options.reservations ?? [makeReservation()]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    fiscalDocument: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
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
    requestHash: HASH,
    ...overrides,
  };
}

function errorCode(error: unknown) {
  return (error as { getResponse(): { code?: string } }).getResponse().code;
}

describe('FiscalIdentityLookupService', () => {
  it('finds the existing completed invoice identity without fiscal mutation', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityLookupService(prisma as never);

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
      requestHashVerified: true,
    });

    expect(prisma.fiscalIdempotencyKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, companyId: COMPANY_ID, key: KEY }),
      }),
    );
    expect(prisma.fiscalIdempotencyKey.findMany.mock.calls[0][0].where).not.toHaveProperty(
      'apiKeyId',
    );
    expect(prisma.fiscalIdempotencyKey.create).not.toHaveBeenCalled();
    expect(prisma.fiscalIdempotencyKey.update).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.update).not.toHaveBeenCalled();
    expect(prisma.fiscalSubmission.create).not.toHaveBeenCalled();
  });

  it('remains discoverable after API-key rotation while enforcing current company authorization', async () => {
    const prisma = makePrisma({ reservations: [makeReservation({ apiKeyId: 'old-key-id' })] });
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command({ apiKeyId: 'new-key-id' }))).resolves.toMatchObject({
      fiscalDocumentId: DOCUMENT_ID,
      requestHashVerified: true,
    });
    expect(prisma.apiKeyCompany.findUnique).toHaveBeenCalledWith({
      where: { apiKeyId_companyId: { apiKeyId: 'new-key-id', companyId: COMPANY_ID } },
      select: { apiKeyId: true },
    });
  });

  it('rejects missing read scope before querying a reservation', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command({ scopes: [] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service
      .execute(command({ scopes: [] }))
      .catch((error) => expect(errorCode(error)).toBe('INSUFFICIENT_SCOPE'));
    expect(prisma.apiKeyCompany.findUnique).not.toHaveBeenCalled();
    expect(prisma.fiscalIdempotencyKey.findMany).not.toHaveBeenCalled();
  });

  it('rejects an API key that is not bound to the requested company', async () => {
    const prisma = makePrisma({ authorized: false });
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fiscalIdempotencyKey.findMany).not.toHaveBeenCalled();
  });

  it('returns safe not-found for an unknown key in the caller tenant/company scope', async () => {
    const prisma = makePrisma({ reservations: [] });
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed on duplicate candidate reservations', async () => {
    const prisma = makePrisma({
      reservations: [makeReservation(), makeReservation({ id: 'other' })],
    });
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command())).rejects.toBeInstanceOf(ConflictException);
    await service
      .execute(command())
      .catch((error) => expect(errorCode(error)).toBe('FISCAL_IDENTITY_AMBIGUOUS'));
  });

  it('fails closed when the original request hash does not match', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command({ requestHash: 'b'.repeat(64) }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    [
      'wrong environment',
      makeReservation({ fiscalDocument: makeDocument({ environment: 'PRODUCTION' }) }),
    ],
    ['wrong document type', makeReservation({ fiscalDocument: makeDocument({ type: 'TICKET' }) })],
    ['missing fiscal document', makeReservation({ fiscalDocument: null })],
    ['reservation without document id', makeReservation({ fiscalDocumentId: null })],
    [
      'different request hash on document',
      makeReservation({ fiscalDocument: makeDocument({ requestHash: 'c'.repeat(64) }) }),
    ],
  ])('fails closed on %s integrity inconsistency', async (_label, reservation) => {
    const prisma = makePrisma({ reservations: [reservation] });
    const service = new FiscalIdentityLookupService(prisma as never);

    await expect(service.execute(command())).rejects.toBeInstanceOf(ConflictException);
    await service
      .execute(command())
      .catch((error) => expect(errorCode(error)).toBe('FISCAL_IDENTITY_INTEGRITY_ERROR'));
  });

  it('has stable concurrent read behavior without writes', async () => {
    const prisma = makePrisma();
    const service = new FiscalIdentityLookupService(prisma as never);

    const results = await Promise.all(Array.from({ length: 8 }, () => service.execute(command())));

    expect(results).toHaveLength(8);
    expect(results.every((result) => result.fiscalDocumentId === DOCUMENT_ID)).toBe(true);
    expect(prisma.fiscalIdempotencyKey.create).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
  });
});
