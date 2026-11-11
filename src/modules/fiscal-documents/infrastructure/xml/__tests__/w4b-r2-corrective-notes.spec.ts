import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { buildConsecutive, buildFiscalKey } from '../../../domain/fiscal-key.generator';
import {
  HACIENDA_V44_NOTA_CREDITO,
  HACIENDA_V44_NOTA_DEBITO,
} from '../../../domain/fiscal-xml/hacienda-v44-contract';
import { FiscalXmlDocumentSnapshot } from '../../../domain/fiscal-xml/fiscal-xml.types';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { NodeXadesEpesSignerAdapter } from '../../../../../infrastructure/signing/adapters/node-xades-epes-signer.adapter';
import { HaciendaV44XmlSerializerAdapter } from '../hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';

jest.setTimeout(120000);
const serializer = new HaciendaV44XmlSerializerAdapter();
const validator = new Xsd11ValidatorAdapter({ timeoutMs: 30000 });
const signer = new NodeXadesEpesSignerAdapter();
const source = createFiscalXmlSnapshot('INVOICE');

const line = (number: number, rateCode: string) => ({
  lineNumber: number,
  cabysCode: '8313100000100',
  description: `Servicio sintético ${number}`,
  unitMeasure: 'Sp',
  quantity: '1.00000',
  unitPrice: '1000.00000',
  taxAmount: rateCode === '08' ? '130.00000' : '0.00000',
  taxCode: '01',
  taxRateCode: rateCode,
  taxRate: rateCode === '08' ? '13.00000' : '0.00000',
});

function note(type: 'CREDIT_NOTE' | 'DEBIT_NOTE', lines: unknown[]): FiscalXmlDocumentSnapshot {
  const consecutive = buildConsecutive({
    branchCode: '001',
    terminalCode: '00001',
    documentType: type,
    sequenceValue: 1n,
  });
  return {
    ...source,
    type,
    consecutive,
    clave: buildFiscalKey({
      issuedAt: source.issueDate,
      issuerIdentificationNumber: '3101000000',
      consecutive,
      securityCode: '12345678',
    }),
    lines,
    referenceSnapshot: {
      documentTypeCode: '01',
      clave: source.clave,
      issueDate: source.issueDate.toISOString(),
      code: '01',
      reason: 'Ajuste sintético de laboratorio',
    },
  };
}

describe('W4-B-R2 NC/ND v4.4 laboratory XML', () => {
  const certificate = createTestSigningMaterial().certificate;

  it.each([HACIENDA_V44_NOTA_CREDITO, HACIENDA_V44_NOTA_DEBITO])(
    'pins and compiles $documentType XSD',
    (schema) => {
      const path = join(process.cwd(), 'resources', 'hacienda', 'v4.4', schema.xsdFileName);
      expect(statSync(path).size).toBe(schema.fileSizeBytes);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(schema.sha256);
      expect(validator.compileSchema(schema.documentType).isValid).toBe(true);
    },
  );

  it.each([
    ['CREDIT_NOTE', '10', 'exenta'],
    ['CREDIT_NOTE', '01', 'IVA 0 %'],
    ['CREDIT_NOTE', '08', 'IVA 13 %'],
    ['CREDIT_NOTE', 'mixed', 'multilínea'],
    ['DEBIT_NOTE', '10', 'exenta'],
    ['DEBIT_NOTE', '01', 'IVA 0 %'],
    ['DEBIT_NOTE', '08', 'IVA 13 %'],
    ['DEBIT_NOTE', 'mixed', 'multilínea'],
  ] as const)('%s %s %s signs and validates', async (type, rate, _label) => {
    const lines = rate === 'mixed' ? [line(1, '10'), line(2, '08')] : [line(1, rate)];
    const generated = serializer.serialize(note(type, lines));
    const unsigned = validator.validateUnsignedStructure(generated);
    expect(unsigned.isValid).toBe(true);
    const signed = await signer.sign(generated.xml, certificate);
    expect((await signer.verify(signed)).isValid).toBe(true);
    expect(validator.validate({ ...generated, xml: signed }).isValid).toBe(true);
  });

  it('rejects missing and malformed references before XML generation', () => {
    expect(() =>
      serializer.serialize({ ...note('CREDIT_NOTE', [line(1, '10')]), referenceSnapshot: null }),
    ).toThrow('FISCAL_XML_CORRECTION_REFERENCE_REQUIRED');
    expect(() =>
      serializer.serialize({
        ...note('DEBIT_NOTE', [line(1, '10')]),
        referenceSnapshot: {
          documentTypeCode: '01',
          clave: 'bad',
          issueDate: 'bad',
          code: '01',
          reason: 'synthetic',
        },
      }),
    ).toThrow('FISCAL_XML_CORRECTION_REFERENCE_INVALID');
  });
});
