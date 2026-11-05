import {
  projectW2BInvoiceLab,
  projectW2BTicketLab,
  W2BLabProjectionError,
} from '../w2-b-lab-projection';
import { W2AStructuralValidationError } from '../w2-a-structural-intent';
import { HaciendaV44XmlSerializerAdapter } from '../../fiscal-documents/infrastructure/xml/hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../../fiscal-documents/infrastructure/xml/xsd11-validator.adapter';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { NodeXadesEpesSignerAdapter } from '../../../infrastructure/signing/adapters/node-xades-epes-signer.adapter';
import {
  evaluateConsumerV2Replay,
  evaluateConsumerV2Lookup,
} from '../../fiscal-consumers/domain/consumer-v2-idempotency.policy';

const origin = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  consumerId: '22222222-2222-4222-8222-222222222222',
  associationId: '33333333-3333-4333-8333-333333333333',
  companyId: '44444444-4444-4444-8444-444444444444',
  environment: 'SANDBOX' as const,
};

function line(lineNumber = 1, taxTreatment = 'LAB_TAXABLE_IVA_13_XML') {
  const exempt = taxTreatment === 'LAB_EXEMPT_XML';
  return {
    lineNumber,
    source: { periodId: `2026-0${lineNumber}`, allocationId: `allocation-${lineNumber}` },
    description: `Servicio sintético ${lineNumber}`,
    cabysCode: '8313100000100',
    unitCode: 'Sp',
    quantity: '1.000',
    unitPrice: '1000.00000',
    priceInputMode: 'EXCLUSIVE',
    discounts: [] as Array<{ amount: string; reasonCode: string; reason: string }>,
    taxTreatment,
    taxes: [
      {
        code: '01',
        rateCode: exempt ? '10' : '08',
        rate: exempt ? '0' : '13',
        base: '1000',
        amount: exempt ? '0' : '130',
      },
    ],
  };
}

function intent(lines = [line()]) {
  const amount = lines.reduce(
    (sum, item) =>
      sum +
      Number(item.unitPrice) -
      item.discounts.reduce((value, discount) => value + Number(discount.amount), 0) +
      Number(item.taxes[0].amount),
    0,
  );
  return {
    externalOperationId: 'synthetic-operation',
    policyVersion: 'LAB_SYNTHETIC_V44_ONLY',
    receiver: {
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      name: 'Receptor sintético',
      email: 'receiver@example.com',
    },
    currency: 'CRC',
    saleCondition: '01',
    paymentMethods: [{ code: '01', amount: String(amount) }],
    lines,
  };
}

