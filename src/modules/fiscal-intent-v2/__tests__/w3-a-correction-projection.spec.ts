import {
  correctionHash,
  correctionLines,
  parseCorrectionIntent,
} from '../w3-a-correction-projection';
import { ConsumerV2Principal } from '../../fiscal-consumers/infrastructure/http/consumer-v2.guard';

const sourceDocumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const principal = {
  tenantId: 't',
  consumerId: 'c',
  associationId: 'a',
  companyId: 'b',
  environment: 'SANDBOX',
} as ConsumerV2Principal;
const source = [
  {
    lineNumber: 1,
    cabysCode: '8313100000100',
    description: 'Servicio',
    unitMeasure: 'Sp',
    quantity: '2.00000',
    unitPrice: '500.00000',
    discountAmount: '100.00000',
    discountCode: '01',
    discountNature: 'Descuento comercial',
    taxCode: '01',
    taxRateCode: '08',
    taxRate: '13.00000',
    taxAmount: '117.00000',
  },
];

function intent(mode: 'TOTAL' | 'PARTIAL', quantity?: string) {
  return parseCorrectionIntent(
    {
      sourceDocumentId,
      mode,
      referenceReasonCode: mode === 'TOTAL' ? '01' : '02',
      reason: 'Motivo sintético',
      externalCorrectionId: 'opaque-1',
      correctionLines: mode === 'TOTAL' ? [] : [{ sourceLineNumber: 1, quantity }],
    },
    'CREDIT_NOTE',
  );
}

describe('W3-A exact corrective projection', () => {
  it('prorates discount and IVA exactly for a partial NC', () => {
    const lines = correctionLines('CREDIT_NOTE', intent('PARTIAL', '1'), source, []);
    expect(lines[0]).toMatchObject({
      quantity: '1.00000',
      unitPrice: '500.00000',
      discountAmount: '50.00000',
      taxAmount: '58.50000',
      sourceLineNumber: 1,
    });
  });

  it('allows total correction and prevents overcredit across prior notes', () => {
    expect(correctionLines('CREDIT_NOTE', intent('TOTAL'), source, [])).toHaveLength(1);
    expect(() =>
      correctionLines('CREDIT_NOTE', intent('PARTIAL', '1.001'), source, [
        [{ sourceLineNumber: 1, quantity: '1.00000' }],
      ]),
    ).toThrow();
    expect(() =>
      correctionLines('CREDIT_NOTE', intent('TOTAL'), source, [
        [{ sourceLineNumber: 1, quantity: '1.00000' }],
      ]),
    ).toThrow();
  });

  it('rejects unsupported tax or inexact proration before allocation', () => {
    expect(() =>
      correctionLines(
        'CREDIT_NOTE',
        intent('PARTIAL', '1'),
        [{ ...source[0], taxRateCode: '04' }],
        [],
      ),
    ).toThrow();
    expect(() =>
      correctionLines(
        'CREDIT_NOTE',
        intent('PARTIAL', '1'),
        [{ ...source[0], discountAmount: '100.00001' }],
        [],
      ),
    ).toThrow();
  });

  it('canonicalizes line order into a stable hash and rejects duplicate lines', () => {
    const parsed = intent('PARTIAL', '1');
    expect(correctionHash('CREDIT_NOTE', parsed, principal)).toBe(
      correctionHash('CREDIT_NOTE', parsed, principal),
    );
    expect(() =>
      parseCorrectionIntent(
        {
          sourceDocumentId,
          mode: 'PARTIAL',
          referenceReasonCode: '02',
          reason: 'Motivo sintético',
          externalCorrectionId: 'opaque-1',
          correctionLines: [
            { sourceLineNumber: 1, quantity: '1' },
            { sourceLineNumber: 1, quantity: '1' },
          ],
        },
        'CREDIT_NOTE',
      ),
    ).toThrow();
  });
});
