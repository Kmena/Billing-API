import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

describe('W2-B laboratory contract remains inactive', () => {
  it('documents the exact lab subset and keeps the v2 invoice route unregistered', () => {
    const contract = yaml.load(
      readFileSync(
        join(process.cwd(), 'docs/contracts/billing-fiscal-intent.v2.proposed.openapi.yaml'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(contract['x-status']).toBe('proposed-inactive');
    expect(contract['x-w2-b-laboratory-projection']).toMatchObject({
      routesRegistered: false,
      fiscalIssuanceEnabled: false,
      policyMarker: 'LAB_SYNTHETIC_V44_ONLY',
      hashVersion: 'w2-b-fiscal-lab.v1',
      hashUse: 'synthetic-lab-comparison-only',
      finalFiscalHashRequires: 'ADR-BIL-013',
      environment: 'SANDBOX',
      perLineTaxCount: 1,
      perLineDiscountCount: '0-1',
    });
    expect(readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8')).not.toContain(
      'fiscal-intent-v2',
    );
  });
});
