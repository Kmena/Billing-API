import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };
const contract = yaml.load(
  readFileSync(
    join(process.cwd(), 'docs/contracts/billing-consumers.v2.proposed.openapi.yaml'),
    'utf8',
  ),
) as {
  'x-status': string;
  'x-credential-policy': Record<string, unknown>;
  components: {
    schemas: Record<
      string,
      { required?: string[]; properties: Record<string, Record<string, unknown>> }
    >;
    securitySchemes: Record<string, Record<string, unknown>>;
    responses: Record<string, { description: string }>;
  };
  paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>>;
};
const fixture = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'docs/contracts/fixtures/billing-consumers.v2.proposed/w1-d0-synthetic-scenarios.json',
    ),
    'utf8',
  ),
) as {
  keys: Array<{ profile: string; scopes: string[] }>;
  contractCases: Array<{ name: string; expectedStatus: number }>;
};

describe('W1-D1 proposal contract lock, inactive until persistence approval', () => {
  it('requires hash and version on lookup with a non-disclosing 404', () => {
    const request = contract.components.schemas.OperationLookupRequest;
    expect(request.required).toEqual([
      'operation',
      'idempotencyKey',
      'requestHashVersion',
      'requestHash',
    ]);
    expect(request.properties.requestHash.pattern).toBe('^[a-fA-F0-9]{64}$');
    const lookup =
      contract.paths['/companies/{companyId}/fiscal-documents/{environment}/operations/lookup']
        .post;
    expect(lookup.responses['404']).toEqual({ $ref: '#/components/responses/NotFound' });
    expect(contract.components.responses.NotFound.description).toMatch(/hash\/version mismatch/i);
    expect(
      fixture.contractCases.find((item) => item.name === 'same namespace different payload')
        ?.expectedStatus,
    ).toBe(404);
  });

  it('isolates the v2 key profile, W1 scopes and key policy', () => {
    expect(contract['x-status']).toBe('proposed');
    expect(contract.components.schemas.IssuedConsumerKey.required).toContain('integrationProfile');
    expect(contract.components.schemas.IssuedConsumerKey.properties.integrationProfile.const).toBe(
      'billing-consumer-v2',
    );
    const key = contract.components.schemas.CreateConsumerKey;
    expect(key.properties.scopes.items).toMatchObject({
      enum: ['fiscal-v2:readiness:read', 'fiscal-v2:operations:read'],
    });
    expect(
      fixture.keys.filter((item) => item.profile === 'billing-consumer-v2').length,
    ).toBeGreaterThan(0);
    expect(contract['x-credential-policy']).toMatchObject({
      steadyActiveKeysPerAssociation: 1,
      maximumActiveKeysDuringRotation: 2,
      rotationIntervalDaysInitialReference: 90,
    });
  });
});
