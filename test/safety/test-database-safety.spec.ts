import {
  assertSafeTestDatabase,
  installGuardedTestDatabaseEnvironment,
  TestEnvironment,
} from '../helpers/test-database-safety';

const runId = 'a1b2c3d4e5f6';
const roleName = 'billing_p0_' + runId + '_role';
const databaseName = 'billing_p0_' + runId + '_test';
const safeUrl = 'postgresql://' + roleName + ':temporary-password@127.0.0.1:55432/' + databaseName;

function validEnvironment(overrides: TestEnvironment = {}): TestEnvironment {
  return {
    NODE_ENV: 'test',
    RUN_DB_TESTS: '1',
    BILLING_TEST_DATABASE_URL: safeUrl,
    BILLING_TEST_RUN_ID: runId,
    BILLING_TEST_RUN_TOKEN: 'temporary_run_token_0123456789abcdef',
    BILLING_TEST_DATABASE_ROLE: roleName,
    USE_REAL_HACIENDA: 'false',
    ...overrides,
  };
}

describe('central fail-closed test database guard', () => {
  it('accepts only the exact marked-disposable naming and role contract', () => {
    expect(assertSafeTestDatabase(validEnvironment())).toMatchObject({
      databaseName,
      hostname: '127.0.0.1',
      port: '55432',
      roleName,
      runId,
    });
  });

  it.each([
    'billing_dev',
    'billing_prod',
    'billing_prod_test',
    'postgres',
    'template0',
    'template1',
  ])('rejects protected database %s', (name) => {
    expect(() =>
      assertSafeTestDatabase(
        validEnvironment({
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':password@127.0.0.1:55432/' + name,
        }),
      ),
    ).toThrow();
  });

  it.each(['billing_staging_test', 'billing_development_test', 'billing_production_test'])(
    'rejects database names containing protected environment fragment: %s',
    (name) => {
      expect(() =>
        assertSafeTestDatabase(
          validEnvironment({
            BILLING_TEST_DATABASE_URL:
              'postgresql://' + roleName + ':password@127.0.0.1:55432/' + name,
          }),
        ),
      ).toThrow('protected database target');
    },
  );

  it('rejects a _test suffix without the run-bound disposable name', () => {
    expect(() =>
      assertSafeTestDatabase(
        validEnvironment({
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':password@127.0.0.1:55432/billing_test',
        }),
      ),
    ).toThrow('_test suffix alone is insufficient');
  });

  it('rejects a missing explicit BILLING_TEST_DATABASE_URL', () => {
    expect(() =>
      assertSafeTestDatabase(
        validEnvironment({
          BILLING_TEST_DATABASE_URL: undefined,
          DATABASE_URL: 'postgresql://billing:password@localhost:5432/billing_dev',
        }),
      ),
    ).toThrow('DATABASE_URL is not accepted');
  });

  it('rejects DATABASE_URL=billing_dev as the only URL', () => {
    expect(() =>
      assertSafeTestDatabase({
        NODE_ENV: 'test',
        RUN_DB_TESTS: '1',
        DATABASE_URL: 'postgresql://billing:password@localhost:5432/billing_dev',
        BILLING_TEST_RUN_ID: runId,
        BILLING_TEST_RUN_TOKEN: 'temporary_run_token_0123456789abcdef',
        BILLING_TEST_DATABASE_ROLE: roleName,
      }),
    ).toThrow('BILLING_TEST_DATABASE_URL');
  });

  it('rejects NODE_ENV other than test', () => {
    expect(() => assertSafeTestDatabase(validEnvironment({ NODE_ENV: 'development' }))).toThrow(
      'NODE_ENV=test',
    );
  });

  it('rejects missing RUN_DB_TESTS', () => {
    expect(() => assertSafeTestDatabase(validEnvironment({ RUN_DB_TESTS: undefined }))).toThrow(
      'RUN_DB_TESTS=1',
    );
  });

  it('rejects a missing run ID', () => {
    expect(() =>
      assertSafeTestDatabase(validEnvironment({ BILLING_TEST_RUN_ID: undefined })),
    ).toThrow('BILLING_TEST_RUN_ID');
  });

  it('rejects a missing run token', () => {
    expect(() =>
      assertSafeTestDatabase(validEnvironment({ BILLING_TEST_RUN_TOKEN: undefined })),
    ).toThrow('BILLING_TEST_RUN_TOKEN');
  });

  it('rejects an unauthorized remote host', () => {
    expect(() =>
      assertSafeTestDatabase(
        validEnvironment({
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':password@db.example.com:5432/' + databaseName,
        }),
      ),
    ).toThrow('unauthorized test database host');
  });

  it('rejects a non-dedicated or mismatched role', () => {
    expect(() =>
      assertSafeTestDatabase(
        validEnvironment({
          BILLING_TEST_DATABASE_ROLE: 'billing',
          BILLING_TEST_DATABASE_URL:
            'postgresql://billing:password@127.0.0.1:55432/' + databaseName,
        }),
      ),
    ).toThrow('Disposable database role');
  });

  it('rejects real Hacienda mode for automated tests', () => {
    expect(() => assertSafeTestDatabase(validEnvironment({ USE_REAL_HACIENDA: 'true' }))).toThrow(
      'USE_REAL_HACIENDA=true',
    );
  });

  it('overwrites DATABASE_URL only after validation and forces mock Hacienda', () => {
    const env = validEnvironment({
      DATABASE_URL: 'postgresql://billing:password@localhost:5432/billing_dev',
      USE_REAL_HACIENDA: undefined,
    });
    installGuardedTestDatabaseEnvironment(env);
    expect(env.DATABASE_URL).toBe(safeUrl);
    expect(env.USE_REAL_HACIENDA).toBe('false');
  });
});
