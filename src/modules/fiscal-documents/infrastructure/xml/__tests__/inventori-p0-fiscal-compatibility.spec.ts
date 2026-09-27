import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';
import { createFiscalXmlSnapshot } from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { INVENTORI_P0_UNIT_MAPPING } from '../../../domain/fiscal-catalogs';

const serializer = new HaciendaV44XmlSerializerAdapter();
const validator = new Xsd11ValidatorAdapter();

function line(overrides: Record<string, unknown> = {}) {
  return {
    lineNumber: 1,
    cabysCode: '8313100000100',
    description: 'Servicio fiscal de prueba',
    unitMeasure: 'Sp',
    quantity: '1.00000',
    unitPrice: '1000.00000',
    taxAmount: '130.00000',
    taxCode: '01',
    taxRateCode: '08',
    taxRate: '13.00000',
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    ...createFiscalXmlSnapshot('INVOICE'),
    ...overrides,
  };
}

function expectXsdValid(xml: string): void {
  expect(
    validator.validate({
      documentType: 'INVOICE',
      rootElement: 'FacturaElectronica',
      namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
      schemaVersion: 'v4.4',
      xml: withDummySignature(xml),
    }),
  ).toEqual({ isValid: true, schemaVersion: 'v4.4', errors: [] });
}

function withDummySignature(xml: string): string {
  const signature =
    '<ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI=""><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>YWJjZA==</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>YWJjZA==</ds:SignatureValue></ds:Signature>';
  return xml.replace('</FacturaElectronica>', `${signature}</FacturaElectronica>`);
}

