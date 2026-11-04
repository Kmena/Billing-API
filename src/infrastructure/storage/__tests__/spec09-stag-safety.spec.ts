import { isSafeSpec09ExternalMode } from '../spec09-stag-safety';
import { assertRealHaciendaDisabledInTests } from '../test-storage-safety';

const safe: NodeJS.ProcessEnv = {
  BILLING_SPEC09_STAG_INVOICING: 'true',
  USE_REAL_HACIENDA: 'true',
  FISCAL_WORKER_ENABLE_IN_TESTS: 'true',
  HACIENDA_RECEPCION_SANDBOX_BASE_URL:
    'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/',
  HACIENDA_IDP_SANDBOX_URL:
    'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
  HACIENDA_RECEPCION_PRODUCTION_BASE_URL: 'https://127.0.0.1:9/',
  HACIENDA_IDP_PRODUCTION_URL: 'https://127.0.0.1:9/',
};

it('permits only the exact STAG mode and keeps production endpoints unreachable', () => {
  expect(isSafeSpec09ExternalMode(safe)).toBe(true);
  for (const change of [
    {
      HACIENDA_RECEPCION_SANDBOX_BASE_URL:
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
    },
    {
      HACIENDA_IDP_SANDBOX_URL:
        'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    },
    {
      HACIENDA_RECEPCION_PRODUCTION_BASE_URL:
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
    },
    {
      HACIENDA_IDP_PRODUCTION_URL:
        'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    },
    { FISCAL_WORKER_ENABLE_IN_TESTS: 'false' },
    { USE_REAL_HACIENDA: 'false' },
  ])
    expect(isSafeSpec09ExternalMode({ ...safe, ...change })).toBe(false);
  expect(isSafeSpec09ExternalMode({ ...safe, BILLING_SPEC09_STAG_INVOICING: 'false' })).toBe(false);
  expect(
    isSafeSpec09ExternalMode({
      USE_REAL_HACIENDA: 'false',
      FISCAL_WORKER_ENABLE_IN_TESTS: 'false',
    }),
  ).toBe(true);
});

it('keeps disposable tests offline and permits only the guarded persistent STAG sandbox', () => {
  expect(() =>
    assertRealHaciendaDisabledInTests({
      ...safe,
      NODE_ENV: 'test',
    }),
  ).toThrow();
  expect(() =>
    assertRealHaciendaDisabledInTests({
      ...safe,
      NODE_ENV: 'test',
      BILLING_SPEC09_PERSISTENT_SANDBOX: 'true',
      SPEC09_SANDBOX_MARKER: 'billing-spec09-synthetic-v1',
    }),
  ).not.toThrow();
  expect(() =>
    assertRealHaciendaDisabledInTests({
      ...safe,
      NODE_ENV: 'test',
      BILLING_SPEC09_PERSISTENT_SANDBOX: 'true',
      SPEC09_SANDBOX_MARKER: 'billing-spec09-synthetic-v1',
      HACIENDA_RECEPCION_PRODUCTION_BASE_URL:
        'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
    }),
  ).toThrow();
});
