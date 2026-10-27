import { readFileSync } from 'fs';
import { join } from 'path';

// Same parser already used by the existing v1 contract suite; no new runtime dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

type ObjectMap = Record<string, unknown>;
type OpenApi = {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, ObjectMap>>;
  components: {
    schemas: Record<string, ObjectMap>;
    securitySchemes: Record<string, ObjectMap>;
  };
  'x-status': string;
  'x-activation-wave': string;
};

const loadYaml = (name: string) =>
  yaml.load(readFileSync(join(process.cwd(), 'docs/contracts', name), 'utf8')) as OpenApi;

const m2m = loadYaml('billing-consumers.v2.proposed.openapi.yaml');
const fiscal = loadYaml('billing-fiscal-intent.v2.proposed.openapi.yaml');
const fixture = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'docs/contracts/fixtures/billing-consumers.v2.proposed/w1-d0-synthetic-scenarios.json',
    ),
    'utf8',
  ),
) as {
  tenants: Array<{ id: string }>;
  companies: Array<{ id: string; tenantId: string }>;
  consumers: Array<{ id: string; tenantId: string }>;
  associations: Array<{
    id: string;
    consumerId: string;
    companyId: string;
    environment: string;
  }>;
  keys: Array<{ id: string; associationId: string; scopes: string[] }>;
  reservationExamples: Array<{
    associationId: string;
    environment: string;
    operation: string;
    idempotencyKey: string;
  }>;
  contractCases: Array<{
    name: string;
    operationId: string;
    keyId: string | null;
    companyId: string;
    environment: string;
    idempotencyKey?: string;
    expectedStatus: number;
  }>;
};

function operations(contract: OpenApi) {
  return Object.entries(contract.paths).flatMap(([path, verbs]) =>
    Object.entries(verbs).map(([method, operation]) => ({ path, method, operation })),
  );
}

function resolveLocalRefs(contract: OpenApi): number {
  let count = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key !== '$ref') {
        walk(value);
        continue;
      }
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^#\//);
      const parts = (value as string).slice(2).split('/');
      let target: unknown = contract;
      for (const part of parts) target = (target as ObjectMap)?.[part];
      expect(target).toBeDefined();
      count++;
    }
  };
  walk(contract);
  return count;
}

describe('W1-D0 proposed OpenAPI v2 contracts', () => {
  it('parses two versioned proposals with resolved references and no active fiscal endpoint in W1', () => {
    expect(m2m.openapi).toBe('3.1.0');
    expect(fiscal.openapi).toBe('3.1.0');
    expect(m2m.servers).toEqual([{ url: '/api/v2' }]);
    expect(fiscal.servers).toEqual([{ url: '/api/v2' }]);
    expect(m2m['x-status']).toBe('proposed');
    expect(fiscal['x-status']).toBe('proposed-inactive');
    expect(m2m['x-activation-wave']).toBe('W1-after-approval');
    expect(fiscal['x-activation-wave']).toBe('W2-after-fiscal-approval');
    expect(resolveLocalRefs(m2m)).toBeGreaterThan(50);
    expect(resolveLocalRefs(fiscal)).toBeGreaterThan(25);
    expect(Object.keys(m2m.paths)).toHaveLength(6);
    expect(Object.keys(fiscal.paths)).toEqual([
      '/companies/{companyId}/fiscal-documents/{environment}/invoices',
    ]);
    expect(JSON.stringify(m2m.paths)).not.toContain('createFiscalInvoiceV2');
  });

  it('binds administration to JWT and ordinary consumer operations to an M2M key', () => {
    const entries = operations(m2m);
    expect(entries).toHaveLength(6);
    expect(entries.map(({ operation }) => operation.operationId)).toEqual([
      'createFiscalConsumerAssociationV2',
      'getFiscalConsumerV2',
      'createFiscalConsumerKeyV2',
      'revokeFiscalConsumerKeyV2',
      'getFiscalReadinessV2',
      'lookupFiscalOperationV2',
    ]);
    for (const { path, operation } of entries) {
      expect(operation.security).toEqual([
        path.startsWith('/integrations/consumers') ? { AdminJwt: [] } : { ConsumerApiKey: [] },
      ]);
      expect(operation.responses).toHaveProperty('401');
      expect(operation.responses).toHaveProperty('403');
    }
    expect(m2m.components.securitySchemes.ConsumerApiKey).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(m2m.components.schemas.Consumer.properties).not.toHaveProperty('secret');
    expect(m2m.components.schemas.IssuedConsumerKey.properties).toHaveProperty('secret');
  });

  it('uses a read-only POST lookup and separates reservation state from official acceptance', () => {
    const path = '/companies/{companyId}/fiscal-documents/{environment}/operations/lookup';
    const lookup = m2m.paths[path].post;
    expect(m2m.paths[path]).not.toHaveProperty('get');
    expect(lookup.description).toContain('never allocates');
    expect(lookup.responses).toHaveProperty('200');
    expect(lookup.responses).toHaveProperty('202');
    expect(lookup.responses).toHaveProperty('409');
    expect(lookup.responses).toHaveProperty('404');
    expect(m2m.components.schemas.OperationLookup.properties).toHaveProperty('state');
    expect(JSON.stringify(m2m.components.schemas.OperationLookup)).not.toContain('ACCEPTED');
    for (const contract of [m2m, fiscal]) {
      expect(contract.components.schemas.Error.required).toEqual([
        'code',
        'message',
        'correlationId',
        'retryable',
      ]);
    }
  });

  it('keeps fiscal line provenance opaque and treats the two-period example as W2-only', () => {
    const operation = fiscal.paths[Object.keys(fiscal.paths)[0]].post;
    const example = ((operation.requestBody as ObjectMap).content as ObjectMap)[
      'application/json'
    ] as ObjectMap;
    const invoice = ((example.examples as ObjectMap).twoPeriodsOneAffiliation as ObjectMap)
      .value as { lines: Array<{ source: { periodId: string } }> };
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines.map((line) => line.source.periodId)).toEqual(['2026-09', '2026-10']);
    expect(fiscal.components.schemas.SourceReference.description).toContain(
      'never used by Billing',
    );
    expect(JSON.stringify(fiscal.components.schemas.InvoiceIntent)).not.toMatch(
      /balance|ledger|installment|debt|paymentAllocation/i,
    );
    expect(operation.security).toEqual([{ ConsumerApiKey: [] }]);
    expect(operation.responses).toHaveProperty('409');
    expect(operation.responses).toHaveProperty('422');
  });
});

