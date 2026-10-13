import { createHash } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { readFileSync } from 'fs';
import { join } from 'path';
import { projectionDestinationForMatrixPath } from '../../src/modules/fiscal-documents/application/fiscal-representation/fiscal-representation-projection.builder';
import {
  FiscalDocumentType,
  FiscalXmlProjectionError,
  ReadOnlyFiscalXmlParser,
  SIGNED_XML_MAX_SIZE_BYTES,
} from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import {
  medicationFixture,
  multipageFixture,
} from '../wave0/fixtures/fiscal-pdf-production-fixtures';

const workspace = process.cwd();
const fixtureDirectory = join(
  workspace,
  'src',
  'modules',
  'fiscal-documents',
  'infrastructure',
  'xml',
  '__tests__',
  'fixtures',
);
const feXml = readFileSync(join(fixtureDirectory, 'valid-factura-electronica-v44.xml'), 'utf8');
const teXml = readFileSync(join(fixtureDirectory, 'valid-tiquete-electronico-v44.xml'), 'utf8');
const parser = new ReadOnlyFiscalXmlParser();

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const project = (xml: string, documentType: FiscalDocumentType) => {
  const bytes = Buffer.from(xml, 'utf8');
  return parser.project({ bytes, expectedSha256: hash(bytes), documentType });
};
const expectCode = (operation: () => unknown, code: FiscalXmlProjectionError['code']): void => {
  try {
    operation();
    throw new Error('Expected projection to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FiscalXmlProjectionError);
    expect((error as FiscalXmlProjectionError).code).toBe(code);
  }
};
const insertBeforeSummary = (xml: string, content: string): string =>
  xml.replace('<ResumenFactura>', `${content}<ResumenFactura>`);

describe('Fiscal PDF Wave 1 projection', () => {
  it('projects FE identity, parties, sale, currency and exact summary values', () => {
    const xml = medicationFixture.xml
      .replace(
        '<CodigoActividadEmisor>123456</CodigoActividadEmisor>',
        '<CodigoActividadEmisor>123456</CodigoActividadEmisor><CodigoActividadReceptor>654321</CodigoActividadReceptor>',
      )
      .replace(
        '<CondicionVenta>01</CondicionVenta>',
        '<CondicionVenta>01</CondicionVenta><PlazoCredito>30</PlazoCredito>',
      )
      .replace(
        '<UnidadMedida>Unid</UnidadMedida>',
        '<UnidadMedida>Unid</UnidadMedida><TipoTransaccion>01</TipoTransaccion>',
      );
    const view = project(xml, 'INVOICE');

    expect(view.document).toMatchObject({
      type: 'INVOICE',
      issuerActivityCode: '123456',
      receiverActivityCode: '654321',
      consecutive: '00100001010000000001',
      issueDate: '2026-09-12T10:15:30-06:00',
    });
    expect(view.issuer.legalName).toBe('Empresa Emisora de Pruebas SA');
    expect(view.issuer.identification?.number).toBe('3101000000');
    expect(view.receiver?.identification?.number).toBe('3102000000');
    expect(view.receiver?.economicActivity).toBe('654321');
    expect(view.sale).toEqual({ condition: '01', otherCondition: undefined, creditTerm: '30' });
    expect(view.currency.code).toBe('CRC');
    expect(view.currency.exchangeRate.canonical).toBe('1.00000');
    expect(view.lines[0].transactionType).toBe('01');
    expect(view.summary.tax?.canonical).toBe('162.63');
    expect(view.summary.total.canonical).toBe('1413.63');
  });

  it('projects a normal ProveedorSistemas value', () => {
    expect(project(feXml, 'INVOICE').document.systemProviderId).toBe('3101000000');
  });

  it('preserves an empty ProveedorSistemas allowed by the v4.4 XSD', () => {
    const xml = feXml.replace(
      '<ProveedorSistemas>3101000000</ProveedorSistemas>',
      '<ProveedorSistemas></ProveedorSistemas>',
    );
    expect(project(xml, 'INVOICE').document.systemProviderId).toBe('');
  });

  it('rejects an absent ProveedorSistemas element', () => {
    const xml = feXml.replace('<ProveedorSistemas>3101000000</ProveedorSistemas>', '');
    expectCode(() => project(xml, 'INVOICE'), 'PROJECTION_FAILED');
  });

  it('rejects an oversized ProveedorSistemas value', () => {
    const xml = feXml.replace(
      '<ProveedorSistemas>3101000000</ProveedorSistemas>',
      '<ProveedorSistemas>' + 'x'.repeat(21) + '</ProveedorSistemas>',
    );
    expectCode(() => project(xml, 'INVOICE'), 'PROJECTION_FAILED');
  });

  it('projects TE without FE-only TipoTransaccion', () => {
    const view = project(teXml, 'TICKET');
    expect(view.document.type).toBe('TICKET');
    expect(view.document.receiverActivityCode).toBeUndefined();
    expect(view.receiver).toBeUndefined();
    expect(view.lines).toHaveLength(0);
    expect(view.projectedFields.some((field) => field.elementName === 'TipoTransaccion')).toBe(
      false,
    );
  });

  it('projects medication fields and exact fiscal line values', () => {
    const view = project(medicationFixture.xml, 'INVOICE');
    const line = view.lines[0];
    expect(line.cabys).toBe('1234567890123');
    expect(line.medicationRegistration).toBe('TEST-ONLY-NOT-REGISTERED');
    expect(line.pharmaceuticalForm).toBe('TAB');
    expect(line.quantity.canonical).toBe('1.000');
    expect(line.unit).toBe('Unid');
    expect(line.unitPrice.canonical).toBe('1251.00');
    expect(line.taxes[0]).toMatchObject({ code: '01', tariffCode: '08' });
    expect(line.taxes[0].rate?.canonical).toBe('13');
    expect(line.lineTotal.canonical).toBe('1413.63');
  });

  it('projects all 30 lines in source order without truncating descriptions or decimals', () => {
    const view = project(multipageFixture.xml, 'INVOICE');
    expect(view.lines).toHaveLength(30);
    expect(view.lines.map((line) => line.number)).toEqual(
      Array.from({ length: 30 }, (_, index) => String(index + 1)),
    );
    expect(view.lines[29].detail).toContain('descripcion extensa');
    expect(view.lines.every((line) => line.cabys === '1234567890123')).toBe(true);
    expect(view.lines.every((line) => line.unit === 'Unid')).toBe(true);
    expect(view.lines[2].discounts[0].amount.canonical).toBe('2.50');
    expect(view.lines[29].taxes[0].code).toBe('01');
    expect(view.summary.total.canonical).toBe(
      `${multipageFixture.lines.reduce((total, line) => total + line.totalCents, 0n) / 100n}.${(
        multipageFixture.lines.reduce((total, line) => total + line.totalCents, 0n) % 100n
      )
        .toString()
        .padStart(2, '0')}`,
    );
  });

  it('preserves exact decimal lexical values without Number conversion', () => {
    const xml = medicationFixture.xml
      .replace('<Cantidad>1.000</Cantidad>', '<Cantidad>0.1</Cantidad>')
      .replace('<PrecioUnitario>1251.00</PrecioUnitario>', '<PrecioUnitario>0.2</PrecioUnitario>')
      .replace('<MontoTotal>1251.00</MontoTotal>', '<MontoTotal>2600.00000</MontoTotal>')
      .replace('<Tarifa>13</Tarifa>', '<Tarifa>13.00000</Tarifa>')
      .replace(
        '<MontoTotalLinea>1413.63</MontoTotalLinea>',
        '<MontoTotalLinea>22600.00000</MontoTotalLinea>',
      )
      .replace(
        '<TotalComprobante>1413.63</TotalComprobante>',
        '<TotalComprobante>0.10</TotalComprobante>',
      );
    const view = project(xml, 'INVOICE');
    expect(view.lines[0].quantity.canonical).toBe('0.1');
    expect(view.lines[0].unitPrice.canonical).toBe('0.2');
    expect(view.lines[0].total.canonical).toBe('2600.00000');
    expect(view.lines[0].taxes[0].rate?.canonical).toBe('13.00000');
    expect(view.lines[0].lineTotal.canonical).toBe('22600.00000');
    expect(view.summary.total.canonical).toBe('0.10');
  });

  it('provides a deterministic destination for every canonical RENDER matrix row', () => {
    const matrix = readFileSync(
      join(
        workspace,
        'specs',
        'fiscal-pdf-real-representation-remediation',
        'xml-pdf-field-matrix.md',
      ),
      'utf8',
    );
    const renderPaths = matrix
      .split(/\r?\n/)
      .filter((line) => line.startsWith('|') && line.endsWith('| RENDER |'))
      .map((line) => line.split('|')[2]?.match(/`([^`]+)`/)?.[1])
      .filter((path): path is string => Boolean(path));
    expect(renderPaths.length).toBeGreaterThan(100);
    expect(renderPaths.map(projectionDestinationForMatrixPath)).not.toContain(undefined);
  });
});

describe('Fiscal PDF Wave 1 parser security', () => {
  it('rejects XML larger than 2 MiB before hash or parse', () => {
    const bytes = Buffer.alloc(SIGNED_XML_MAX_SIZE_BYTES + 1, 0x20);
    expectCode(
      () => parser.project({ bytes, expectedSha256: '0'.repeat(64), documentType: 'INVOICE' }),
      'SIGNED_XML_OVERSIZED',
    );
  });

  it.each([
    ['DOCTYPE', '<!DOCTYPE FacturaElectronica>'],
    ['DTD whitespace variant', '<!   DoCtYpE FacturaElectronica>'],
    ['internal ENTITY', '<!DOCTYPE FacturaElectronica [<!ENTITY x "x">]>'],
    [
      'external file ENTITY',
      '<!DOCTYPE FacturaElectronica [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
    ],
    [
      'external network ENTITY',
      '<!DOCTYPE FacturaElectronica [<!ENTITY x SYSTEM "https://example.test/x">]>',
    ],
  ])('rejects %s without network or filesystem I/O', (_label, declaration) => {
    const xml = feXml.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<?xml version="1.0" encoding="UTF-8"?>${declaration}`,
    );
    const bytes = Buffer.from(xml);
    const fsSpy = jest.spyOn(fs, 'readFileSync');
    const httpSpy = jest.spyOn(http, 'request');
    const httpsSpy = jest.spyOn(https, 'request');
    try {
      expectCode(
        () => parser.project({ bytes, expectedSha256: hash(bytes), documentType: 'INVOICE' }),
        'XML_SECURITY_REJECTED',
      );
      expect(fsSpy).not.toHaveBeenCalled();
      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      fsSpy.mockRestore();
      httpSpy.mockRestore();
      httpsSpy.mockRestore();
    }
  });

  it('rejects malformed XML', () => {
    const xml = feXml.replace('</FacturaElectronica>', '</TiqueteElectronico>');
    expectCode(() => project(xml, 'INVOICE'), 'XML_MALFORMED');
  });

  it('rejects an unsupported root', () => {
    const xml = feXml.replaceAll('FacturaElectronica', 'NotaCreditoElectronica');
    expectCode(() => project(xml, 'INVOICE'), 'XML_UNSUPPORTED_ROOT');
  });

  it('rejects a supported local name under a foreign namespace', () => {
    const xml = feXml.replace(
      'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
      'https://foreign.example/facturaElectronica',
    );
    expectCode(() => project(xml, 'INVOICE'), 'XML_NAMESPACE_INVALID');
  });

  it('rejects namespace confusion in a nested fiscal element', () => {
    const xml = insertBeforeSummary(feXml, '<Extra xmlns="https://foreign.example/ns">x</Extra>');
    expectCode(() => project(xml, 'INVOICE'), 'XML_NAMESPACE_INVALID');
  });

  it('accepts the exact XAdES namespace emitted by the Billing signer', () => {
    const xml = feXml.replace(
      '</ds:Signature>',
      '<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"><xades:SignedProperties/></xades:QualifyingProperties></ds:Signature>',
    );
    expect(project(xml, 'INVOICE').document.type).toBe('INVOICE');
  });

  it('rejects an unexpected namespace inside the signature structure', () => {
    const xml = feXml.replace(
      '</ds:Signature>',
      '<unexpected:Extra xmlns:unexpected="urn:inventori:unexpected:test"/></ds:Signature>',
    );
    expectCode(() => project(xml, 'INVOICE'), 'XML_NAMESPACE_INVALID');
  });

  it('accepts a namespace-prefixed supported root', () => {
    const xml = feXml
      .replace(
        '<FacturaElectronica xmlns="',
        '<fe:FacturaElectronica xmlns:fe="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica" xmlns="',
      )
      .replace('</FacturaElectronica>', '</fe:FacturaElectronica>');
    expect(project(xml, 'INVOICE').document.type).toBe('INVOICE');
  });

  it('rejects a misleading nested fiscal root', () => {
    const xml = insertBeforeSummary(feXml, '<FacturaElectronica/>');
    expectCode(() => project(xml, 'INVOICE'), 'XML_SECURITY_REJECTED');
  });

  it('rejects depth greater than 64', () => {
    const nested = `${'<Nivel>'.repeat(65)}x${'</Nivel>'.repeat(65)}`;
    expectCode(
      () => project(insertBeforeSummary(feXml, nested), 'INVOICE'),
      'XML_SECURITY_REJECTED',
    );
  });

  it('rejects more than 50,000 nodes', () => {
    const nodes = `<Contenedor>${'<N/>'.repeat(50_001)}</Contenedor>`;
    expectCode(
      () => project(insertBeforeSummary(feXml, nodes), 'INVOICE'),
      'XML_SECURITY_REJECTED',
    );
  });

  it('rejects a text node longer than 20,000 characters', () => {
    const text = `<Otros><OtroTexto>${'x'.repeat(20_001)}</OtroTexto></Otros>`;
    expectCode(() => project(insertBeforeSummary(feXml, text), 'INVOICE'), 'XML_SECURITY_REJECTED');
  });

  it('rejects aggregate text greater than 1,500,000 characters', () => {
    const chunks = Array.from(
      { length: 76 },
      () => `<OtroTexto>${'x'.repeat(19_999)}</OtroTexto>`,
    ).join('');
    expectCode(
      () => project(insertBeforeSummary(feXml, `<Otros>${chunks}</Otros>`), 'INVOICE'),
      'XML_SECURITY_REJECTED',
    );
  });

  it('rejects a SHA-256 mismatch before projection', () => {
    const bytes = Buffer.from(feXml);
    expectCode(
      () => parser.project({ bytes, expectedSha256: '0'.repeat(64), documentType: 'INVOICE' }),
      'SIGNED_XML_HASH_MISMATCH',
    );
  });
});

describe('Fiscal PDF Wave 1 signed XML immutability', () => {
  it.each([
    ['FE', feXml, 'INVOICE' as const],
    ['TE', teXml, 'TICKET' as const],
    ['medication', medicationFixture.xml, 'INVOICE' as const],
    ['30-line', multipageFixture.xml, 'INVOICE' as const],
  ])('keeps %s bytes and SHA-256 unchanged', (_label, xml, documentType) => {
    const bytes = Buffer.from(xml);
    const before = Buffer.from(bytes);
    const beforeHash = hash(bytes);
    parser.project({ bytes, expectedSha256: beforeHash, documentType });
    expect(bytes.equals(before)).toBe(true);
    expect(hash(bytes)).toBe(beforeHash);
  });
});
