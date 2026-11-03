import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  assertRealHaciendaDisabledInTests,
  assertSafeTestLocalStorage,
  assertSafeTestS3Storage,
  assertSafeSpec09SandboxStorage,
  provisionDisposableTestStorage,
} from '../../src/infrastructure/storage/test-storage-safety';

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    BILLING_TEST_RUN_ID: 's0storage001',
    BILLING_TEST_RUN_TOKEN: 'A'.repeat(32),
    USE_REAL_HACIENDA: 'false',
  };
}

describe('test storage safety', () => {
  it('rejects normal Billing storage', () => {
    expect(() =>
      assertSafeTestLocalStorage(resolve(process.cwd(), 'storage'), baseEnvironment()),
    ).toThrow('isolated child');
  });

  it('rejects a path overlapping the normal Billing storage tree', () => {
    expect(() => assertSafeTestLocalStorage(resolve(process.cwd()), baseEnvironment())).toThrow(
      'isolated child',
    );
  });

  it('rejects an unmarked OS temp directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'billing-p0-unmarked-'));
    try {
      expect(() => assertSafeTestLocalStorage(directory, baseEnvironment())).toThrow(
        'marker is missing',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects another run ownership identity', () => {
    const env = baseEnvironment();
    const lease = provisionDisposableTestStorage(env);
    try {
      expect(() =>
        assertSafeTestLocalStorage(lease.rootPath, {
          ...env,
          BILLING_TEST_RUN_ID: 's0storage999',
        }),
      ).toThrow('does not match');
    } finally {
      lease.dispose();
    }
  });

  it('accepts marked run-owned disposable local storage', () => {
    const env = baseEnvironment();
    const lease = provisionDisposableTestStorage(env);
    try {
      expect(assertSafeTestLocalStorage(lease.rootPath, env)).toBe(lease.rootPath);
    } finally {
      lease.dispose();
    }
  });

  it('rejects real Hacienda in automated tests', () => {
    expect(() =>
      assertRealHaciendaDisabledInTests({
        ...baseEnvironment(),
        USE_REAL_HACIENDA: 'true',
      }),
    ).toThrow('forbidden');
  });

  it('accepts only local run-owned S3 configuration with a token marker', () => {
    const env = baseEnvironment();
    const marker = createHash('sha256')
      .update(env.BILLING_TEST_RUN_TOKEN as string, 'utf8')
      .digest('hex');
    const marked = { ...env, BILLING_TEST_S3_MARKER: marker };
    expect(() =>
      assertSafeTestS3Storage('http://127.0.0.1:4566', 'billing-p0-s0storage001-artifacts', marked),
    ).not.toThrow();
    expect(() =>
      assertSafeTestS3Storage(
        'https://s3.amazonaws.com',
        'billing-p0-s0storage001-artifacts',
        marked,
      ),
    ).toThrow('local host only');
  });

  it('keeps persistent SPEC-09 storage closed for production, Hacienda and other databases', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      BILLING_SPEC09_PERSISTENT_SANDBOX: 'true',
      SPEC09_SANDBOX_MARKER: 'billing-spec09-synthetic-v1',
      USE_REAL_HACIENDA: 'false',
      FISCAL_WORKER_ENABLE_IN_TESTS: 'false',
      SECRET_PROVIDER: 'local-encrypted',
      LOCAL_STORAGE_REQUIRED_MARKER: '.billing-spec09-sandbox-root',
      DATABASE_URL: 'postgresql://billing_sandbox:x@billing-spec09-db:5432/billing_sandbox',
    };
    const path = '/run/spec09-fiscal-storage/data';
    expect(() => assertSafeSpec09SandboxStorage(path, { ...env, NODE_ENV: 'production' })).toThrow(
      'SPEC09_SANDBOX_STORAGE_GUARD',
    );
    expect(() =>
      assertSafeSpec09SandboxStorage(path, { ...env, USE_REAL_HACIENDA: 'true' }),
    ).toThrow('SPEC09_SANDBOX_STORAGE_GUARD');
    expect(() =>
      assertSafeSpec09SandboxStorage(path, {
        ...env,
        DATABASE_URL: 'postgresql://billing_sandbox:x@billing-spec09-db:5432/billing_prod',
      }),
    ).toThrow('SPEC09_SANDBOX_STORAGE_GUARD');
    expect(() =>
      assertSafeSpec09SandboxStorage(path, {
        ...env,
        DATABASE_URL: 'postgresql://billing_sandbox:x@postgres:5432/billing_sandbox',
      }),
    ).toThrow('SPEC09_SANDBOX_STORAGE_GUARD');
    expect(() => assertSafeSpec09SandboxStorage('/app/storage', env)).toThrow(
      'SPEC09_SANDBOX_STORAGE_GUARD',
    );
  });
});
