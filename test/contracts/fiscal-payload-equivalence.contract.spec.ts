import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fiscal payload equivalence v1 contract publication', () => {
  const root = process.cwd();
  const canonical = readFileSync(
    join(root, 'docs', 'contracts', 'fiscal-payload-equivalence.v1.openapi.yaml'),
    'utf8',
  );
  const recovery = readFileSync(
    join(root, 'docs', 'contracts', 'fiscal-identity-evidence-lookup.v2.openapi.yaml'),
    'utf8',
  );
  const guide = readFileSync(
    join(root, 'docs', 'contracts', 'fiscal-identity-evidence-lookup.v2.integration-guide.md'),
    'utf8',
  );

  it('publishes versioned future headers and a separate historical evidence endpoint', () => {
    expect(canonical).toContain('X-Fiscal-Payload-Contract-Version');
    expect(canonical).toContain('X-Fiscal-Payload-Hash');
    expect(canonical).toContain('fiscal-payload-equivalence.v1');
    expect(recovery).toContain('identity-by-fiscal-evidence');
    expect(recovery).toContain('fiscalPayloadEquivalent');
    expect(recovery).not.toContain('fiscalPayloadHash:');
    expect(guide).toContain('Historical recovery sends the original fiscal payload');
  });
});
