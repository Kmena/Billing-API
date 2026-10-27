import {
  normalizeW2AInvoiceIntent,
  prepareW2AStructuralHash,
  W2AStructuralValidationError,
  w2AStructuralErrorBody,
} from '../w2-a-structural-intent';

const origin = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  consumerId: '22222222-2222-4222-8222-222222222222',
  associationId: '33333333-3333-4333-8333-333333333333',
  companyId: '44444444-4444-4444-8444-444444444444',
  environment: 'SANDBOX' as const,
};

function syntheticIntent() {
  return {
    externalOperationId: 'allocation-001',
    policyVersion: 'TEST_POLICY_ONLY',
    receiver: {
      identificationType: 'TEST_TYPE',
      identificationNumber: 'synthetic-123',
      name: 'Receptor sintético',
    },
    currency: 'CRC',
    exchangeRate: null,
    saleCondition: 'TEST_CONDITION',
    paymentMethods: [{ code: 'TEST_METHOD', amount: '2375.00000' }],
    lines: [
      {
        lineNumber: 2,
        source: { affiliationId: 'aff-1', periodId: '2026-10', allocationId: 'alloc-2' },
        servicePeriod: { startsOn: '2026-10-01', endsOn: '2026-10-31' },
        description: 'Concepto de octubre',
        cabysCode: 'TEST_CABYS',
        unitCode: 'TEST_UNIT',
        quantity: '1.00000',
        unitPrice: '500.00000',
        priceInputMode: 'EXCLUSIVE',
        discounts: [],
        taxTreatment: 'TEST_TREATMENT',
        taxes: [
          {
            code: 'TEST_TAX',
            rateCode: 'TEST_RATE',
            rate: '5.00',
            base: '500',
            amount: '25.00000',
          },
        ],
      },
      {
        lineNumber: 1,
        source: { affiliationId: 'aff-1', periodId: '2026-09', paymentId: 'payment-1' },
        servicePeriod: { startsOn: '2026-09-01', endsOn: '2026-09-30' },
        description: 'Concepto de septiembre',
        cabysCode: 'TEST_CABYS',
        unitCode: 'TEST_UNIT',
        quantity: '2.00000',
        unitPrice: '1000.00000',
        priceInputMode: 'EXCLUSIVE',
        discounts: [
          { amount: '100.00', reasonCode: 'TEST_DISCOUNT' },
          { amount: '50.00000', reasonCode: 'TEST_DISCOUNT' },
        ],
        taxTreatment: 'TEST_TREATMENT',
        taxes: [],
      },
    ],
  };
}

