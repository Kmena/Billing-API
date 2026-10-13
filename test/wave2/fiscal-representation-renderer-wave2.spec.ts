import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION,
  BILLING_DEFAULT_V1_TEMPLATE_ID,
  BillingDefaultV1PdfRendererAdapter,
} from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import {
  FiscalDocumentType,
  FiscalRepresentationView,
  ReadOnlyFiscalXmlParser,
} from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import {
  medicationFixture,
  multipageFixture,
} from '../wave0/fixtures/fiscal-pdf-production-fixtures';
import { readFileSync } from 'fs';

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
const renderer = new BillingDefaultV1PdfRendererAdapter();

const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const project = (xml: string, documentType: FiscalDocumentType): FiscalRepresentationView => {
  const bytes = Buffer.from(xml, 'utf8');
  return parser.project({ bytes, expectedSha256: hash(bytes), documentType });
};

const extractedPdf = (
  bytes: Buffer,
  expectedQr?: string,
): { pageCount: number; text: string; qr?: { decoded: string } | null } => {
  const directory = mkdtempSync(join(tmpdir(), 'billing-wave2-'));
  const path = join(directory, 'representation.pdf');
  try {
    writeFileSync(path, bytes);
    const args = ['test/pdf-render-verifier.mjs', path];
    if (expectedQr) args.push(expectedQr, directory);
    return JSON.parse(
      execFileSync(process.execPath, args, {
        cwd: workspace,
        encoding: 'utf8',
      }),
    ) as { pageCount: number; text: string; qr?: { decoded: string } | null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('Fiscal PDF Wave 2 — typed representation renderer', () => {
  it('renders complete FE values from the typed XML projection without a mock marker', async () => {
    const view = project(medicationFixture.xml, 'INVOICE');
    const result = await renderer.renderRepresentation(view);
    const pdf = extractedPdf(result.bytes);

    expect(result.templateId).toBe(BILLING_DEFAULT_V1_TEMPLATE_ID);
    expect(result.rendererVersion).toBe(BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(1);
    expect(pdf.text).not.toContain('MOCK-BILLING');
    [
      view.document.clave,
      view.document.consecutive,
      view.issuer.legalName,
      view.receiver?.legalName,
      view.document.issuerActivityCode,
      view.currency.code,
      view.lines[0].cabys,
      view.lines[0].detail,
      view.lines[0].quantity.canonical,
      view.lines[0].unit,
      view.lines[0].unitPrice.canonical,
      view.lines[0].taxes[0].code,
      view.lines[0].taxes[0].rate?.canonical,
      view.lines[0].taxes[0].amount.canonical,
      view.lines[0].lineTotal.canonical,
      view.summary.tax?.canonical,
      view.summary.total.canonical,
    ].forEach((value) => expect(pdf.text).toContain(value));
  });

  it('renders a TE without a fabricated TipoTransaccion or optional-field garbage', async () => {
    const view = project(teXml, 'TICKET');
    const result = await renderer.renderRepresentation(view);
    const pdf = extractedPdf(result.bytes);

    expect(pdf.text).toContain('Tiquete Electrónico');
    expect(pdf.text).toContain(view.document.clave);
    expect(pdf.text).toContain(view.document.consecutive);
    expect(pdf.text).not.toContain('Tipo transacción');
    expect(pdf.text).not.toMatch(/undefined|null|\[object Object\]/i);
  });

  it('renders medication data and authoritative fiscal line values', async () => {
    const view = project(medicationFixture.xml, 'INVOICE');
    const line = view.lines[0];
    const pdf = extractedPdf((await renderer.renderRepresentation(view)).bytes);

    [
      line.cabys,
      line.medicationRegistration,
      line.pharmaceuticalForm,
      line.total.canonical,
      line.subtotal.canonical,
      line.taxNet.canonical,
      line.lineTotal.canonical,
    ].forEach((value) => expect(pdf.text).toContain(value));
  });

  it('renders all 30 lines in source order across multiple structurally valid pages', async () => {
    const view = project(multipageFixture.xml, 'INVOICE');
    const pdf = extractedPdf((await renderer.renderRepresentation(view)).bytes);
    const positions = view.lines.map((line) => pdf.text.indexOf(line.detail));

    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(
      positions.every((position, index) => index === 0 || position > positions[index - 1]),
    ).toBe(true);
    expect(pdf.text).toContain(view.summary.total.canonical);
  });

  it('keeps XML bytes, XML hash and semantic view values unchanged while rendering', async () => {
    const bytes = Buffer.from(medicationFixture.xml, 'utf8');
    const beforeBytes = Buffer.from(bytes);
    const beforeHash = hash(bytes);
    const view = parser.project({ bytes, expectedSha256: beforeHash, documentType: 'INVOICE' });
    const semanticSnapshot = JSON.stringify(view);

    await renderer.renderRepresentation(view);

    expect(bytes.equals(beforeBytes)).toBe(true);
    expect(hash(bytes)).toBe(beforeHash);
    expect(JSON.stringify(view)).toBe(semanticSnapshot);
  });

  it('keeps QR disabled by default and rejects an enabled non-HTTPS payload', async () => {
    const view = project(feXml, 'INVOICE');
    const pdf = extractedPdf((await renderer.renderRepresentation(view)).bytes);
    expect(pdf.text).not.toContain('QR configurado');
    await expect(
      renderer.renderRepresentation(view, {
        qr: { enabled: true, payload: 'http://example.test/qr' },
      }),
    ).rejects.toThrow('HTTPS');
  });

  it('renders long detail, multiple discounts and multiple taxes without fiscal recalculation', async () => {
    const xml = medicationFixture.xml
      .replace(
        'Dato estructural de medicamento de prueba; no representa un medicamento registrado.',
        'Descripción fiscal extensa de prueba '.repeat(30),
      )
      .replace(
        '<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13</Tarifa><Monto>162.63</Monto></Impuesto>',
        '<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13</Tarifa><Monto>162.63</Monto></Impuesto><Impuesto><Codigo>04</Codigo><Tarifa>2.50000</Tarifa><Monto>12.34000</Monto></Impuesto>',
      )
      .replace(
        '<SubTotal>1251.00</SubTotal>',
        '<Descuento><MontoDescuento>2.50000</MontoDescuento><CodigoDescuento>01</CodigoDescuento><NaturalezaDescuento>Prueba uno</NaturalezaDescuento></Descuento><Descuento><MontoDescuento>3.21000</MontoDescuento><CodigoDescuento>02</CodigoDescuento><NaturalezaDescuento>Prueba dos</NaturalezaDescuento></Descuento><SubTotal>1251.00</SubTotal>',
      );
    const view = project(xml, 'INVOICE');
    const pdf = extractedPdf((await renderer.renderRepresentation(view)).bytes);

    expect(view.lines[0].discounts).toHaveLength(2);
    expect(view.lines[0].taxes).toHaveLength(2);
    [
      view.lines[0].detail,
      view.lines[0].discounts[0].amount.canonical,
      view.lines[0].discounts[1].amount.canonical,
      view.lines[0].taxes[0].code,
      view.lines[0].taxes[1].code,
      view.lines[0].taxes[1].rate?.canonical,
      view.lines[0].taxes[1].amount.canonical,
    ].forEach((value) => expect(pdf.text).toContain(value));
  });

  it('renders an explicitly configured HTTPS QR while QR remains optional', async () => {
    const view = project(medicationFixture.xml, 'INVOICE');
    const payload = `https://qr.example.test/fiscal/${view.document.clave}`;
    const pdf = extractedPdf(
      (await renderer.renderRepresentation(view, { qr: { enabled: true, payload } })).bytes,
      payload,
    );
    expect(pdf.qr?.decoded).toBe(payload);
  });

  it('uses branding only as supplied visual data without changing fiscal text', async () => {
    const view = project(medicationFixture.xml, 'INVOICE');
    const before = JSON.stringify(view);
    const pdf = extractedPdf(
      (
        await renderer.renderRepresentation(view, {
          branding: {
            templateId: BILLING_DEFAULT_V1_TEMPLATE_ID,
            primaryColor: '#123456',
            footerText: 'Marca autorizada de prueba',
            showCommercialName: true,
            commercialName: 'No sustituye datos fiscales',
          },
        })
      ).bytes,
    );
    expect(pdf.text).toContain('Marca autorizada de prueba');
    expect(pdf.text).toContain(view.issuer.legalName);
    expect(JSON.stringify(view)).toBe(before);
  });
});
