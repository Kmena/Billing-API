import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  assessParameterState,
  assertLocalStackEndpoint,
  buildExpectedReferences,
} from '../dev-restore-hacienda-sandbox-secrets.mjs';

test('accepts only the local LocalStack SSM endpoint', () => {
  assert.equal(assertLocalStackEndpoint('http://localhost:4566').hostname, 'localhost');
  assert.throws(
    () => assertLocalStackEndpoint('https://ssm.us-east-1.amazonaws.com'),
    /LocalStack endpoint/,
  );
  assert.throws(
    () => assertLocalStackEndpoint('http://localhost:4567'),
    /LocalStack endpoint/,
  );
});

test('constructs deterministic existing Billing secret references', () => {
  assert.deepEqual(buildExpectedReferences('company-id', 'fingerprint'), {
    connection: 'hacienda-conn/company-id/SANDBOX',
    certificate: 'fiscal-certs/company-id/sandbox/cert-fingerprint',
    pin: 'fiscal-certs/company-id/sandbox/pin-fingerprint',
  });
});

test('allows restore only when all parameters are absent', () => {
  const names = ['/billing/dev/a', '/billing/dev/b', '/billing/dev/c'];
  assert.equal(assessParameterState(names, { Parameters: [], InvalidParameters: names }), 'RESTORE');
  assert.throws(
    () => assessParameterState(names, { Parameters: [{ Name: names[0] }], InvalidParameters: names.slice(1) }),
    /conflicts/,
  );
});


test('fails closed when a required local secret is absent', () => {
  const require = createRequire(import.meta.url);
  const { requireLocalSecret } = require('../local-secret-env.cjs');
  const key = 'BILLING_TEST_REQUIRED_LOCAL_SECRET';
  const previous = process.env[key];
  delete process.env[key];
  try {
    assert.throws(() => requireLocalSecret(key), /Missing required local secret/);
    process.env[key] = 'test-only-sentinel';
    assert.equal(requireLocalSecret(key), 'test-only-sentinel');
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
test('Hacienda operational scripts have no inline credentials or response-body logging', () => {
  const files = [
    'scripts/configure-hacienda-connection.js',
    'scripts/validate-hacienda-connection.js',
    'scripts/dev-restore-cert.mjs',
    'scripts/dev-restore-hacienda-sandbox-secrets.mjs',
  ];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /password\s*:\s*['"][^'"]+['"]/i, file);
    assert.doesNotMatch(source, /(?:PASSWORD|PIN|SECRET)\s*=\s*['"][^'"]+['"]/i, file);
    assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:\.body|accessToken)/i, file);
    assert.doesNotMatch(source, /process\.(?:stdout|stderr)\.write\([^\n]*(?:\.body|accessToken)/i, file);
  }
});


test('credential rotation requires an explicit local opt-in', () => {
  const source = readFileSync('scripts/configure-hacienda-connection.js', 'utf8');
  assert.match(source, /ALLOW_HACIENDA_SANDBOX_CREDENTIAL_ROTATION/);
});
