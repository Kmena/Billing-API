import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { HaciendaOidcAuthAdapter } from '../../../../hacienda-connection/infrastructure/auth/hacienda-oidc-auth.adapter';
import { selectSpec09CredentialVerifier } from '../spec09-credential-verifier';

const names = [
  'SPEC09_CREDENTIAL_VALIDATION_MODE',
  'NODE_ENV',
  'BILLING_SPEC09_PERSISTENT_SANDBOX',
  'SPEC09_SANDBOX_MARKER',
  'USE_REAL_HACIENDA',
  'HACIENDA_IDP_SANDBOX_URL',
  'HACIENDA_IDP_CLIENT_ID_SANDBOX',
] as const;
const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const config = {
  get: () => ({
    idp: {
      sandboxTokenUrl:
        'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
      sandboxClientId: 'api-stag',
    },
    authTimeoutMs: 10000,
  }),
} as unknown as ConfigService;
const http = {} as HttpService;

afterEach(() => {
  for (const name of names) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
});

it('defaults to disabled and rejects a fixture in the persistent sandbox', () => {
  delete process.env.SPEC09_CREDENTIAL_VALIDATION_MODE;
  expect(selectSpec09CredentialVerifier(config, http)).toBeNull();
  process.env.SPEC09_CREDENTIAL_VALIDATION_MODE = 'fixture';
  process.env.NODE_ENV = 'test';
  process.env.BILLING_SPEC09_PERSISTENT_SANDBOX = 'true';
  expect(() => selectSpec09CredentialVerifier(config, http)).toThrow(
    'SPEC09_CREDENTIAL_FIXTURE_GUARD',
  );
});

it('permits only the official staging IDP with the issuance adapter disabled', () => {
  process.env.SPEC09_CREDENTIAL_VALIDATION_MODE = 'sandbox';
  process.env.NODE_ENV = 'test';
  process.env.BILLING_SPEC09_PERSISTENT_SANDBOX = 'true';
  process.env.SPEC09_SANDBOX_MARKER = 'billing-spec09-synthetic-v1';
  process.env.USE_REAL_HACIENDA = 'false';
  delete process.env.HACIENDA_IDP_SANDBOX_URL;
  delete process.env.HACIENDA_IDP_CLIENT_ID_SANDBOX;
  expect(selectSpec09CredentialVerifier(config, http)).toBeInstanceOf(HaciendaOidcAuthAdapter);
  process.env.USE_REAL_HACIENDA = 'true';
  expect(() => selectSpec09CredentialVerifier(config, http)).toThrow(
    'SPEC09_CREDENTIAL_SANDBOX_GUARD',
  );
  process.env.USE_REAL_HACIENDA = 'false';
  process.env.HACIENDA_IDP_SANDBOX_URL = 'https://example.test/token';
  expect(() => selectSpec09CredentialVerifier(config, http)).toThrow(
    'SPEC09_CREDENTIAL_SANDBOX_GUARD',
  );
});