describe('Inventori P0 fiscal compatibility — Hacienda v4.4 XML', () => {
  it('keeps zero-discount behavior unchanged', () => {
    const result = serializer.serialize(invoice());

    expect(result.xml).not.toContain('<Descuento>');
    expect(result.xml).not.toContain('<TotalDescuentos>');
    expect(result.xml).toContain('<TotalVenta>1000.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalVentaNeta>1000.00000</TotalVentaNeta>');
    expect(result.xml).toContain('<TotalComprobante>1130.00000</TotalComprobante>');
    expectXsdValid(result.xml);
  });

  it('serializes one discounted line with CodigoDescuento and NaturalezaDescuento in XSD order', () => {
    const result = serializer.serialize(
      invoice({
        lines: [
          line({
            discountAmount: '100.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial Inventori',
            taxAmount: '117.00000',
          }),
        ],
      }),
    );

    expect(result.xml).toContain('<MontoTotal>1000.00000</MontoTotal>');
    expect(result.xml).toContain('<Descuento>');
    expect(result.xml).toContain('<MontoDescuento>100.00000</MontoDescuento>');
    expect(result.xml).toContain('<CodigoDescuento>07</CodigoDescuento>');
    expect(result.xml).toContain(
      '<NaturalezaDescuento>Descuento comercial Inventori</NaturalezaDescuento>',
    );
    expect(result.xml.indexOf('<Descuento>')).toBeLessThan(result.xml.indexOf('<SubTotal>'));
    expect(result.xml).toContain('<SubTotal>900.00000</SubTotal>');
    expect(result.xml).toContain('<BaseImponible>900.00000</BaseImponible>');
    expect(result.xml).toContain('<TotalVenta>1000.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalDescuentos>100.00000</TotalDescuentos>');
    expect(result.xml).toContain('<TotalVentaNeta>900.00000</TotalVentaNeta>');
    expect(result.xml.indexOf('<TotalDescuentos>')).toBeLessThan(
      result.xml.indexOf('<TotalVentaNeta>'),
    );
    expect(result.xml).toContain('<TotalImpuesto>117.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>1017.00000</TotalComprobante>');
    expectXsdValid(result.xml);
  });

  it('sums multiple discounted lines and mixed discounted/non-discounted lines correctly', () => {
    const result = serializer.serialize(
      invoice({
        lines: [
          line({
            lineNumber: 1,
            discountAmount: '100.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial línea 1',
            taxAmount: '117.00000',
          }),
          line({
            lineNumber: 2,
            quantity: '2.00000',
            unitPrice: '500.00000',
            discountAmount: '50.00000',
            discountCode: '06',
            discountNature: 'Promoción de temporada',
            taxAmount: '123.50000',
          }),
          line({
            lineNumber: 3,
            unitMeasure: 'Unid',
            cabysCode: '4782900000000',
            description: 'Producto sin descuento',
            unitPrice: '250.00000',
            taxAmount: '32.50000',
          }),
        ],
      }),
    );

    expect(result.xml.match(/<Descuento>/g) ?? []).toHaveLength(2);
    expect(result.xml).toContain('<TotalServGravados>2000.00000</TotalServGravados>');
    expect(result.xml).toContain('<TotalMercanciasGravadas>250.00000</TotalMercanciasGravadas>');
    expect(result.xml).toContain('<TotalVenta>2250.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalDescuentos>150.00000</TotalDescuentos>');
    expect(result.xml).toContain('<TotalVentaNeta>2100.00000</TotalVentaNeta>');
    expect(result.xml).toContain('<TotalImpuesto>273.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>2373.00000</TotalComprobante>');
    expectXsdValid(result.xml);
  });

  it('fails closed when a discounted line lacks required discount reason metadata', () => {
    expect(() =>
      serializer.serialize(
        invoice({ lines: [line({ discountAmount: '1.00000', taxAmount: '129.87000' })] }),
      ),
    ).toThrow('FISCAL_XML_DISCOUNT_METADATA_REQUIRED');
  });

  it('serializes credit sale condition 02 with PlazoCredito and without MedioPago', () => {
    const result = serializer.serialize(
      invoice({ saleCondition: '02', creditTermDays: 30, paymentMethod: null }),
    );

    expect(result.xml).toContain(
      '<CondicionVenta>02</CondicionVenta><PlazoCredito>30</PlazoCredito>',
    );
    expect(result.xml).not.toContain('<MedioPago>');
    expectXsdValid(result.xml);
  });

  it.each([
    [
      'normal cash + Unid',
      { saleCondition: '01', paymentMethod: '01', lines: [line({ unitMeasure: 'Unid' })] },
    ],
    [
      'normal cash + Kg',
      { saleCondition: '01', paymentMethod: '01', lines: [line({ unitMeasure: 'Kg' })] },
    ],
    [
      'discount + Unid',
      {
        lines: [
          line({
            unitMeasure: 'Unid',
            discountAmount: '10.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial',
            taxAmount: '128.70000',
          }),
        ],
      },
    ],
    [
      'credit + Kg',
      {
        saleCondition: '02',
        creditTermDays: 45,
        paymentMethod: null,
        lines: [line({ unitMeasure: 'Kg' })],
      },
    ],
    [
      'credit + discount + Kg',
      {
        saleCondition: '02',
        creditTermDays: 45,
        paymentMethod: null,
        lines: [
          line({
            unitMeasure: 'Kg',
            discountAmount: '100.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial',
            taxAmount: '117.00000',
          }),
        ],
      },
    ],
    [
      'mixed units and discounts',
      {
        lines: [
          line({ lineNumber: 1, unitMeasure: 'Unid' }),
          line({ lineNumber: 2, unitMeasure: 'Kg', unitPrice: '500.00000', taxAmount: '65.00000' }),
          line({
            lineNumber: 3,
            unitMeasure: 'mL',
            unitPrice: '100.00000',
            discountAmount: '10.00000',
            discountCode: '06',
            discountNature: 'Promoción Inventori',
            taxAmount: '11.70000',
          }),
        ],
      },
    ],
  ])('is XSD-valid for combination: %s', (_label, overrides) => {
    expectXsdValid(serializer.serialize(invoice(overrides)).xml);
  });

  it('accepts exact canonical Hacienda units required for Inventori P0', () => {
    const units = ['Unid', 'Kg', 'G', 'L', 'mL', 'M', 'Sp'];
    for (const unitMeasure of units) {
      const xml = serializer.serialize(invoice({ lines: [line({ unitMeasure })] })).xml;
      expect(xml).toContain(`<UnidadMedida>${unitMeasure}</UnidadMedida>`);
      expectXsdValid(xml);
    }
  });

  it('rejects unknown or non-canonical unit spelling instead of guessing', () => {
    for (const unitMeasure of ['UN', 'KG', 'kg', 'ML', 'ml', 'MTR']) {
      expect(() => serializer.serialize(invoice({ lines: [line({ unitMeasure })] }))).toThrow(
        'FISCAL_XML_UNSUPPORTED_CATALOG:unitMeasure',
      );
    }
  });

  it('documents the exact Inventori P0 commercial-unit mapping target', () => {
    expect(INVENTORI_P0_UNIT_MAPPING).toEqual({
      UN: 'Unid',
      KG: 'Kg',
      kg: 'Kg',
      G: 'G',
      L: 'L',
      ML: 'mL',
      M: 'M',
      service: 'Sp',
    });
  });
});
