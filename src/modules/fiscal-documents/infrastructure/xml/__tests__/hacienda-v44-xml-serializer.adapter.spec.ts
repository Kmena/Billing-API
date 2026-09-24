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
    expect(first.xml).toContain('<CodigoCABYS>8313100000100</CodigoCABYS>');
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
          cabysCode: '8313100000100',
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

  // ── ResumenFactura derivation tests ──────────────────────────────────────────

  it('derives TotalServGravados from SERVICE lines and emits TotalDesgloseImpuesto before TotalImpuesto', () => {
    // CAByS 8313100000100 first digit = 8 → SERVICE
    const snapshot = createFiscalXmlSnapshot('INVOICE');
    const result = serializer.serialize(snapshot);

    expect(result.xml).toContain('<TotalServGravados>1000.00000</TotalServGravados>');
    expect(result.xml).not.toContain('<TotalMercanciasGravadas>');
    expect(result.xml).toContain('<TotalGravado>1000.00000</TotalGravado>');
    expect(result.xml).toContain('<TotalVenta>1000.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalVentaNeta>1000.00000</TotalVentaNeta>');
    expect(result.xml).toContain('<TotalImpuesto>130.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>1130.00000</TotalComprobante>');

    // TotalDesgloseImpuesto must come BEFORE TotalImpuesto (XSD xs:sequence order)
    expect(result.xml).toContain('<TotalDesgloseImpuesto>');
    expect(result.xml.indexOf('<TotalDesgloseImpuesto>')).toBeLessThan(
      result.xml.indexOf('<TotalImpuesto>'),
    );

    // Verify desglose content
    expect(result.xml).toContain('<TotalMontoImpuesto>130.00000</TotalMontoImpuesto>');
  });

  it('derives TotalMercanciasGravadas from GOODS lines (first digit 0–4)', () => {
    // CAByS 4782900000000 first digit = 4 → GOODS
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '4782900000000',
          description: 'Paquete de software',
          unitMeasure: 'Unid',
          quantity: '2.00000',
          unitPrice: '500.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };

    const result = serializer.serialize(snapshot);

    expect(result.xml).toContain('<TotalMercanciasGravadas>1000.00000</TotalMercanciasGravadas>');
    expect(result.xml).not.toContain('<TotalServGravados>');
    expect(result.xml).toContain('<TotalGravado>1000.00000</TotalGravado>');
    expect(result.xml).toContain('<TotalComprobante>1130.00000</TotalComprobante>');
  });

  it('groups multiple taxed lines by (taxCode, taxRateCode) in TotalDesgloseImpuesto', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Consultoría línea 1',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '8313100000100',
          description: 'Consultoría línea 2',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '500.00000',
          taxAmount: '65.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };

    const result = serializer.serialize(snapshot);

    // Single group because both lines share the same (01, 08) key
    const desglosCount = (result.xml.match(/<TotalDesgloseImpuesto>/g) ?? []).length;
    expect(desglosCount).toBe(1);
    expect(result.xml).toContain('<TotalMontoImpuesto>195.00000</TotalMontoImpuesto>');
    expect(result.xml).toContain('<TotalServGravados>1500.00000</TotalServGravados>');
    expect(result.xml).toContain('<TotalImpuesto>195.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>1695.00000</TotalComprobante>');
  });

  it('emits TotalServExentos for SERVICE lines with no tax and omits TotalServGravados', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Servicio exento',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          // No taxAmount — exempt line
        },
      ],
    };

    const result = serializer.serialize(snapshot);

    expect(result.xml).toContain('<TotalServExentos>1000.00000</TotalServExentos>');
    expect(result.xml).not.toContain('<TotalServGravados>');
    expect(result.xml).not.toContain('<TotalDesgloseImpuesto>');
    expect(result.xml).not.toContain('<TotalImpuesto>');
    expect(result.xml).toContain('<TotalExento>1000.00000</TotalExento>');
    expect(result.xml).toContain('<TotalVenta>1000.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalVentaNeta>1000.00000</TotalVentaNeta>');
    expect(result.xml).toContain('<TotalComprobante>1000.00000</TotalComprobante>');
  });

  it('computes correct totals for a mixed SERVICE + GOODS invoice', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100', // SERVICE
          description: 'Consultoría',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '4782900000000', // GOODS
          description: 'Software package',
          unitMeasure: 'Unid',
          quantity: '1.00000',
          unitPrice: '500.00000',
          taxAmount: '65.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };

    const result = serializer.serialize(snapshot);

    expect(result.xml).toContain('<TotalServGravados>1000.00000</TotalServGravados>');
    expect(result.xml).toContain('<TotalMercanciasGravadas>500.00000</TotalMercanciasGravadas>');
    expect(result.xml).toContain('<TotalGravado>1500.00000</TotalGravado>');
    expect(result.xml).toContain('<TotalVenta>1500.00000</TotalVenta>');
    expect(result.xml).toContain('<TotalVentaNeta>1500.00000</TotalVentaNeta>');
    // Both lines share (01, 08) — one desglose group
    expect(result.xml).toContain('<TotalMontoImpuesto>195.00000</TotalMontoImpuesto>');
    expect(result.xml).toContain('<TotalImpuesto>195.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>1695.00000</TotalComprobante>');
  });

  // ─── TotalDesgloseImpuesto: CodigoTarifaIVA conditionality ─────────────────
  //
  // Official rule (Hacienda v4.4):
  //   Codes 01 (IVA) and 07 (IVA cálculo especial): CodigoTarifaIVA REQUIRED.
  //   All other codes: CodigoTarifaIVA MUST NOT be emitted.
  //
  // Grouping key:
  //   IVA codes (01, 07): (Codigo, CodigoTarifaIVA) — distinct rate = distinct element.
  //   Non-IVA codes:      Codigo alone.

  it('emits CodigoTarifaIVA for IVA code 01 in both ImpuestoType and TotalDesgloseImpuesto', () => {
    const snapshot = createFiscalXmlSnapshot('INVOICE');
    const result = serializer.serialize(snapshot);

    // Line-level Impuesto
    expect(result.xml).toContain('<Codigo>01</Codigo>');
    expect(result.xml).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    // Summary TotalDesgloseImpuesto
    expect(result.xml).toContain('<TotalDesgloseImpuesto>');
    expect(result.xml).toContain('<TotalMontoImpuesto>130.00000</TotalMontoImpuesto>');
    // CodigoTarifaIVA is present inside TotalDesgloseImpuesto
    const desgloseStart = result.xml.indexOf('<TotalDesgloseImpuesto>');
    const desgloseEnd = result.xml.indexOf('</TotalDesgloseImpuesto>');
    const desgloseBlock = result.xml.slice(desgloseStart, desgloseEnd);
    expect(desgloseBlock).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
  });

  it('aggregates two lines with same IVA rate into one TotalDesgloseImpuesto entry', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Línea A',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '200.00000',
          taxAmount: '26.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '8313100000100',
          description: 'Línea B',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '300.00000',
          taxAmount: '39.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };
    const result = serializer.serialize(snapshot);
    const groupCount = (result.xml.match(/<TotalDesgloseImpuesto>/g) ?? []).length;
    expect(groupCount).toBe(1);
    expect(result.xml).toContain('<TotalMontoImpuesto>65.00000</TotalMontoImpuesto>');
    expect(result.xml).toContain('<TotalImpuesto>65.00000</TotalImpuesto>');
  });

  it('produces TWO TotalDesgloseImpuesto entries for two different IVA rates (01:08 and 01:04)', () => {
    // Two lines: same Codigo=01 but different CodigoTarifaIVA (13% and 4%)
    // Per v4.4 contract: each (Codigo, CodigoTarifaIVA) combination = separate entry.
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Servicio tasa 13%',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08', // 13%
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '8313100000100',
          description: 'Servicio tasa 4%',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '500.00000',
          taxAmount: '20.00000',
          taxCode: '01',
          taxRateCode: '04', // 4%
          taxRate: '4.00000',
        },
      ],
    };
    const result = serializer.serialize(snapshot);
    const groupCount = (result.xml.match(/<TotalDesgloseImpuesto>/g) ?? []).length;
    expect(groupCount).toBe(2);
    // First group: 01:08 → 130
    expect(result.xml).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    expect(result.xml).toContain('<TotalMontoImpuesto>130.00000</TotalMontoImpuesto>');
    // Second group: 01:04 → 20
    expect(result.xml).toContain('<CodigoTarifaIVA>04</CodigoTarifaIVA>');
    expect(result.xml).toContain('<TotalMontoImpuesto>20.00000</TotalMontoImpuesto>');
    // TotalImpuesto = sum of all groups
    expect(result.xml).toContain('<TotalImpuesto>150.00000</TotalImpuesto>');
  });

  it('supports IVA code 07 (IVA cálculo especial): emits CodigoTarifaIVA correctly', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Servicio cálculo especial',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '07', // IVA cálculo especial
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };
    const result = serializer.serialize(snapshot);
    // ImpuestoType must include CodigoTarifaIVA
    expect(result.xml).toContain('<Codigo>07</Codigo>');
    expect(result.xml).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    // TotalDesgloseImpuesto must include CodigoTarifaIVA
    const desgloseStart = result.xml.indexOf('<TotalDesgloseImpuesto>');
    const desgloseEnd = result.xml.indexOf('</TotalDesgloseImpuesto>');
    const desgloseBlock = result.xml.slice(desgloseStart, desgloseEnd);
    expect(desgloseBlock).toContain('<Codigo>07</Codigo>');
    expect(desgloseBlock).toContain('<CodigoTarifaIVA>08</CodigoTarifaIVA>');
    expect(result.xml).toContain('<TotalMontoImpuesto>130.00000</TotalMontoImpuesto>');
  });

  it('fails closed for non-IVA tax code 02 (Impuesto Selectivo de Consumo)', () => {
    // Code 02 is not supported yet — serializer must fail rather than emit incorrect XML.
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Línea ISC',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '100.00000',
          taxCode: '02', // non-IVA
          taxRateCode: undefined,
          taxRate: undefined,
        },
      ],
    };
    expect(() => serializer.serialize(snapshot)).toThrow('FISCAL_XML_UNSUPPORTED_TAX_CODE:02');
  });

  it('fails closed for IVA code 01 without CodigoTarifaIVA', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Servicio sin tarifa',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: undefined, // missing — IVA requires it
          taxRate: undefined,
        },
      ],
    };
    expect(() => serializer.serialize(snapshot)).toThrow('FISCAL_XML_IVA_RATE_CODE_REQUIRED');
  });

  it('produces two TotalDesgloseImpuesto entries for two different supported tax codes (01 and 07)', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Línea IVA estándar',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '8313100000100',
          description: 'Línea IVA especial',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '500.00000',
          taxAmount: '65.00000',
          taxCode: '07',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };
    const result = serializer.serialize(snapshot);
    // 01:08 and 07:08 are different keys — two entries
    const groupCount = (result.xml.match(/<TotalDesgloseImpuesto>/g) ?? []).length;
    expect(groupCount).toBe(2);
    expect(result.xml).toContain('<TotalImpuesto>195.00000</TotalImpuesto>');
    expect(result.xml).toContain('<TotalComprobante>1695.00000</TotalComprobante>');
  });

  it('sum of TotalMontoImpuesto across all TotalDesgloseImpuesto equals TotalImpuesto', () => {
    // Reconciliation: Σ TotalDesgloseImpuesto.TotalMontoImpuesto = TotalImpuesto
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'L1',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
          taxAmount: '130.00000',
          taxCode: '01',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
        {
          lineNumber: 2,
          cabysCode: '8313100000100',
          description: 'L2',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '500.00000',
          taxAmount: '20.00000',
          taxCode: '01',
          taxRateCode: '04',
          taxRate: '4.00000',
        },
        {
          lineNumber: 3,
          cabysCode: '8313100000100',
          description: 'L3',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '200.00000',
          taxAmount: '26.00000',
          taxCode: '07',
          taxRateCode: '08',
          taxRate: '13.00000',
        },
      ],
    };
    const result = serializer.serialize(snapshot);
    // Groups: 01:08=130, 01:04=20, 07:08=26 → total = 176
    const groupCount = (result.xml.match(/<TotalDesgloseImpuesto>/g) ?? []).length;
    expect(groupCount).toBe(3);
    expect(result.xml).toContain('<TotalImpuesto>176.00000</TotalImpuesto>');
    // Verify each group's TotalMontoImpuesto
    expect(result.xml).toContain('<TotalMontoImpuesto>130.00000</TotalMontoImpuesto>');
    expect(result.xml).toContain('<TotalMontoImpuesto>20.00000</TotalMontoImpuesto>');
    expect(result.xml).toContain('<TotalMontoImpuesto>26.00000</TotalMontoImpuesto>');
    // TotalComprobante = (1000+500+200) + 176 = 1876
    expect(result.xml).toContain('<TotalComprobante>1876.00000</TotalComprobante>');
  });

  it('TotalDesgloseImpuesto precedes TotalImpuesto in ResumenFactura (XSD xs:sequence)', () => {
    const result = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));
    const desglosePos = result.xml.indexOf('<TotalDesgloseImpuesto>');
    const totalImpuestoPos = result.xml.indexOf('<TotalImpuesto>');
    expect(desglosePos).toBeGreaterThan(0);
    expect(totalImpuestoPos).toBeGreaterThan(0);
    expect(desglosePos).toBeLessThan(totalImpuestoPos);
  });

  // ─── proveedorSistemas optional-field regression tests ────────────────────
  //
  // The v4.4 XSD defines <ProveedorSistemas> as a required element (minOccurs defaults to 1)
  // but only applies maxLength=20 — no minLength — so an empty string is XSD-valid.
  // When proveedorSistemas is absent/null in the issuer snapshot the element must still be
  // emitted (XSD requires its presence), but its content must be empty.
  // No fabricated placeholder must appear.
  //
  // See: resources/hacienda/v4.4/FacturaElectronica.xsd
  //      resources/hacienda/v4.4/TiqueteElectronico.xsd

  it('serializes FE XML with empty ProveedorSistemas element when proveedorSistemas is null', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      issuerSnapshot: {
        ...createFiscalXmlSnapshot('INVOICE').issuerSnapshot,
        proveedorSistemas: null,
      },
    };

    const result = serializer.serialize(snapshot);

    // Element must be present (XSD minOccurs=1)
    expect(result.xml).toMatch(/<ProveedorSistemas/);
    // Content must be empty — no fabricated value
    expect(result.xml).not.toMatch(/<ProveedorSistemas>[^<]/);
    // Structural integrity: element order unchanged
    expect(result.xml.indexOf('<Clave>')).toBeLessThan(result.xml.indexOf('<ProveedorSistemas'));
    expect(result.xml.indexOf('<ProveedorSistemas')).toBeLessThan(
      result.xml.indexOf('<CodigoActividadEmisor>'),
    );
  });

  it('serializes TE XML with empty ProveedorSistemas element when proveedorSistemas is null', () => {
    const snapshot = {
      ...createFiscalXmlSnapshot('TICKET'),
      issuerSnapshot: {
        ...createFiscalXmlSnapshot('TICKET').issuerSnapshot,
        proveedorSistemas: null,
      },
    };

    const result = serializer.serialize(snapshot);

    expect(result.xml).toMatch(/<ProveedorSistemas/);
    expect(result.xml).not.toMatch(/<ProveedorSistemas>[^<]/);
    expect(result.rootElement).toBe('TiqueteElectronico');
  });

  it('serializes FE XML with empty ProveedorSistemas element when proveedorSistemas is undefined', () => {
    const baseSnapshot = createFiscalXmlSnapshot('INVOICE');
    const issuerWithoutField = { ...baseSnapshot.issuerSnapshot };
    delete (issuerWithoutField as Record<string, unknown>).proveedorSistemas;

    const snapshot = { ...baseSnapshot, issuerSnapshot: issuerWithoutField };

    const result = serializer.serialize(snapshot);

    expect(result.xml).toMatch(/<ProveedorSistemas/);
    expect(result.xml).not.toMatch(/<ProveedorSistemas>[^<]/);
  });

  it('does not insert a fabricated proveedorSistemas value when the snapshot field is absent', () => {
    const fabricatedValues = ['BILLING', 'UNKNOWN', 'N/A', '0000000000', '9999999999'];
    const snapshot = {
      ...createFiscalXmlSnapshot('INVOICE'),
      issuerSnapshot: {
        ...createFiscalXmlSnapshot('INVOICE').issuerSnapshot,
        proveedorSistemas: null,
      },
    };

    const result = serializer.serialize(snapshot);

    for (const fabricated of fabricatedValues) {
      expect(result.xml).not.toContain(`<ProveedorSistemas>${fabricated}</ProveedorSistemas>`);
    }
  });

  it('continues to emit non-empty ProveedorSistemas when the value is present (regression guard)', () => {
    const snapshot = createFiscalXmlSnapshot('INVOICE'); // fixture has proveedorSistemas: '3101234567'

    const result = serializer.serialize(snapshot);

    expect(result.xml).toContain('<ProveedorSistemas>3101234567</ProveedorSistemas>');
  });
});