function expectProjectionError(raw: unknown, code: string) {
  try {
    projectW2BInvoiceLab(raw, origin);
    throw new Error('Expected projection rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(W2BLabProjectionError);
    expect(error).toMatchObject({ code });
  }
}

describe('W2-B synthetic FE projection (unregistered)', () => {
  const serializer = new HaciendaV44XmlSerializerAdapter();
  const validator = new Xsd11ValidatorAdapter();
  const signer = new NodeXadesEpesSignerAdapter();
  const signingMaterial = createTestSigningMaterial();

  it('keeps FE receiver required while TE omits it and uses a distinct hash namespace', () => {
    const { receiver: _receiver, ...withoutReceiver } = intent();
    expect(() => projectW2BInvoiceLab(withoutReceiver, origin)).toThrow(
      W2AStructuralValidationError,
    );
    const ticket = projectW2BTicketLab(withoutReceiver, origin);
    expect(ticket.intent.receiver).toBeUndefined();
    expect(ticket.hashVersion).toBe('w2-b-ticket-fiscal-lab.v1');
    expect(ticket.requestHash).not.toBe(projectW2BInvoiceLab(intent(), origin).requestHash);
    expect(ticket.totals.totalAmount).toBe('1130.00000');
  });

  it('accepts SINPE Móvil code 06 and validates the signed synthetic XML', async () => {
    const sinpe = intent();
    sinpe.paymentMethods[0].code = '06';
    const result = projectW2BInvoiceLab(sinpe, origin);
    expect(result.intent.paymentMethods[0].code).toBe('06');
    const xml = serializer.serialize({ ...createFiscalXmlSnapshot(), paymentMethod: '06',
      lines: result.lines, totals: result.totals });
    const signed = await signer.sign(xml.xml, signingMaterial.certificate);
    expect(validator.validate({ ...xml, xml: signed }).isValid).toBe(true);
  });

  it.each([
    ['single taxed', [line()]],
    ['two taxed', [line(2), line(1)]],
    ['single exempt XML representation', [line(1, 'LAB_EXEMPT_XML')]],
    ['mixed XML representation', [line(1, 'LAB_EXEMPT_XML'), line(2)]],
  ])('%s projects exact totals and validates official FE XSD', async (_, lines) => {
    const projection = projectW2BInvoiceLab(intent(lines), origin);
    expect(projection.lines.map((item) => item.lineNumber)).toEqual(
      lines.length === 2 ? [1, 2] : [1],
    );
    const xml = serializer.serialize({
      ...createFiscalXmlSnapshot(),
      lines: projection.lines,
      totals: projection.totals,
    });
    const signed = await signer.sign(xml.xml, signingMaterial.certificate);
    const validation = validator.validate({ ...xml, xml: signed });
    expect(validation.errors).toEqual([]);
    expect(validation.isValid).toBe(true);
    expect(xml.xml.match(/<LineaDetalle>/g)).toHaveLength(lines.length);
    expect(xml.xml).not.toContain('allocation-');
  });

  it('preserves distinct opaque sources in the hash without emitting them in XML', () => {
    const first = projectW2BInvoiceLab(intent([line(2), line(1)]), origin);
    const second = projectW2BInvoiceLab(intent([line(1), line(2)]), origin);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.requestHash).toMatchSnapshot('two-line-laboratory-hash');
    expect(first.hashVersion).toBe('w2-b-fiscal-lab.v1');
    const changed = intent([line(1), line(2)]);
    changed.lines[0].source.periodId = 'changed-period';
    expect(projectW2BInvoiceLab(changed, origin).requestHash).not.toBe(first.requestHash);
    expect(
      projectW2BInvoiceLab(intent([line()]), { ...origin, associationId: origin.consumerId })
        .requestHash,
    ).not.toBe(projectW2BInvoiceLab(intent([line()]), origin).requestHash);
  });

  it('supports one exact line discount with tax on net base', async () => {
    const discounted = line();
    discounted.discounts = [{ amount: '100', reasonCode: '07', reason: 'Descuento comercial' }];
    discounted.taxes[0].base = '900';
    discounted.taxes[0].amount = '117';
    const result = projectW2BInvoiceLab(intent([discounted]), origin);
    expect(result.totals).toEqual({
      grossAmount: '1000.00000',
      discountAmount: '100.00000',
      taxAmount: '117.00000',
      totalAmount: '1017.00000',
    });
    const xml = serializer.serialize({
      ...createFiscalXmlSnapshot(),
      lines: result.lines,
      totals: result.totals,
    });
    const signed = await signer.sign(xml.xml, signingMaterial.certificate);
    expect(validator.validate({ ...xml, xml: signed }).isValid).toBe(true);
    expect(xml.xml).toContain('<MontoDescuento>100.00000</MontoDescuento>');
  });

  it('signs and verifies a synthetic projected XML without Hacienda submission', async () => {
    const projection = projectW2BInvoiceLab(intent(), origin);
    const xml = serializer.serialize({
      ...createFiscalXmlSnapshot(),
      lines: projection.lines,
      totals: projection.totals,
    });
    const signed = await signer.sign(xml.xml, signingMaterial.certificate);
    expect((await signer.verify(signed)).isValid).toBe(true);
    expect(validator.validate({ ...xml, xml: signed }).isValid).toBe(true);
  });

  it('rejects unapproved policies, environments and fiscal combinations', () => {
    expect(() => projectW2BInvoiceLab(intent(), { ...origin, environment: 'PRODUCTION' })).toThrow(
      W2BLabProjectionError,
    );
    expectProjectionError({ ...intent(), policyVersion: 'real-company' }, 'W2B_TAX_POLICY_PENDING');
    const multiple = line();
    multiple.taxes.push({ ...multiple.taxes[0] });
    expectProjectionError(intent([multiple]), 'W2B_ENGINE_COMBINATION_UNSUPPORTED');
    const discounts = line();
    discounts.discounts = [
      { amount: '10', reasonCode: '07', reason: 'Descuento comercial' },
      { amount: '10', reasonCode: '07', reason: 'Descuento comercial' },
    ];
    expectProjectionError(intent([discounts]), 'W2B_ENGINE_COMBINATION_UNSUPPORTED');
  });

  it('rejects precision loss, tax mismatch and unbalanced payments', () => {
    const precision = line();
    precision.quantity = '1.0001';
    expectProjectionError(intent([precision]), 'W2B_ENGINE_PRECISION_UNSUPPORTED');
    const mismatch = line();
    mismatch.taxes[0].amount = '129';
    expectProjectionError(intent([mismatch]), 'W2B_TAX_AMOUNT_MISMATCH');
    const payment = intent();
    payment.paymentMethods[0].amount = '999';
    expectProjectionError(payment, 'W2B_PAYMENT_TOTAL_MISMATCH');
  });

  it('uses W1 replay semantics for exact, conflicting and recovery hashes', () => {
    const projected = projectW2BInvoiceLab(intent(), origin);
    const query = {
      associationId: origin.associationId,
      environment: origin.environment,
      operation: 'CREATE_INVOICE' as const,
      idempotencyKey: 'synthetic-key',
      requestHashVersion: projected.hashVersion,
      requestHash: projected.requestHash,
    };
    const reservation = { ...query, state: 'RECOVERY_REQUIRED' as const, fiscalDocumentId: null };
    expect(evaluateConsumerV2Replay(query, null)).toBe('NEW');
    expect(evaluateConsumerV2Replay(query, reservation)).toBe('SAME');
    expect(evaluateConsumerV2Lookup({ query, reservation, retryAfterSeconds: 3 })).toMatchObject({
      status: 202,
      state: 'RECOVERY_REQUIRED',
    });
    expect(evaluateConsumerV2Replay({ ...query, requestHash: 'a'.repeat(64) }, reservation)).toBe(
      'CONFLICT',
    );
    expect(
      evaluateConsumerV2Lookup({
        query: { ...query, requestHash: 'a'.repeat(64) },
        reservation,
        retryAfterSeconds: 3,
      }),
    ).toMatchObject({ status: 404 });
    expect(
      evaluateConsumerV2Replay({ ...query, associationId: origin.consumerId }, reservation),
    ).toBe('NEW');
  });
});