function expectError(input: unknown, code: string, path: string) {
  try {
    normalizeW2AInvoiceIntent(input);
    throw new Error('Expected structural rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(W2AStructuralValidationError);
    expect(error).toMatchObject({ code, path });
  }
}

describe('W2-A structural intent, with no fiscal issuance', () => {
  it('normalizes two periods and exact declared amounts without tax inference', () => {
    const { intent, structuralTotals } = normalizeW2AInvoiceIntent(syntheticIntent());
    expect(intent.lines.map((line) => line.lineNumber)).toEqual([1, 2]);
    expect(intent.lines.map((line) => line.source?.periodId)).toEqual(['2026-09', '2026-10']);
    expect(intent.lines[0].quantity).toBe('2');
    expect(intent.lines[0].discounts.map((discount) => discount.amount)).toEqual(['100', '50']);
    expect(structuralTotals).toEqual({
      gross: '2500',
      discounts: '150',
      net: '2350',
      declaredTax: '25',
      totalBeforeFiscalPolicy: '2375',
    });
  });

  it('produces a stable candidate hash for equivalent order and decimal spellings', () => {
    const original = syntheticIntent();
    const first = prepareW2AStructuralHash(original, origin);
    const alternate = syntheticIntent();
    alternate.lines.reverse();
    alternate.lines[0].quantity = '02.0000';
    alternate.lines[0].unitPrice = '01000.0';
    const second = prepareW2AStructuralHash(alternate, origin);
    expect(first.hashVersion).toBe('w2-a-structural.v1');
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe('605bb6c5fca164508682be3855be458a212f0658d4255ed296c6f7896f4aac96');
  });

  it('binds candidate hash to trusted origin and opaque provenance', () => {
    const original = syntheticIntent();
    const first = prepareW2AStructuralHash(original, origin);
    expect(
      prepareW2AStructuralHash(original, { ...origin, consumerId: origin.tenantId }).sha256,
    ).not.toBe(first.sha256);
    expect(
      prepareW2AStructuralHash(original, { ...origin, environment: 'PRODUCTION' }).sha256,
    ).not.toBe(first.sha256);
    const changedSource = syntheticIntent();
    changedSource.lines[0].source.periodId = '2026-11';
    const second = prepareW2AStructuralHash(changedSource, origin);
    expect(second.sha256).not.toBe(first.sha256);
    expect(second.structuralTotals).toEqual(first.structuralTotals);
  });

  it('preserves absent versus explicit null and preserves discount order', () => {
    const explicitNull = syntheticIntent();
    const absent = syntheticIntent() as Omit<ReturnType<typeof syntheticIntent>, 'exchangeRate'> & {
      exchangeRate?: null;
    };
    delete absent.exchangeRate;
    expect(prepareW2AStructuralHash(absent, origin).sha256).not.toBe(
      prepareW2AStructuralHash(explicitNull, origin).sha256,
    );
    const reversedDiscounts = syntheticIntent();
    reversedDiscounts.lines[1].discounts.reverse();
    expect(prepareW2AStructuralHash(reversedDiscounts, origin).sha256).not.toBe(
      prepareW2AStructuralHash(explicitNull, origin).sha256,
    );
  });

  it('rejects commercial ledger fields, unknown authority and unresolved exemption shape', () => {
    const withLedger = syntheticIntent() as ReturnType<typeof syntheticIntent> & {
      balance?: string;
    };
    withLedger.balance = '500';
    expectError(withLedger, 'W2A_STRUCTURE_INVALID', 'balance');
    const withAuthority = syntheticIntent() as ReturnType<typeof syntheticIntent> & {
      consumerId?: string;
    };
    withAuthority.consumerId = origin.consumerId;
    expectError(withAuthority, 'W2A_STRUCTURE_INVALID', 'consumerId');
    const nestedLedger = syntheticIntent();
    (nestedLedger.lines[0].source as Record<string, unknown>).balance = '500';
    expectError(nestedLedger, 'W2A_STRUCTURE_INVALID', 'lines.0.source.balance');
    const withExemption = syntheticIntent();
    (withExemption.lines[0].taxes[0] as Record<string, unknown>).exemptionDocument = {};
    expectError(withExemption, 'W2A_STRUCTURE_INVALID', 'lines.0.taxes.0.exemptionDocument');
  });

  it.each(['-1', '1e3', '1.12345678901', '1234567890123456789', 'NaN', 1])(
    'rejects unsupported decimal %s',
    (value) => {
      const input = syntheticIntent();
      (input.lines[0] as { quantity: unknown }).quantity = value;
      expectError(input, 'W2A_STRUCTURE_INVALID', 'lines.0.quantity');
    },
  );

  it('rejects duplicate/zero lines, invalid periods, inclusive prices and over-discounting', () => {
    const duplicate = syntheticIntent();
    duplicate.lines[1].lineNumber = 2;
    expectError(duplicate, 'W2A_DUPLICATE_LINE', 'lines.1.lineNumber');
    const zero = syntheticIntent();
    zero.lines[0].quantity = '0.00000';
    expectError(zero, 'W2A_QUANTITY_NON_POSITIVE', 'lines.0.quantity');
    const badPeriod = syntheticIntent();
    badPeriod.lines[0].servicePeriod.startsOn = '2026-02-30';
    expectError(badPeriod, 'W2A_PERIOD_INVALID', 'lines.0.servicePeriod');
    const inclusive = syntheticIntent();
    inclusive.lines[0].priceInputMode = 'INCLUSIVE';
    expectError(inclusive, 'W2A_PRICE_MODE_PENDING', 'lines.0.priceInputMode');
    const discount = syntheticIntent();
    discount.lines[1].discounts[1].amount = '2000';
    expectError(discount, 'W2A_DISCOUNT_EXCEEDS_GROSS', 'lines.1.discounts.1.amount');
  });

  it('enforces structural cardinalities without claiming fiscal applicability', () => {
    const noLines = syntheticIntent();
    noLines.lines = [];
    expectError(noLines, 'W2A_STRUCTURE_INVALID', 'lines');
    const sixDiscounts = syntheticIntent();
    sixDiscounts.lines[0].discounts = Array.from({ length: 6 }, () => ({
      amount: '0',
      reasonCode: 'TEST',
    }));
    expectError(sixDiscounts, 'W2A_STRUCTURE_INVALID', 'lines.0.discounts');
    const fivePayments = syntheticIntent();
    fivePayments.paymentMethods = Array.from({ length: 5 }, () => ({
      code: 'TEST',
      amount: '1',
    }));
    expectError(fivePayments, 'W2A_STRUCTURE_INVALID', 'paymentMethods');
    const emptySource = syntheticIntent();
    emptySource.lines[0].source = {} as (typeof emptySource.lines)[number]['source'];
    expectError(emptySource, 'W2A_SOURCE_EMPTY', 'lines.0.source');
  });

  it('accepts ten exact decimal places and 1000 lines, then rejects line 1001', () => {
    const exact = syntheticIntent();
    exact.lines[0].quantity = '0.0000000001';
    exact.lines[0].unitPrice = '1.0000000001';
    expect(normalizeW2AInvoiceIntent(exact).structuralTotals.gross).toBe(
      '2000.00000000010000000001',
    );
    const template = syntheticIntent().lines[0];
    const manyLines: unknown[] = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      lineNumber: index + 1,
      source: { ...template.source, periodId: `period-${index + 1}` },
    }));
    expect(
      normalizeW2AInvoiceIntent({ ...syntheticIntent(), lines: manyLines }).intent.lines,
    ).toHaveLength(1000);
    manyLines.push({ ...template, lineNumber: 1000 });
    expectError({ ...syntheticIntent(), lines: manyLines }, 'W2A_STRUCTURE_INVALID', 'lines');
    manyLines[1000] = { ...template, lineNumber: 1001 };
    expectError(
      { ...syntheticIntent(), lines: manyLines },
      'W2A_STRUCTURE_INVALID',
      'lines.1000.lineNumber',
    );
  });

  it('returns a stable error shape without echoing rejected data', () => {
    const body = w2AStructuralErrorBody(
      new W2AStructuralValidationError('W2A_STRUCTURE_INVALID', 'lines.0.taxes.0.code'),
      'correlation-test',
    );
    expect(body).toEqual({
      code: 'W2A_STRUCTURE_INVALID',
      message: 'Invalid fiscal intent structure',
      correlationId: 'correlation-test',
      retryable: false,
      details: { path: 'lines.0.taxes.0.code' },
    });
    expect(JSON.stringify(body)).not.toContain('synthetic-123');
  });
});
