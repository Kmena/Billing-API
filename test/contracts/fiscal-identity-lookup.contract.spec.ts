import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fiscal identity lookup v1 contract', () => {
  const root = process.cwd();
  const contract = readFileSync(
    join(root, 'docs', 'contracts', 'fiscal-identity-lookup.v1.openapi.yaml'),
    'utf8',
  );
  const dto = readFileSync(
    join(
      root,
      'src',
      'modules',
      'fiscal-documents',
      'infrastructure',
      'http',
      'dtos',
      'fiscal-identity-lookup.dto.ts',
    ),
    'utf8',
  );
  const controller = readFileSync(
    join(
      root,
      'src',
      'modules',
      'fiscal-documents',
      'infrastructure',
      'http',
      'fiscal-identity-lookup.controller.ts',
    ),
    'utf8',
  );
  const service = readFileSync(
    join(
      root,
      'src',
      'modules',
      'fiscal-documents',
      'application',
      'fiscal-identity-lookup.service.ts',
    ),
    'utf8',
  );

  it('publishes the implemented read-only route, DTO query names, and operations', () => {
    expect(contract).toContain(
      '/api/v1/companies/{companyId}/fiscal-documents/{environment}/identity-by-idempotency:',
    );
    expect(controller).toContain("@Get('identity-by-idempotency')");
    for (const field of ['idempotencyKey', 'operation', 'requestHash']) {
      expect(dto).toContain(`${field}!`);
      expect(contract).toContain(`name: ${field}`);
    }
    for (const operation of ['fiscal-document.create.invoice', 'fiscal-document.create.ticket']) {
      expect(dto).toContain(operation);
      expect(contract).toContain(operation);
    }
  });

  it('publishes only the actual safe success evidence and error classifications', () => {
    for (const property of [
      'fiscalDocumentId',
      'companyId',
      'environment',
      'documentType',
      'status',
      'clave',
      'consecutive',
      'idempotencyKey',
      'operation',
      'reservationStatus',
      'requestHashVerified',
    ]) {
      expect(service).toContain(`${property}:`);
      expect(contract).toContain(property);
    }
    for (const forbidden of [
      'receiverSnapshot',
      'requestHash',
      'xmlArtifacts',
      'storageKey',
      'apiKey',
    ]) {
      expect(contract).not.toMatch(new RegExp(`^\\s+${forbidden}:`, 'm'));
    }
    for (const code of [
      'FISCAL_IDENTITY_NOT_FOUND',
      'FISCAL_IDENTITY_AMBIGUOUS',
      'FISCAL_IDENTITY_INTEGRITY_ERROR',
      'INSUFFICIENT_SCOPE',
      'API_KEY_COMPANY_NOT_AUTHORIZED',
    ]) {
      expect(service).toContain(code);
    }
  });

  it('keeps the contract fixtures fictional and credential-free', () => {
    const fixtureRoot = join(root, 'docs', 'contracts', 'fixtures', 'fiscal-identity-lookup.v1');
    for (const fixture of [
      'success.json',
      'not-found.json',
      'identity-conflict.json',
      'integrity-failure.json',
      'unauthorized.json',
      'invalid-request.json',
    ]) {
      const parsed = JSON.parse(readFileSync(join(fixtureRoot, fixture), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(parsed).toBeDefined();
      expect(JSON.stringify(parsed)).not.toMatch(
        /X-API-Key|secret|password|receiverSnapshot|storageKey/i,
      );
    }
  });
});
