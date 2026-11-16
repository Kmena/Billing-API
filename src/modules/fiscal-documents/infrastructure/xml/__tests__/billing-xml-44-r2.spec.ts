import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';
import { NodeXadesEpesSignerAdapter } from '../../../../../infrastructure/signing/adapters/node-xades-epes-signer.adapter';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

jest.setTimeout(30000);
const serializer = new HaciendaV44XmlSerializerAdapter();
const validator = new Xsd11ValidatorAdapter({ timeoutMs: 30000 });
const signer = new NodeXadesEpesSignerAdapter();

function line(lineNumber: number, period: string, rateCode: '10' | '01' | '08') {
  const tax = rateCode === '08' ? '1300.00000' : '0.00000';
  return {
    lineNumber,
    cabysCode: '8313100000100',
    description: `Afiliación ${period}`,
    unitMeasure: 'Sp',
    quantity: '1',
    unitPrice: '10000.00000',
    taxAmount: tax,
    taxCode: '01',
    taxRateCode: rateCode,
    taxRate: rateCode === '08' ? '13' : '0',
  };
}

async function verify(
  type: 'INVOICE' | 'TICKET',
  lines: ReturnType<typeof line>[],
  credit = false,
) {
  const generated = serializer.serialize({
    ...createFiscalXmlSnapshot(type),
    lines,
    saleCondition: credit ? '02' : '01',
    creditTermDays: credit ? 30 : null,
    paymentMethod: credit ? null : '01',
  });
  const before = validator.validateUnsignedStructure(generated);
  const signed = await signer.sign(generated.xml, createTestSigningMaterial().certificate);
  const after = validator.validate({ ...generated, xml: signed });
  const signature = await signer.verify(signed);
  expect(signed.replace(/<ds:Signature\b[\s\S]*?<\/ds:Signature>/, '')).toBe(generated.xml);
  return { generated, before, after, signature };
}

describe('BILLING-XML-44-R2 — two-level fiscal validation', () => {
  it.each(['INVOICE', 'TICKET'] as const)(
    '%s validates exempt, zero-rated, 13% and mixed lines',
    async (type) => {
      for (const rates of [['10'], ['01'], ['08'], ['10', '01', '08']] as const) {
        const lines = rates.map((rate, index) =>
          line(index + 1, index === 0 ? 'enero 2026' : 'febrero 2026', rate),
        );
        const result = await verify(type, lines);
        expect(result.before.isValid).toBe(true);
        expect(result.after.isValid).toBe(true);
        expect(result.signature.isValid).toBe(true);
        expect(result.generated.xml.match(/<LineaDetalle>/g) ?? []).toHaveLength(lines.length);
      }
    },
  );

  it('retains two distinct periods and correct CRC total for a credit invoice', async () => {
    const result = await verify(
      'INVOICE',
      [line(1, 'enero 2026', '10'), line(2, 'febrero 2026', '10')],
      true,
    );
    expect(result.before.isValid).toBe(true);
    expect(result.after.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
    expect(result.generated.xml).toContain(
      '<CondicionVenta>02</CondicionVenta><PlazoCredito>30</PlazoCredito>',
    );
    expect(result.generated.xml).toContain('<TotalComprobante>20000.00000</TotalComprobante>');
    expect(result.generated.xml).not.toContain('marzo 2026');
  });
});
