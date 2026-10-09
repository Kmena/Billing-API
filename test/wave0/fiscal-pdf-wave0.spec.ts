import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { BillingDefaultV1PdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { MockPdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/mock-pdf-renderer.adapter';
import { PdfRendererInput } from '../../src/modules/fiscal-documents/application/pdf/pdf-renderer.port';
import { Xsd11ValidatorAdapter } from '../../src/modules/fiscal-documents/infrastructure/xml/xsd11-validator.adapter';
import {
  assertSafeTestDatabase,
  assertWave7FinalValidationDatabase,
} from '../helpers/test-database-safety';
import { medicationFixture, multipageFixture } from './fixtures/fiscal-pdf-production-fixtures';

const workspace = process.cwd();
const specDirectory = join(workspace, 'specs', 'fiscal-pdf-real-representation-remediation');
const resourcesDirectory = join(workspace, 'resources', 'hacienda', 'v4.4');

const FE_NAMESPACE =
  'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica';
const TE_NAMESPACE =
  'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico';

function baselineInput(): PdfRendererInput {
  return {
    document: {
      type: 'INVOICE',
      clave: '50612092600310100000000100001010000000001123456789',
      consecutive: '00100001010000000001',
      issueDate: new Date('2026-09-12T10:15:30.000Z'),
      issuerSnapshot: { legalName: 'Wave 0 Test Issuer', identificationNumber: '3101000000' },
      receiverSnapshot: { name: 'Wave 0 Test Receiver', identificationNumber: '3102000000' },
      lineItems: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Baseline fiscal service',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
        },
      ],
      totals: { grossAmount: '1000.00000', taxAmount: '130.00000', totalAmount: '1130.00000' },
      currency: 'CRC',
      exchangeRate: 1,
      saleCondition: '01',
      paymentMethod: '01',
    },
    branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: false },
    qrPayload: 'https://example.test/qr/baseline',
    templateId: 'BILLING_DEFAULT_V1',
    rendererVersion: '1.0.0',
  };
}

function productionShapedInput(): PdfRendererInput {
  return {
    document: {
      ...baselineInput().document,
      issuerSnapshot: {
        nombre: 'Emisor Semantico de Prueba',
        identificacion: { numero: '3101000000' },
        codigoActividadEmisor: '654321',
      },
      receiverSnapshot: {
        nombre: 'Receptor Semantico de Prueba',
        identificacion: { numero: '3102000000' },
      },
      lineItems: [
        {
          numLinea: 1,
          codigoCabys: '1234567890123',
          detalle: 'Linea fiscal semantica de prueba',
          cantidad: '1.000',
          unidadMedida: 'Unid',
          precioUnitario: '1000.00',
          montoDescuento: '25.00',
          impuestoNeto: '126.75',
          montoTotalLinea: '1101.75',
          codigoImpuesto: '01',
          tarifa: '13',
        },
      ],
      totals: {
        totalVenta: '1000.00',
        totalVentaNeta: '975.00',
        totalDescuentos: '25.00',
        totalImpuesto: '126.75',
        totalComprobante: '1101.75',
      },
    },
    branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: false },
    qrPayload: 'https://example.test/qr/semantic-baseline',
    templateId: 'BILLING_DEFAULT_V1',
    rendererVersion: '1.0.0',
  };
}

