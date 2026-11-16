import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { HACIENDA_V44_NOTA_CREDITO } from '../../../domain/fiscal-xml/hacienda-v44-contract';
import { Xsd11ValidatorAdapter } from '../xsd11-validator.adapter';

describe('W4-B-R1 pinned NC schema', () => {
  const schemaPath = join(
    process.cwd(),
    'resources',
    'hacienda',
    'v4.4',
    HACIENDA_V44_NOTA_CREDITO.xsdFileName,
  );

  it('matches the pinned official bytes', () => {
    expect(statSync(schemaPath).size).toBe(HACIENDA_V44_NOTA_CREDITO.fileSizeBytes);
    expect(createHash('sha256').update(readFileSync(schemaPath)).digest('hex')).toBe(
      HACIENDA_V44_NOTA_CREDITO.sha256,
    );
  });

  it('compiles the NC XSD with the local XSD 1.1 engine', () => {
    expect(new Xsd11ValidatorAdapter().compileSchema('CREDIT_NOTE')).toMatchObject({
      isValid: true,
      schemaVersion: 'v4.4',
      errors: [],
    });
  });
});
