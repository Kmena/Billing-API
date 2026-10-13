import { readFileSync } from 'fs';
import { join } from 'path';
// js-yaml is already a transitive runtime dependency, but this repository does
// not carry its optional DefinitelyTyped package. Keep the contract test
// dependency-neutral rather than widening the production dependency graph.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

type Operation = Record<string, unknown>;
type Contract = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};

const writes = new Set([
  'provisionFiscalIssuerAssociation',
  'bootstrapInventoriFiscalIssuer',
  'updateFiscalIssuer',
  'upsertFiscalProfile',
  'setEconomicActivityEnabled',
  'selectDefaultEconomicActivity',
  'replaceHaciendaCredentials',
  'disableHaciendaConnection',
  'uploadSigningCertificate',
  'replaceSigningCertificate',
  'createFiscalBranch',
  'setFiscalBranchActive',
  'createFiscalTerminal',
  'setFiscalTerminalActive',
  'selectDefaultIssuancePoint',
  'configureInitialSequence',
  'initiateFiscalTestInvoiceV1',
]);

describe('fiscal onboarding v1 provider contract', () => {
  const contract = yaml.load(
    readFileSync(join(process.cwd(), 'docs/contracts/fiscal-onboarding.v1.openapi.yaml'), 'utf8'),
  ) as Contract;
  const fixtures = JSON.parse(
    readFileSync(
      join(process.cwd(), 'docs/contracts/fixtures/fiscal-onboarding.v1/operation-catalog.json'),
      'utf8',
    ),
  ) as { operations: Array<Record<string, unknown>> };
  const operations = Object.values(contract.paths).flatMap((path) =>
    Object.values(path).filter(
      (value) => value && typeof value === 'object' && 'operationId' in value,
    ),
  );

  it('publishes exactly 29 operations with authorization, binding, idempotency, concurrency and audit metadata', () => {
    expect(operations).toHaveLength(29);
    for (const operation of operations) {
      expect(operation.security).toBeDefined();
      expect(operation['x-idempotency']).toEqual(expect.any(String));
      expect(operation['x-concurrency']).toEqual(expect.any(String));
      expect(operation['x-audit-event']).toEqual(expect.any(String));
      expect(operation.responses).toBeDefined();
      if (operation.operationId !== 'provisionFiscalIssuerAssociation') {
        expect(operation['x-required-scope']).toEqual(expect.any(String));
        expect(operation['x-binding']).toEqual(expect.stringContaining('tenant'));
      }
      if (writes.has(String(operation.operationId))) expect(operation.requestBody).toBeDefined();
    }
  });

  it('uses explicit schemas for success responses and write requests', () => {
    for (const operation of operations) {
      const response =
        (operation.responses as Record<string, unknown>)['200'] ??
        (operation.responses as Record<string, unknown>)['201'] ??
        (operation.responses as Record<string, unknown>)['202'];
      expect(JSON.stringify(response)).toContain('#/components/schemas/');
      if (writes.has(String(operation.operationId))) {
        expect(JSON.stringify(operation.requestBody)).toMatch(
          /#\/components\/(schemas|requestBodies)\//,
        );
      }
    }
    for (const name of [
      'Issuer',
      'FiscalProfileResponse',
      'EconomicActivity',
      'TaxpayerVerification',
      'HaciendaConnection',
      'CertificateMetadata',
      'FiscalBranch',
      'FiscalTerminal',
      'IssuancePoint',
      'FiscalSequence',
      'Readiness',
      'FiscalTestInvoiceRequest',
      'FiscalTestInvoiceStatus',
    ])
      expect(contract.components.schemas[name]).toBeDefined();
  });

  it('publishes the guard error vocabulary and has no secret response fields', () => {
    const text = JSON.stringify(contract);
    for (const code of [
      'API_KEY_ENVIRONMENT_NOT_AUTHORIZED',
      'API_KEY_COMPANY_NOT_AUTHORIZED',
      'INSUFFICIENT_SCOPE',
      'INTEGRATION_PROFILE_NOT_AUTHORIZED',
      'BOOTSTRAP_PROFILE_NOT_AUTHORIZED',
    ])
      expect(text).toContain(code);
    expect(text).toContain('writeOnly');
    expect(text).not.toContain('secretReference');
    expect(text).not.toContain('certificateSecretReference');
  });

  it('ships one synthetic fixture entry per operation with success, validation, authorization, binding and conflict coverage', () => {
    expect(fixtures.operations).toHaveLength(29);
    const ids = new Set(operations.map((operation) => operation.operationId));
    for (const fixture of fixtures.operations) {
      expect(ids.has(fixture.operationId)).toBe(true);
      expect(contract.components.schemas[String(fixture.successSchema)]).toBeDefined();
      for (const field of [
        'validRequest',
        'validationFailure',
        'authorizationFailure',
        'bindingMismatch',
        'conflict',
      ])
        expect(fixture).toHaveProperty(field);
    }
    const text = JSON.stringify(fixtures);
    expect(text).not.toMatch(/bk_(test|live)_/i);
    expect(text).not.toMatch(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/);
  });
});