function xsdElementNames(filename: string): string[] {
  const xsd = readFileSync(join(resourcesDirectory, filename), 'utf8');
  return [
    ...new Set([...xsd.matchAll(/<(?:xs|xsd):element\s+name="([^"]+)"/g)].map((match) => match[1])),
  ];
}

describe('Fiscal PDF Wave 0 — baseline, fixture and safety contracts', () => {
  const xsdValidator = new Xsd11ValidatorAdapter();
  const feXml = readFileSync(
    join(
      workspace,
      'src',
      'modules',
      'fiscal-documents',
      'infrastructure',
      'xml',
      '__tests__',
      'fixtures',
      'valid-factura-electronica-v44.xml',
    ),
  );
  const teXml = readFileSync(
    join(
      workspace,
      'src',
      'modules',
      'fiscal-documents',
      'infrastructure',
      'xml',
      '__tests__',
      'fixtures',
      'valid-tiquete-electronico-v44.xml',
    ),
  );

  it('characterizes the historical mock as bytes with MOCK-BILLING rejected by the structural PDF.js verifier', async () => {
    const output = await new MockPdfRendererAdapter().render(baselineInput());
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'billing-wave0-pdf-'));
    const mockPdfPath = join(fixtureDirectory, 'historical-mock.pdf');
    expect(output.rendererVersion).toBe('1.0.0');
    expect(output.bytes.toString('utf8')).toContain('MOCK-BILLING');
    writeFileSync(mockPdfPath, output.bytes);

    try {
      expect(() =>
        execFileSync(process.execPath, ['test/pdf-render-verifier.mjs', mockPdfPath], {
          cwd: workspace,
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('characterizes the current real PDFKit renderer as structurally parseable while retaining v1 baseline metadata', async () => {
    const output = await new BillingDefaultV1PdfRendererAdapter().render(baselineInput());
    const parsed = await PDFDocument.load(output.bytes);
    expect(output.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(output.rendererVersion).toBe('1.0.0');
  });

  it('records the current renderer semantic baseline from a production-shaped input', async () => {
    const output = await new BillingDefaultV1PdfRendererAdapter().render(productionShapedInput());
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'billing-wave0-semantic-'));
    const pdfPath = join(fixtureDirectory, 'semantic-baseline.pdf');
    writeFileSync(pdfPath, output.bytes);

    try {
      const result = JSON.parse(
        execFileSync(process.execPath, ['test/pdf-render-verifier.mjs', pdfPath], {
          cwd: workspace,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ) as { text: string };
      expect(result.text).toContain('Emisor Semantico de Prueba');
      expect(result.text).toContain('3101000000');
      expect(result.text).toContain('Receptor Semantico de Prueba');
      expect(result.text).toContain('3102000000');
      expect(result.text).toContain('Moneda: CRC');
      expect(result.text).toContain('25.00');
      expect(result.text).toContain('126.75');
      expect(result.text).toContain('1101.75');
      expect(result.text).toContain('1234567890123');
      expect(result.text).not.toContain('654321');
      expect(result.text).not.toContain('Unid');
      expect(result.text).not.toContain('Codigo impuesto');
      expect(result.text).not.toContain('Tarifa');
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('keeps FE and TE production-shaped signed XML fixture bytes immutable with known hashes', () => {
    expect(feXml.toString('utf8')).toContain(`<FacturaElectronica xmlns="${FE_NAMESPACE}"`);
    expect(teXml.toString('utf8')).toContain(`<TiqueteElectronico xmlns="${TE_NAMESPACE}"`);
    expect(createHash('sha256').update(feXml).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(teXml).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates the medication fixture against the pinned FE v4.4 XSD and preserves canonical fields', () => {
    expect(
      xsdValidator.validate({
        documentType: 'INVOICE',
        rootElement: 'FacturaElectronica',
        namespace: FE_NAMESPACE,
        schemaVersion: 'v4.4',
        xml: medicationFixture.xml,
      }).isValid,
    ).toBe(true);
    expect(medicationFixture.xml).toContain('<CodigoCABYS>');
    expect(medicationFixture.xml).toContain('<RegistroMedicamento>');
    expect(medicationFixture.xml).toContain('<FormaFarmaceutica>');
    const matrix = readFileSync(join(specDirectory, 'xml-pdf-field-matrix.md'), 'utf8');
    expect(matrix).toContain('RegistroMedicamento');
    expect(matrix).toContain('FormaFarmaceutica');
  });

  it('keeps the 30-line multipage fixture arithmetically consistent and XSD-valid', () => {
    const totalLines = multipageFixture.lines.reduce((total, line) => total + line.totalCents, 0n);
    const summary = multipageFixture.xml.match(
      /<TotalComprobante>([^<]+)<\/TotalComprobante>/,
    )?.[1];
    expect(multipageFixture.lines).toHaveLength(30);
    expect(summary).toBe(`${totalLines / 100n}.${(totalLines % 100n).toString().padStart(2, '0')}`);
    expect(
      xsdValidator.validate({
        documentType: 'INVOICE',
        rootElement: 'FacturaElectronica',
        namespace: FE_NAMESPACE,
        schemaVersion: 'v4.4',
        xml: multipageFixture.xml,
      }).isValid,
    ).toBe(true);
  });

  it('verifies every frozen FE/TE XSD element name has a field-matrix disposition', () => {
    const matrix = readFileSync(join(specDirectory, 'xml-pdf-field-matrix.md'), 'utf8');
    const feNames = xsdElementNames('FacturaElectronica.xsd');
    const teNames = xsdElementNames('TiqueteElectronico.xsd');
    expect(feNames).toHaveLength(155);
    expect(teNames).toHaveLength(153);
    expect(feNames.filter((name) => !matrix.includes(name))).toEqual([]);
    expect(teNames.filter((name) => !matrix.includes(name))).toEqual([]);
    expect(matrix).toMatch(/\| FE \|.*TipoTransaccion.*\| RENDER \|/);
    expect(matrix).toMatch(/\| TE \|.*TipoTransaccion.*\| NOT_APPLICABLE \|/);
  });

  it('freezes the 21-code failure contract for later implementation waves', () => {
    const failureMatrix = readFileSync(join(specDirectory, 'failure-matrix.md'), 'utf8');
    const codes = [...failureMatrix.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);
    expect(codes).toHaveLength(21);
    expect(new Set(codes).size).toBe(21);
  });

  it('requires an exact run-owned disposable PostgreSQL target', () => {
    const runId = 'p0wave0001';
    const roleName = 'billing_p0_' + runId + '_role';
    const env = {
      NODE_ENV: 'test',
      RUN_DB_TESTS: '1',
      BILLING_TEST_RUN_ID: runId,
      BILLING_TEST_RUN_TOKEN: 'A'.repeat(32),
      BILLING_TEST_DATABASE_ROLE: roleName,
      USE_REAL_HACIENDA: 'false',
      BILLING_TEST_DATABASE_URL:
        'postgresql://' + roleName + ':billing@localhost:5432/billing_p0_' + runId + '_test',
    };

    expect(assertSafeTestDatabase(env).databaseName).toBe('billing_p0_' + runId + '_test');
    for (const databaseName of [
      'billing_dev',
      'billing_prod',
      'postgres',
      'billing_prod_test',
      'billing_test_backup',
    ]) {
      expect(() =>
        assertSafeTestDatabase({
          ...env,
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':billing@localhost:5432/' + databaseName,
        }),
      ).toThrow();
    }
    expect(() =>
      assertSafeTestDatabase({ ...env, BILLING_TEST_DATABASE_URL: undefined }),
    ).toThrow();
    expect(() =>
      assertSafeTestDatabase({ ...env, BILLING_TEST_DATABASE_URL: 'not a url' }),
    ).toThrow();
  });

  it('uses the same central contract for Wave 7 final validation', () => {
    const runId = 'p0wave7001';
    const roleName = 'billing_p0_' + runId + '_role';
    expect(
      assertWave7FinalValidationDatabase({
        NODE_ENV: 'test',
        RUN_DB_TESTS: '1',
        BILLING_TEST_RUN_ID: runId,
        BILLING_TEST_RUN_TOKEN: 'B'.repeat(32),
        BILLING_TEST_DATABASE_ROLE: roleName,
        USE_REAL_HACIENDA: 'false',
        BILLING_TEST_DATABASE_URL:
          'postgresql://' + roleName + ':billing@localhost:5432/billing_p0_' + runId + '_test',
      }).databaseName,
    ).toBe('billing_p0_' + runId + '_test');
  });
});
