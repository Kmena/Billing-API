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
const exempt = (lineNumber: number, period: string) => ({
  lineNumber,
  cabysCode: '8313100000100',
  description: `Afiliación ${period}`,
  unitMeasure: 'Sp',
  quantity: '1',
  unitPrice: '10000.00000',
  taxAmount: '0.00000',
  taxCode: '01',
  taxRateCode: '10',
  taxRate: '0.00000',
});
const taxed = (lineNumber: number, period: string) => ({
  ...exempt(lineNumber, period),
  taxAmount: '1300.00000',
  taxRateCode: '08',
  taxRate: '13.00000',
});

function invoice(lines: Array<Record<string, unknown>>) {
  return {
    ...createFiscalXmlSnapshot('INVOICE'),
    saleCondition: '02',
    creditTermDays: 30,
    paymentMethod: null,
    lines,
  };
}

async function signedInvoice(lines: Array<Record<string, unknown>>) {
  const generated = serializer.serialize(invoice(lines));
  const unsignedValidation = validator.validate(generated);
  const certificate = createTestSigningMaterial().certificate;
  const signed = await signer.sign(generated.xml, certificate);
  const signedValidation = validator.validate({ ...generated, xml: signed });
  const signature = await signer.verify(signed);
  return { generated, unsignedValidation, signed, signedValidation, signature };
}

