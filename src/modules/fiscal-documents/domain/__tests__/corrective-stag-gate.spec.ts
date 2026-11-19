import { correctiveStagAllowed } from '../corrective-stag-gate';

const keys = [
  'NODE_ENV', 'CORRECTIVE_NOTES_STAG_ENABLED', 'USE_REAL_HACIENDA',
  'EMAIL_USE_REAL', 'HACIENDA_RECEPCION_SANDBOX_BASE_URL',
  'HACIENDA_RECEPCION_PRODUCTION_BASE_URL',
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

it('keeps corrective issuance blocked without explicit STAG configuration', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.CORRECTIVE_NOTES_STAG_ENABLED;
  expect(correctiveStagAllowed('CREDIT_NOTE', 'SANDBOX')).toBe(false);
});

it('allows only sandbox credit notes with the isolated STAG route and no email', () => {
  Object.assign(process.env, {
    NODE_ENV: 'production', CORRECTIVE_NOTES_STAG_ENABLED: 'true',
    USE_REAL_HACIENDA: 'true', EMAIL_USE_REAL: 'false',
    HACIENDA_RECEPCION_SANDBOX_BASE_URL:
      'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
    HACIENDA_RECEPCION_PRODUCTION_BASE_URL: 'https://127.0.0.1:9/',
  });
  expect(correctiveStagAllowed('CREDIT_NOTE', 'SANDBOX')).toBe(true);
  expect(correctiveStagAllowed('CREDIT_NOTE', 'PRODUCTION')).toBe(false);
  expect(correctiveStagAllowed('DEBIT_NOTE', 'SANDBOX')).toBe(false);
  process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL =
    'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
  expect(correctiveStagAllowed('CREDIT_NOTE', 'SANDBOX')).toBe(false);
});
