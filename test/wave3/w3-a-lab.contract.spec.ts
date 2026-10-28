import { readFileSync } from 'fs';
import { join } from 'path';
import { CONSUMER_V2_LAB_SCOPES } from '../../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import { W3_A_LAB_HASH_VERSION } from '../../src/modules/fiscal-intent-v2/w3-a-correction-projection';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

describe('W3-A corrective laboratory contract', () => {
  it('pins scopes, hash, status lookup and isolation from AppModule', () => {
    const contract = yaml.load(
      readFileSync(
        join(process.cwd(), 'docs/contracts/billing-w3-a-corrective-lab.v2.openapi.yaml'),
        'utf8',
      ),
    ) as {
      'x-status': string;
      'x-hash-version': string;
      'x-correction-ledger': string;
      servers: Array<{ url: string }>;
      components: {
        schemas: {
          CreditNoteIntent: {
            allOf: Array<{
              properties?: { mode?: { enum: string[] } };
            }>;
          };
        };
      };
      paths: Record<
        string,
        Record<string, { 'x-required-scope': string; responses: Record<string, unknown> }>
      >;
    };
    expect(contract['x-status']).toBe('lab-only-inactive-in-product');
    expect(contract['x-hash-version']).toBe(W3_A_LAB_HASH_VERSION);
    expect(contract['x-correction-ledger']).toContain('REMAINING');
    expect(contract.components.schemas.CreditNoteIntent.allOf[1].properties?.mode?.enum).toContain(
      'REMAINING',
    );
    expect(contract.servers[0].url).toBe('/api/v2/lab');
    const root = '/companies/{companyId}/fiscal-documents/{environment}';
    for (const [path, scope] of [
      ['credit-notes', 'fiscal-v2:credit-notes:create'],
      ['debit-notes', 'fiscal-v2:debit-notes:create'],
    ]) {
      const operation = contract.paths[`${root}/${path}`].post;
      expect(operation['x-required-scope']).toBe(scope);
      expect(CONSUMER_V2_LAB_SCOPES).toContain(scope);
      for (const code of ['200', '201', '202', '401', '403', '404', '409', '422'])
        expect(operation.responses).toHaveProperty(code);
    }
    expect(contract.paths[`${root}/corrective-notes/lookup`].post['x-required-scope']).toBe(
      'fiscal-v2:operations:read',
    );
    const signedXml = contract.paths[`${root}/corrective-notes/{documentId}/signed-xml`].get;
    expect(signedXml['x-required-scope']).toBe('fiscal-v2:operations:read');
    for (const code of ['200', '401', '403', '404', '422'])
      expect(signedXml.responses).toHaveProperty(code);
    expect(readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8')).not.toContain(
      'W3AFiscalLabModule',
    );
  });
});

describe('Cancellation and reversal laboratory contract', () => {
  it('keeps all seven operations in the inactive lab module with scoped M2M access', () => {
    const contract = yaml.load(
      readFileSync(
        join(process.cwd(), 'docs/contracts/billing-cancellation-reversal.v2.lab.openapi.yaml'),
        'utf8',
      ),
    ) as {
      'x-status': string;
      'x-fiscal-policy': string;
      servers: Array<{ url: string }>;
      paths: Record<
        string,
        Record<string, { 'x-required-scope': string; responses: Record<string, unknown> }>
      >;
    };
    expect(contract['x-status']).toBe('lab-only-inactive-in-product');
    expect(contract['x-fiscal-policy']).toContain('DF-06');
    expect(contract.servers[0].url).toBe('/api/v2/lab');
    const root = '/companies/{companyId}/fiscal-documents/{environment}/cancellations';
    for (const [path, method, scope] of [
      [root, 'post', 'fiscal-v2:credit-notes:create'],
      [`${root}/{workflowId}`, 'get', 'fiscal-v2:operations:read'],
      [`${root}/{workflowId}/replacement-draft`, 'post', 'fiscal-v2:invoices:create'],
      [`${root}/{workflowId}/replacement-confirmation`, 'post', 'fiscal-v2:invoices:create'],
      [`${root}/{workflowId}/reversal`, 'post', 'fiscal-v2:debit-notes:create'],
      [`${root}/{workflowId}/reversal`, 'get', 'fiscal-v2:operations:read'],
      [`${root}/{workflowId}/history`, 'get', 'fiscal-v2:operations:read'],
    ]) {
      expect(contract.paths[path][method]['x-required-scope']).toBe(scope);
      expect(CONSUMER_V2_LAB_SCOPES).toContain(scope);
      expect(contract.paths[path][method].responses).toHaveProperty('200');
    }
    expect(readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8')).not.toContain(
      'W3AFiscalLabModule',
    );
  });
});
