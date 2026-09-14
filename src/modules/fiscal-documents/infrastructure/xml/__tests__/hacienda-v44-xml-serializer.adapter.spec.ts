import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { createFiscalXmlSnapshot } from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

describe('HaciendaV44XmlSerializerAdapter', () => {
  const serializer = new HaciendaV44XmlSerializerAdapter();

  it('generates deterministic FE XML with the official namespace and element order', () => {
    const snapshot = createFiscalXmlSnapshot('INVOICE');
    const first = serializer.serialize(snapshot);
    const second = serializer.serialize(snapshot);

    expect(first.xml).toBe(second.xml);
    expect(first.rootElement).toBe('FacturaElectronica');
    expect(first.xml).toContain(
      'xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"',
    );
    expect(first.xml.indexOf('<Clave>')).toBeLessThan(first.xml.indexOf('<ProveedorSistemas>'));
    expect(first.xml.indexOf('<ProveedorSistemas>')).toBeLessThan(
      first.xml.indexOf('<CodigoActividadEmisor>'),
    );
    expect(first.xml.indexOf('<CodigoActividadEmisor>')).toBeLessThan(
      first.xml.indexOf('<NumeroConsecutivo>'),
    );
    expect(first.xml.indexOf('<NumeroConsecutivo>')).toBeLessThan(
      first.xml.indexOf('<FechaEmision>'),
    );
    expect(first.xml.indexOf('<Emisor>')).toBeLessThan(first.xml.indexOf('<Receptor>'));
    expect(first.xml).toContain('<CodigoCABYS>1234567890123</CodigoCABYS>');
    expect(first.xml).toContain('<Tipo>02</Tipo>');
    expect(first.xml).toContain('<Cantidad>1.000</Cantidad>');
    expect(first.xml).toContain('<FechaEmision>2026-09-12T04:20:30-06:00</FechaEmision>');
    expect(first.xml).toContain('<ProveedorSistemas>3101234567</ProveedorSistemas>');
    expect(first.xml).toContain('<Codigo>01</Codigo>');
    expect(first.xml).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    expect(first.xml).toContain('<Tarifa>13.00000</Tarifa>');
    expect(first.xml).toContain('<TotalComprobante>1130.00000</TotalComprobante>');
    expect(first.xml).not.toContain('<ds:Signature');
  });

  it('generates deterministic TE XML without requiring a receiver', () => {
    const snapshot = createFiscalXmlSnapshot('TICKET');
    const result = serializer.serialize(snapshot);
    const repeated = serializer.serialize(snapshot);

    expect(result.xml).toBe(repeated.xml);
    expect(result.rootElement).toBe('TiqueteElectronico');
    expect(result.xml).toContain(
      'xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico"',
    );
    expect(result.xml).not.toContain('<Receptor>');
    expect(result.xml).not.toContain('<ds:Signature');
  });

  it('escapes XML-sensitive fiscal snapshot text', () => {
    const result = serializer.serialize({
      ...createFiscalXmlSnapshot('INVOICE'),
      issuerSnapshot: {
        ...createFiscalXmlSnapshot('INVOICE').issuerSnapshot,
        legalName: 'Issuer & Test <Legal>',
      },
      lines: [
        {
          lineNumber: 1,
          cabysCode: '1234567890123',
          description: 'Servicio & soporte <fiscal>',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
        },
      ],
    });

    expect(result.xml).toContain('<Nombre>Issuer &amp; Test &lt;Legal&gt;</Nombre>');
    expect(result.xml).toContain('<Detalle>Servicio &amp; soporte &lt;fiscal&gt;</Detalle>');
  });

  it('fails unsupported catalogs before signing', () => {
    expect(() =>
      serializer.serialize({ ...createFiscalXmlSnapshot('INVOICE'), paymentMethod: '98' }),
    ).toThrow('FISCAL_XML_UNSUPPORTED_CATALOG:paymentMethod');

    expect(() =>
      serializer.serialize({
        ...createFiscalXmlSnapshot('INVOICE'),
        receiverSnapshot: {
          ...createFiscalXmlSnapshot('INVOICE').receiverSnapshot,
          identificationType: 'UNKNOWN',
        },
      }),
    ).toThrow('FISCAL_XML_UNSUPPORTED_CATALOG:identificationType');
  });

  it('rejects missing tax metadata and unsupported discount conditionals instead of fabricating metadata', () => {
    const baseSnapshot = createFiscalXmlSnapshot('INVOICE');
    const baseLine = (baseSnapshot.lines as Array<Record<string, unknown>>)[0];
    const baseTotals = baseSnapshot.totals as Record<string, unknown>;

    expect(() =>
      serializer.serialize({
        ...baseSnapshot,
        lines: [
          {
            ...baseLine,
            taxAmount: '130.00000',
            taxCode: undefined,
            taxRateCode: undefined,
            taxRate: undefined,
          },
        ],
        totals: {
          ...baseTotals,
          taxAmount: '130.00000',
          totalAmount: '1130.00000',
        },
      }),
    ).toThrow('FISCAL_XML_TAX_METADATA_REQUIRED');

    expect(() =>
      serializer.serialize({
        ...baseSnapshot,
        lines: [
          {
            ...baseLine,
            discountAmount: '100.00000',
          },
        ],
        totals: {
          ...baseTotals,
          discountAmount: '100.00000',
          totalAmount: '900.00000',
        },
      }),
    ).toThrow('FISCAL_XML_UNSUPPORTED_CONDITIONAL:discount');
  });

  it('fails when official XML-required issuer snapshot fields are absent', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      issuerSnapshot: {
        legalName: 'Issuer',
        identificationType: 'JURIDICA',
        identificationNumber: '3101000000',
      },
    };

    expect(() => serializer.serialize(snapshot)).toThrow('FISCAL_XML_PARTY_FIELD_REQUIRED');
  });
});
