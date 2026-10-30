import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FiscalDocumentService,
  type CreateFiscalDocumentCommand,
} from '../fiscal-document.service';
import {
  canonicalFiscalPayloadHash,
  canonicalFiscalPayloadString,
  FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
  fiscalPayloadInputFromCommand,
} from '../fiscal-payload-equivalence';

const root = process.cwd();
const fixture = JSON.parse(
  readFileSync(
    join(
      root,
      'docs',
      'contracts',
      'fixtures',
      'fiscal-payload-equivalence.v1',
      'inv-966-historical-sanitized.json',
    ),
    'utf8',
  ),
) as { canonicalInput: Record<string, unknown>; expectedSha256: string };
type CanonicalFixture = Record<string, unknown> & {
  receiver: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
};
type FiscalServiceInternals = {
  validateCreateCommand(command: unknown): void;
  hashRequest(command: unknown): string;
};

describe('fiscal payload equivalence v1', () => {
  it('matches the shared sanitized INV-966 historical vector exactly', () => {
    expect(canonicalFiscalPayloadHash(fixture.canonicalInput as never)).toBe(
      fixture.expectedSha256,
    );
  });

  it('uses deterministic object ordering, decimal normalization, null normalization, and UTC dates', () => {
    const base = fixture.canonicalInput as CanonicalFixture;
    const alternative = {
      ...base,
      receiver: {
        name: base.receiver.name,
        createdAt: '2026-10-08T12:00:00-06:00',
        email: base.receiver.email,
        identificationNumber: base.receiver.identificationNumber,
        identificationType: base.receiver.identificationType,
      },
      lines: [
        {
          ...base.lines[0],
          quantity: '1.00000',
          unitPrice: '20000',
          discountAmount: undefined,
          taxAmount: '2600.00000',
          taxRate: '13.00000',
        },
      ],
    };
    const withCanonicalDate = {
      ...alternative,
      receiver: { ...alternative.receiver, createdAt: '2026-10-08T18:00:00.000Z' },
    };

    expect(canonicalFiscalPayloadString(alternative as never)).toBe(
      canonicalFiscalPayloadString(withCanonicalDate as never),
    );
    expect(canonicalFiscalPayloadString(alternative as never)).toContain(
      FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
    );
  });

  it('binds optional affiliation transaction type without changing legacy hashes', () => {
    const base = fixture.canonicalInput as CanonicalFixture;
    expect(canonicalFiscalPayloadHash(base as never)).toBe(fixture.expectedSha256);
    const affiliation = {
      ...base,
      lines: [{ ...base.lines[0], transactionType: '07' }],
    };
    expect(canonicalFiscalPayloadHash(affiliation as never)).not.toBe(fixture.expectedSha256);
    expect(canonicalFiscalPayloadString(affiliation as never)).toContain('"transactionType":"07"');
  });

  it('accepts explicit exempt affiliation and rejects inconsistent tax metadata', () => {
    const service = new FiscalDocumentService({} as never, {} as never);
    const internals = service as unknown as FiscalServiceInternals;
    const base = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      companyId: '22222222-2222-4222-8222-222222222222',
      environment: 'SANDBOX' as const,
      type: 'INVOICE' as const,
      apiKeyId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'synthetic-exempt-affiliation',
      receiver: {
        name: 'Synthetic Receiver',
        identificationType: 'JURIDICA',
        identificationNumber: '3101000001',
        email: 'receiver@example.test',
      },
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Synthetic exempt affiliation',
          unitMeasure: 'Sp',
          transactionType: '07',
          quantity: '1',
          unitPrice: '1000',
          taxAmount: '0',
          taxCode: '01',
          taxRateCode: '10',
          taxRate: '0',
        },
      ],
    };
    expect(() => internals.validateCreateCommand(base)).not.toThrow();
    expect(() =>
      internals.validateCreateCommand({
        ...base,
        lines: [{ ...base.lines[0], taxRateCode: '08' }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      internals.validateCreateCommand({
        ...base,
        lines: [{ ...base.lines[0], taxCode: undefined }],
      }),
    ).toThrow(BadRequestException);
  });

  it('preserves fiscal line order as evidence', () => {
    const base = fixture.canonicalInput as CanonicalFixture;
    const twoLines = {
      ...base,
      lines: [base.lines[0], { ...base.lines[0], lineNumber: 2, description: 'Second line' }],
    };
    const reversed = { ...twoLines, lines: [...twoLines.lines].reverse() };

    expect(canonicalFiscalPayloadHash(twoLines as never)).not.toBe(
      canonicalFiscalPayloadHash(reversed as never),
    );
  });
  it('validates opt-in future headers while preserving Billing internal idempotency hashing', () => {
    const command: CreateFiscalDocumentCommand = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      companyId: '22222222-2222-4222-8222-222222222222',
      environment: 'SANDBOX',
      type: 'INVOICE',
      apiKeyId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'future-canonical-payload',
      receiver: {
        name: 'Receiver SA',
        identificationType: 'JURIDICA',
        identificationNumber: '3101000001',
        email: 'receiver@example.test',
      },
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [
        {
          lineNumber: 1,
          cabysCode: '1234567890123',
          description: 'Fiscal service',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };
    const service = new FiscalDocumentService({} as never, {} as never);
    const internals = service as unknown as FiscalServiceInternals;
    const canonicalHash = canonicalFiscalPayloadHash(fiscalPayloadInputFromCommand(command));
    const withHeaders = {
      ...command,
      fiscalPayloadEquivalence: {
        contractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
        hash: canonicalHash,
      },
    };

    expect(() => internals.validateCreateCommand(withHeaders)).not.toThrow();
    expect(internals.hashRequest(withHeaders)).toBe(internals.hashRequest(command));
    expect(() =>
      internals.validateCreateCommand({
        ...withHeaders,
        fiscalPayloadEquivalence: {
          contractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
          hash: 'a'.repeat(64),
        },
      }),
    ).toThrow(BadRequestException);
  });
});