describe('W1-D0 synthetic negative contract matrix (not runtime authorization)', () => {
  it('has consistent tenant, issuer, association and key references', () => {
    const tenants = new Set(fixture.tenants.map((item) => item.id));
    const companies = new Map(fixture.companies.map((item) => [item.id, item]));
    const consumers = new Map(fixture.consumers.map((item) => [item.id, item]));
    const associations = new Map(fixture.associations.map((item) => [item.id, item]));
    for (const company of fixture.companies) expect(tenants.has(company.tenantId)).toBe(true);
    for (const consumer of fixture.consumers) expect(tenants.has(consumer.tenantId)).toBe(true);
    for (const association of fixture.associations) {
      expect(consumers.get(association.consumerId)?.tenantId).toBe(
        companies.get(association.companyId)?.tenantId,
      );
    }
    for (const key of fixture.keys) expect(associations.has(key.associationId)).toBe(true);
    for (const reservation of fixture.reservationExamples) {
      expect(associations.get(reservation.associationId)?.environment).toBe(
        reservation.environment,
      );
    }
    expect(
      fixture.associations.filter((item) => item.companyId === fixture.companies[0].id),
    ).toHaveLength(3);
  });

  it.each(fixture.contractCases)(
    '$name declares its expected HTTP outcome in the lookup contract',
    (item) => {
      const lookup = operations(m2m).find(
        ({ operation }) => operation.operationId === item.operationId,
      )?.operation;
      expect(lookup).toBeDefined();
      expect(lookup?.responses).toHaveProperty(String(item.expectedStatus));
      expect(fixture.companies.some((company) => company.id === item.companyId)).toBe(true);
      if (item.keyId) expect(fixture.keys.some((key) => key.id === item.keyId)).toBe(true);
    },
  );

  it('covers every isolation and recovery branch without secret or production identifiers', () => {
    const names = fixture.contractCases.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'missing credential',
        'revoked credential',
        'expired credential',
        'v1 profile on v2',
        'insufficient scope',
        'other company same tenant',
        'other tenant',
        'wrong environment',
        'suspended association',
        'rotated key same namespace',
        'another consumer same issuer has no reservation',
        'another issuer has no reservation',
        'same namespace different payload',
        'uncertain external result',
      ]),
    );
    expect(JSON.stringify(fixture)).not.toMatch(/bk_(test|live)_|PRIVATE KEY|BEGIN CERTIFICATE/i);
    const namespace = (item: (typeof fixture.reservationExamples)[number]) =>
      [item.associationId, item.environment, item.operation, item.idempotencyKey].join('|');
    expect(new Set(fixture.reservationExamples.map(namespace)).size).toBe(
      fixture.reservationExamples.length,
    );
    expect(fixture.keys[0].associationId).toBe(fixture.keys[1].associationId);
    expect(fixture.keys[0].id).not.toBe(fixture.keys[1].id);
  });
});

describe('W1-D0 DBA review artifact', () => {
  it('contains catalog reads inside a read-only transaction and no write statement', () => {
    const sql = readFileSync(
      join(process.cwd(), 'docs/operations/billing-w1-d0-dba-readonly.sql'),
      'utf8',
    )
      .replace(/^--.*$/gm, '')
      .trim();
    expect(sql).toMatch(/^BEGIN TRANSACTION READ ONLY;/);
    expect(sql).toMatch(/COMMIT;$/);
    expect(sql).toContain('public._prisma_migrations');
    for (const statement of sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      expect(statement).toMatch(/^(BEGIN TRANSACTION READ ONLY|SELECT\b|COMMIT$)/);
    }
  });
});
