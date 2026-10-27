import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

describe('W1-D2 lab boundary and additive migration contract', () => {
  it('keeps the v2 lab module and fiscal issuance absent from the production app', () => {
    const appModule = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(appModule).not.toContain('FiscalConsumersLabModule');
    const contract = yaml.load(
      readFileSync(
        join(process.cwd(), 'docs/contracts/billing-consumers.v2.proposed.openapi.yaml'),
        'utf8',
      ),
    ) as {
      'x-status': string;
      'x-laboratory-implementation': Record<string, unknown>;
    };
    expect(contract['x-status']).toBe('proposed');
    expect(contract['x-laboratory-implementation']).toMatchObject({
      wave: 'W1-D2',
      moduleRegisteredInAppModule: false,
      operationalRoutesActive: false,
      fiscalIssuanceActive: false,
      persistenceVerification: 'disposable-postgresql-only',
    });
  });

  it('adds exactly five v2 tables without rewriting v1 association or reservation rows', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20261114000000_w1_d2_consumer_m2m_lab/migration.sql'),
      'utf8',
    );
    expect(
      sql.match(/CREATE TABLE fiscal_(?:consumer|idempotency_keys_v2)[a-z_]* \(/g),
    ).toHaveLength(5);
    expect(sql).not.toMatch(
      /ALTER TABLE fiscal_integration_associations|ALTER TABLE fiscal_idempotency_keys\b/i,
    );
    expect(sql).not.toMatch(/\bUPDATE fiscal_documents\b|\bDELETE FROM fiscal_documents\b/i);
    expect(sql).toContain('fiscal_documents_v2_origin_pair_check');
    expect(sql).toContain('fiscal_idempotency_keys_v2_namespace_key');
  });
});
