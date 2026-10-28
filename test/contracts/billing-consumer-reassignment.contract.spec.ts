import { readFileSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load(input: string): unknown };

describe('DP-01 proposed v2 reassignment contract', () => {
  type Operation = {
    security: Array<Record<string, string[]>>;
    requestBody: { content: { 'application/json': { schema: { $ref: string } } } };
    responses: Record<string, unknown>;
  };
  const contract = yaml.load(
    readFileSync(
      join(process.cwd(), 'docs/contracts/billing-consumers.v2.proposed.openapi.yaml'),
      'utf8',
    ),
  ) as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, { required?: string[] }> };
  };

  it('requires admin JWT and a new external issuer key', () => {
    const operation =
      contract.paths['/integrations/consumers/{consumerId}/associations/{associationId}/reassign']
        .post;
    expect(operation.security).toEqual([{ AdminJwt: [] }]);
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ReassignConsumerIssuer',
    );
    expect(contract.components.schemas.ReassignConsumerIssuer.required).toEqual([
      'targetCompanyId',
      'newExternalCompanyKey',
    ]);
    for (const status of ['200', '400', '401', '403', '404', '409', '422'])
      expect(operation.responses[status]).toBeDefined();
  });
});
