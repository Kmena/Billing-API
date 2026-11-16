import * as fs from 'fs';
import * as path from 'path';
import { FiscalXmlGenerationResult } from '../../../domain/fiscal-xml/fiscal-xml.types';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';
import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { createFiscalXmlSnapshot } from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

const fixturesDirectory = path.join(__dirname, 'fixtures');
const invoiceXml = readFixture('valid-factura-electronica-v44.xml');
const ticketXml = readFixture('valid-tiquete-electronico-v44.xml');

describe('Xsd11ValidatorAdapter', () => {
  const validator = new Xsd11ValidatorAdapter();

  it('compiles both pinned official Hacienda v4.4 schemas with the XSD 1.1 engine', () => {
    expect(validator.compileSchema('INVOICE')).toEqual({
      isValid: true,
      schemaVersion: 'v4.4',
      errors: [],
    });
    expect(validator.compileSchema('TICKET')).toEqual({
      isValid: true,
      schemaVersion: 'v4.4',
      errors: [],
    });
  });

  it('validates known-valid FacturaElectronica and TiqueteElectronico fixtures', () => {
    expect(validator.validate(generatedInvoice(invoiceXml))).toEqual({
      isValid: true,
      schemaVersion: 'v4.4',
      errors: [],
    });
    expect(validator.validate(generatedTicket(ticketXml))).toEqual({
      isValid: true,
      schemaVersion: 'v4.4',
      errors: [],
    });
  });

  it('accepts unsigned fiscal structure only when the sole official XSD error is missing root Signature', () => {
    const unsignedInvoice = invoiceXml.replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '');
    const unsignedTicket = ticketXml.replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '');
    expect(validator.validate(generatedInvoice(unsignedInvoice)).isValid).toBe(false);
    expect(validator.validateUnsignedStructure(generatedInvoice(unsignedInvoice)).isValid).toBe(
      true,
    );
    expect(validator.validateUnsignedStructure(generatedTicket(unsignedTicket)).isValid).toBe(true);
    expect(validator.validateUnsignedStructure(generatedInvoice(invoiceXml)).isValid).toBe(false);
  });

  it('rejects missing fiscal fields, wrong order and namespace before signing', () => {
    const unsigned = invoiceXml.replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '');
    const missingTotal = unsigned.replace(/<TotalComprobante>[^<]*<\/TotalComprobante>/, '');
    const badOrder = unsigned.replace(
      /(<TotalVenta>[^<]*<\/TotalVenta>)(\s*<TotalVentaNeta>[^<]*<\/TotalVentaNeta>)/,
      '$2$1',
    );
    const badNamespace = unsigned.replace(
      'xml-schemas/v4.4/facturaElectronica',
      'xml-schemas/v4.4/incorrecto',
    );
    for (const xml of [missingTotal, badOrder, badNamespace]) {
      expect(validator.validateUnsignedStructure(generatedInvoice(xml)).isValid).toBe(false);
    }
  });

  it('rejects structurally valid XML with an incompatible taxable base or summary total', () => {
    const generated = new HaciendaV44XmlSerializerAdapter().serialize(createFiscalXmlSnapshot());
    expect(validator.validateUnsignedStructure(generated).isValid).toBe(true);
    for (const xml of [
      generated.xml.replace(
        '<BaseImponible>1000.00000</BaseImponible>',
        '<BaseImponible>1001.00000</BaseImponible>',
      ),
      generated.xml.replace(
        '<TotalComprobante>1130.00000</TotalComprobante>',
        '<TotalComprobante>1131.00000</TotalComprobante>',
      ),
    ]) {
      const result = validator.validateUnsignedStructure({ ...generated, xml });
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe('FISCAL_XML_PRE_SIGN_AMOUNT_MISMATCH');
    }
  });

  it('fails missing mandatory elements with normalized sanitized errors', () => {
    const invalidXml = invoiceXml.replace(/\s*<ProveedorSistemas>[^<]+<\/ProveedorSistemas>/, '');
    const result = validator.validate(generatedInvoice(invalidXml));

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('FISCAL_XML_VALIDATION_FAILED');
    expect(result.errors[0].message).not.toContain(invoiceXml);
    expect(result.errors[0].message).not.toContain('ProveedorSistemas>3101000000');
  });

  it('fails invalid element order with normalized sanitized errors', () => {
    const invalidXml = invoiceXml.replace(
      /<Clave>([^<]+)<\/Clave>\s*<ProveedorSistemas>([^<]+)<\/ProveedorSistemas>/,
      '<ProveedorSistemas>$2</ProveedorSistemas><Clave>$1</Clave>',
    );
    const result = validator.validate(generatedInvoice(invalidXml));

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('FISCAL_XML_VALIDATION_FAILED');
    expect(result.errors[0].message).not.toContain(invoiceXml);
  });

  it('fails invalid schema-controlled datatype and catalog values', () => {
    const invalidXml = invoiceXml.replace(
      '<CondicionVenta>01</CondicionVenta>',
      '<CondicionVenta>XX</CondicionVenta>',
    );
    const result = validator.validate(generatedInvoice(invalidXml));

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('FISCAL_XML_VALIDATION_FAILED');
    expect(result.errors[0].message).not.toContain('<CondicionVenta>XX</CondicionVenta>');
  });

  it('fails malformed XML safely', () => {
    const result = validator.validate(
      generatedInvoice('<FacturaElectronica><Clave>broken</FacturaElectronica>'),
    );

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toMatch(/^FISCAL_XML_/);
    expect(result.errors[0].message).not.toContain('<FacturaElectronica><Clave>broken');
  });

  it('blocks XXE filesystem and network payloads before the engine runs', () => {
    const filePayload =
      '<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><foo>&xxe;</foo>';
    const networkPayload =
      '<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "http://127.0.0.1:9/secret"> ]><foo>&xxe;</foo>';

    expect(validator.validate(generatedInvoice(filePayload)).errors[0].code).toBe(
      'FISCAL_XML_XXE_BLOCKED',
    );
    expect(validator.validate(generatedInvoice(networkPayload)).errors[0].code).toBe(
      'FISCAL_XML_XXE_BLOCKED',
    );
  });

  it('blocks external DTD resolution and remote schema resolution', () => {
    const externalDtd =
      '<!DOCTYPE FacturaElectronica SYSTEM "http://127.0.0.1:9/external.dtd"><FacturaElectronica/>';
    const remoteSchema = invoiceXml.replace(
      '<FacturaElectronica xmlns=',
      '<FacturaElectronica xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica https://127.0.0.1/schema.xsd" xmlns=',
    );

    expect(validator.validate(generatedInvoice(externalDtd)).errors[0].code).toBe(
      'FISCAL_XML_XXE_BLOCKED',
    );
    expect(validator.validate(generatedInvoice(remoteSchema)).errors[0].code).toBe(
      'FISCAL_XML_REMOTE_SCHEMA_BLOCKED',
    );
  });

  it('normalizes hung-process timeout failures when the engine subprocess exceeds its timeout', () => {
    const hangingValidator = new Xsd11ValidatorAdapter({
      pythonCommand: process.execPath,
      scriptPath: path.join(__dirname, 'fixtures', 'xmlschema-validator.py'),
      timeoutMs: 25,
    });
    const result = hangingValidator.validate(generatedInvoice(invoiceXml));

    expect(result.isValid).toBe(false);
    expect(result.errors[0].code).toBe('FISCAL_XML_VALIDATOR_TIMEOUT');
  });
});

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');
}

function generatedInvoice(xml: string): FiscalXmlGenerationResult {
  return {
    documentType: 'INVOICE',
    rootElement: 'FacturaElectronica',
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
    schemaVersion: 'v4.4',
    xml,
  };
}

function generatedTicket(xml: string): FiscalXmlGenerationResult {
  return {
    documentType: 'TICKET',
    rootElement: 'TiqueteElectronico',
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico',
    schemaVersion: 'v4.4',
    xml,
  };
}