describe('BILLING-XML-44-R1 — tax-zero v4.4 serialization', () => {
  it('serializes one exempt line with exact zero tax and a valid signed XSD document', async () => {
    const result = await signedInvoice([exempt(1, 'enero 2026')]);
    expect(result.generated.xml).toContain('<BaseImponible>10000.00000</BaseImponible>');
    expect(result.generated.xml).toContain('<CodigoTarifaIVA>10</CodigoTarifaIVA>');
    expect(result.generated.xml).toContain('<Tarifa>0.00000</Tarifa>');
    expect(result.generated.xml).toContain('<Monto>0.00000</Monto>');
    expect(result.generated.xml).toContain('<TotalServExentos>10000.00000</TotalServExentos>');
    expect(result.generated.xml).not.toContain('<TotalServGravados>');
    expect(result.generated.xml).toContain('<TotalComprobante>10000.00000</TotalComprobante>');
    expect(result.unsignedValidation.errors).toHaveLength(1);
    expect(result.unsignedValidation.errors[0].message).toContain('Signature');
    expect(result.signedValidation.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
  });

  it('preserves January and February as two independent zero-tax lines', async () => {
    const result = await signedInvoice([exempt(1, 'enero 2026'), exempt(2, 'febrero 2026')]);
    expect(result.generated.xml.match(/<LineaDetalle>/g) ?? []).toHaveLength(2);
    expect(result.generated.xml.match(/<BaseImponible>/g) ?? []).toHaveLength(2);
    expect(result.generated.xml).toContain('Afiliación enero 2026');
    expect(result.generated.xml).toContain('Afiliación febrero 2026');
    expect(result.generated.xml).toContain('<TotalComprobante>20000.00000</TotalComprobante>');
    expect(result.signedValidation.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
  });

  it('classifies tariff code 01 as taxable at 0%, separate from exempt code 10', async () => {
    const line = { ...exempt(1, 'enero 2026'), taxRateCode: '01' };
    const result = await signedInvoice([line]);
    expect(result.generated.xml).toContain('<CodigoTarifaIVA>01</CodigoTarifaIVA>');
    expect(result.generated.xml).toContain('<TotalServGravados>10000.00000</TotalServGravados>');
    expect(result.generated.xml).not.toContain('<TotalServExentos>');
    expect(result.signedValidation.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
  });

  it('preserves the existing 13% IVA path', async () => {
    const result = await signedInvoice([taxed(1, 'enero 2026')]);
    expect(result.generated.xml).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    expect(result.generated.xml).toContain('<Monto>1300.00000</Monto>');
    expect(result.generated.xml).toContain('<TotalImpuesto>1300.00000</TotalImpuesto>');
    expect(result.generated.xml).toContain('<TotalComprobante>11300.00000</TotalComprobante>');
    expect(result.signedValidation.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
  });

  it('keeps exempt and 13% lines separate in a mixed invoice', async () => {
    const result = await signedInvoice([exempt(1, 'enero 2026'), taxed(2, 'febrero 2026')]);
    expect(result.generated.xml).toContain('<TotalServExentos>10000.00000</TotalServExentos>');
    expect(result.generated.xml).toContain('<TotalServGravados>10000.00000</TotalServGravados>');
    expect(result.generated.xml).toContain('<TotalImpuesto>1300.00000</TotalImpuesto>');
    expect(result.generated.xml).toContain('<TotalComprobante>21300.00000</TotalComprobante>');
    expect(result.signedValidation.isValid).toBe(true);
    expect(result.signature.isValid).toBe(true);
  });

  it('also preserves the required zero-tax fields in TiqueteElectronico', async () => {
    const generated = serializer.serialize({
      ...createFiscalXmlSnapshot('TICKET'),
      lines: [exempt(1, 'enero 2026')],
    });
    const signed = await signer.sign(generated.xml, createTestSigningMaterial().certificate);
    expect(validator.validate({ ...generated, xml: signed }).isValid).toBe(true);
    expect((await signer.verify(signed)).isValid).toBe(true);
  });

  it('fails closed when zero-tax metadata or a supported treatment is missing', () => {
    const line = exempt(1, 'enero 2026');
    expect(() => serializer.serialize(invoice([{ ...line, taxCode: undefined }]))).toThrow(
      'FISCAL_XML_TAX_METADATA_REQUIRED',
    );
    expect(() => serializer.serialize(invoice([{ ...line, taxRateCode: undefined }]))).toThrow(
      'FISCAL_XML_IVA_RATE_CODE_REQUIRED',
    );
    expect(() => serializer.serialize(invoice([{ ...line, taxRateCode: '11' }]))).toThrow(
      'FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT:11',
    );
  });

  it('rejects invalid tariff codes and inconsistent zero-tax amounts', () => {
    const line = exempt(1, 'enero 2026');
    expect(() => serializer.serialize(invoice([{ ...line, taxRateCode: '99' }]))).toThrow(
      'FISCAL_XML_UNSUPPORTED_TAX_RATE_CODE:99',
    );
    expect(() =>
      serializer.serialize(invoice([{ ...line, taxRateCode: '08', taxRate: '13' }])),
    ).toThrow('FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT');
    expect(() => serializer.serialize(invoice([{ ...line, taxAmount: '1.00000' }]))).toThrow(
      'FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH',
    );
  });

  it('rejects incorrect element order and namespace without weakening the XSD', async () => {
    const result = await signedInvoice([exempt(1, 'enero 2026')]);
    const badOrder = result.signed.replace(
      /(<BaseImponible>[^<]+<\/BaseImponible>)(<Impuesto>[\s\S]*?<\/Impuesto>)/,
      '$2$1',
    );
    expect(validator.validate({ ...result.generated, xml: badOrder }).isValid).toBe(false);
    const badNamespace = result.signed.replace(
      'xml-schemas/v4.4/facturaElectronica',
      'xml-schemas/v4.4/otroDocumento',
    );
    expect(validator.validate({ ...result.generated, xml: badNamespace }).isValid).toBe(false);
  });

  it('detects a fiscal amount changed after signing', async () => {
    const result = await signedInvoice([exempt(1, 'enero 2026')]);
    const tampered = result.signed.replace(
      '<MontoTotalLinea>10000.00000</MontoTotalLinea>',
      '<MontoTotalLinea>10001.00000</MontoTotalLinea>',
    );
    expect((await signer.verify(tampered)).isValid).toBe(false);
  });
});
