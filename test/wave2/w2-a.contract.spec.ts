import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeW2AInvoiceIntent } from '../../src/modules/fiscal-intent-v2/w2-a-structural-intent';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

const contract = yaml.load(
  readFileSync(
    join(process.cwd(), 'docs/contracts/billing-fiscal-intent.v2.proposed.openapi.yaml'),
    'utf8',
  ),
) as {
  'x-status': string;
  'x-w2-a-structural-implementation': Record<string, unknown>;
  components: {
    schemas: Record<
      string,
      {
        properties: Record<string, Record<string, unknown>>;
        minProperties?: number;
        pattern?: string;
      }
    >;
  };
  paths: Record<
    string,
    {
      post: {
        security: unknown;
        responses: Record<string, unknown>;
        requestBody: {
          content: Record<string, { examples: Record<string, { value: unknown }> }>;
        };
      };
    }
  >;
};

describe('W2-A proposed fiscal intent contract', () => {
  it('keeps the fiscal POST proposed and absent from the production app', () => {
    expect(contract['x-status']).toBe('proposed-inactive');
    expect(contract['x-w2-a-structural-implementation']).toMatchObject({
      routesRegistered: false,
      fiscalIssuanceEnabled: false,
      hashVersion: 'w2-a-structural.v1',
      hashUse: 'synthetic-comparison-only',
      finalFiscalHashRequires: 'ADR-BIL-013',
      taxCodesValidated: false,
      taxArithmeticValidated: false,
    });
    const appModule = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(appModule).not.toContain('fiscal-intent-v2');
    expect(appModule).not.toContain('W2AInvoiceIntentDto');
  });

  it('declares limits matching the structural DTO without approving tax codes', () => {
    const schemas = contract.components.schemas;
    const line = schemas.FiscalLine;
    const invoice = schemas.InvoiceIntent;
    expect(invoice.properties.lines).toMatchObject({ minItems: 1, maxItems: 1000 });
    expect(line.properties.lineNumber).toMatchObject({ minimum: 1, maximum: 1000 });
    expect(line.properties.discounts.maxItems).toBe(5);
    expect(line.properties.taxes.maxItems).toBe(20);
    expect(invoice.properties.paymentMethods.maxItems).toBe(4);
    expect(invoice.properties.fiscalReferences.maxItems).toBe(10);
    expect(line.properties.priceInputMode['x-w2-a-accepted']).toEqual(['EXCLUSIVE']);
    expect(schemas.DeclaredTax.properties).not.toHaveProperty('exemptionDocument');
    expect(schemas.SourceReference.properties).not.toHaveProperty('balance');
    expect(schemas.SourceReference.minProperties).toBe(1);
    expect(new RegExp(String(schemas.Decimal.pattern)).test('1.12345678901')).toBe(false);
    expect(new RegExp(String(schemas.Quantity.pattern)).test('0.0000')).toBe(false);
  });

  it('normalizes the two-period example as structure only', () => {
    const endpoint =
      contract.paths['/companies/{companyId}/fiscal-documents/{environment}/invoices'];
    const operation = endpoint.post;
    expect(endpoint).not.toHaveProperty('get');
    expect(operation.security).toEqual([{ ConsumerApiKey: [] }]);
    expect(operation.responses).toHaveProperty('400');
    expect(operation.responses).toHaveProperty('422');
    expect(operation.responses).toHaveProperty('409');
    const example =
      operation.requestBody.content['application/json'].examples.twoPeriodsOneAffiliation.value;
    const { intent, structuralTotals } = normalizeW2AInvoiceIntent(example);
    expect(intent.lines.map((line) => line.source?.periodId)).toEqual(['2026-09', '2026-10']);
    expect(structuralTotals.gross).toBe('2000');
    expect(structuralTotals.declaredTax).toBe('0');
    expect(JSON.stringify(example)).toContain('pending-');
  });

  it('retains exactly C01–C54 with audited states while adding W2-A evidence', () => {
    const trace = readFileSync(
      join(process.cwd(), 'docs/design/billing-w2-capability-traceability-2026-10-27.md'),
      'utf8',
    );
    const auditedTable = trace.split('## Evidencia W2-A')[0];
    const ids = [...auditedTable.matchAll(/^\| (C\d{2}) \|/gm)].map((match) => match[1]);
    expect(ids).toEqual(
      Array.from({ length: 54 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`),
    );
    expect(trace).toContain('w2-a-structural.v1');
    expect(trace).toContain('C54 | NOT_APPLICABLE');
  });
});
