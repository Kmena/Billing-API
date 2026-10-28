import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_NOTA_CREDITO_LAB,
  HACIENDA_V44_NOTA_DEBITO_LAB,
} from '../hacienda-v44-contract';
import { Xsd11ValidatorAdapter } from '../../../infrastructure/xml/xsd11-validator.adapter';

describe('W3-B official Hacienda v4.4 XSD provenance', () => {
  jest.setTimeout(30000);
  const assets = [
    HACIENDA_V44_FACTURA_ELECTRONICA,
    HACIENDA_V44_NOTA_CREDITO_LAB,
    HACIENDA_V44_NOTA_DEBITO_LAB,
  ] as const;

  it.each(assets)('pins official CDN bytes for $documentType', (asset) => {
    expect(asset.sourceUrl).toBe(
      `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/${asset.xsdFileName}`,
    );
    const bytes = readFileSync(join(process.cwd(), 'resources/hacienda/v4.4', asset.xsdFileName));
    expect(bytes.length).toBe(asset.fileSizeBytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    const xml = bytes.toString('utf8');
    expect(xml).toContain(`targetNamespace="${asset.namespace}"`);
    expect(xml).toContain('version="4.4"');
  });

  it.each(['CREDIT_NOTE', 'DEBIT_NOTE'] as const)('compiles official %s XSD', (type) => {
    expect(new Xsd11ValidatorAdapter().compileSchema(type)).toMatchObject({ isValid: true });
  });
});
