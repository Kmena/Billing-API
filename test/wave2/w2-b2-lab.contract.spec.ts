import { readFileSync } from 'fs';
import { join } from 'path';
import { CONSUMER_V2_LAB_SCOPES } from '../../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import {
  W2B_LAB_HASH_VERSION,
  W2B_LAB_POLICY,
} from '../../src/modules/fiscal-intent-v2/w2-b-lab-projection';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };
type LabContract = {
  'x-status': string;
  'x-hash-version': string;
  'x-policy-marker': string;
  servers: Array<{ url: string }>;
  paths: Record<
    string,
    { post: { 'x-required-scope': string; responses: Record<string, unknown> } }
  >;
  components: { parameters: { Environment: { schema: { const: string } } } };
};

describe('W2-B2 lab contract and product isolation', () => {
  it('binds the synthetic endpoint, scope and hash version without activating product routes', () => {
    const contract = yaml.load(
      readFileSync(join(process.cwd(), 'docs/contracts/billing-w2-b2-lab.v2.openapi.yaml'), 'utf8'),
    ) as LabContract;
    expect(contract['x-status']).toBe('lab-only-inactive-in-product');
    expect(contract['x-hash-version']).toBe(W2B_LAB_HASH_VERSION);
    expect(contract['x-policy-marker']).toBe(W2B_LAB_POLICY);
    expect(contract.servers[0].url).toBe('/api/v2/lab');
    const create =
      contract.paths['/companies/{companyId}/fiscal-documents/{environment}/invoices'].post;
    expect(create['x-required-scope']).toBe('fiscal-v2:invoices:create');
    expect(CONSUMER_V2_LAB_SCOPES).toContain(create['x-required-scope']);
    expect(create.responses).toHaveProperty('202');
    expect(create.responses).toHaveProperty('409');
    expect(contract.components.parameters.Environment.schema.const).toBe('SANDBOX');
    const appModule = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(appModule).not.toContain('W2B2FiscalLabModule');
    const proposed = yaml.load(
      readFileSync(
        join(process.cwd(), 'docs/contracts/billing-fiscal-intent.v2.proposed.openapi.yaml'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(proposed['x-status']).toBe('proposed-inactive');
  });
});
