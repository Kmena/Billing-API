import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export type TestEnvironment = Record<string, string | undefined>;

export interface GuardedTestDatabase {
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly hostname: string;
  readonly port: string;
  readonly roleName: string;
  readonly runId: string;
  readonly runTokenHash: string;
}

interface DisposableDatabaseMarkerRow {
  readonly run_id: string;
  readonly run_token_hash: string;
  readonly database_name: string;
  readonly role_name: string;
  readonly expires_at: Date;
}

export const TEST_DATABASE_MARKER_TABLE = 'billing_test_safety.marker';
export const TEST_TENANT_OWNERSHIP_TABLE = 'billing_test_safety.tenant_ownership';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const LOCAL_TEST_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const FORBIDDEN_DATABASE_NAMES = new Set([
  'billing_dev',
  'billing_prod',
  'postgres',
  'template0',
  'template1',
]);
const FORBIDDEN_DATABASE_FRAGMENTS = ['dev', 'prod', 'staging'];
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_]{7,31}$/;
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function hashRunToken(runToken: string): string {
  return createHash('sha256').update(runToken, 'utf8').digest('hex');
}

function valuesMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function allowedHosts(env: TestEnvironment): ReadonlySet<string> {
  const hosts = new Set(LOCAL_TEST_HOSTS);
  if (env.CI === 'true' && env.BILLING_TEST_ALLOWED_HOSTS) {
    for (const host of env.BILLING_TEST_ALLOWED_HOSTS.split(',')) {
      const normalized = host.trim().toLowerCase();
      if (normalized) hosts.add(normalized);
    }
  }
  return hosts;
}

export function assertSafeTestDatabase(env: TestEnvironment = process.env): GuardedTestDatabase {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Database-backed tests require NODE_ENV=test.');
  }
  if (env.RUN_DB_TESTS !== '1') {
    throw new Error('Database-backed tests require RUN_DB_TESTS=1.');
  }
  const databaseUrl = env.BILLING_TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Database-backed tests require BILLING_TEST_DATABASE_URL; DATABASE_URL is not accepted.',
    );
  }
  const runId = env.BILLING_TEST_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      'Database-backed tests require BILLING_TEST_RUN_ID matching /^[a-z0-9][a-z0-9_]{7,31}$/.',
    );
  }
  const runToken = env.BILLING_TEST_RUN_TOKEN;
  if (!runToken || !RUN_TOKEN_PATTERN.test(runToken)) {
    throw new Error('Database-backed tests require a temporary BILLING_TEST_RUN_TOKEN.');
  }
  const roleName = env.BILLING_TEST_DATABASE_ROLE;
  if (!roleName) {
    throw new Error('Database-backed tests require BILLING_TEST_DATABASE_ROLE.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('BILLING_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('BILLING_TEST_DATABASE_URL must use a PostgreSQL URL.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts(env).has(hostname)) {
    throw new Error(
      'Refusing unauthorized test database host: ' + (hostname || '(missing host)') + '.',
    );
  }

  const databaseName = decodeURIComponent(parsed.pathname)
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (!databaseName) {
    throw new Error('BILLING_TEST_DATABASE_URL must include a database name.');
  }
  if (
    FORBIDDEN_DATABASE_NAMES.has(databaseName) ||
    FORBIDDEN_DATABASE_FRAGMENTS.some((fragment) => databaseName.includes(fragment))
  ) {
    throw new Error('Refusing protected database target: ' + databaseName + '.');
  }

  const expectedDatabaseName = 'billing_p0_' + runId + '_test';
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      'Disposable database must be named ' +
        expectedDatabaseName +
        '; a _test suffix alone is insufficient.',
    );
  }

  const username = decodeURIComponent(parsed.username);
  const expectedRoleName = 'billing_p0_' + runId + '_role';
  if (roleName !== expectedRoleName || username !== roleName) {
    throw new Error(
      'Disposable database role must be ' + expectedRoleName + ' and match the URL username.',
    );
  }
  if (roleName === 'postgres' || roleName === 'billing') {
    throw new Error('Shared or administrative PostgreSQL roles are forbidden for DB-backed tests.');
  }
  if (env.USE_REAL_HACIENDA === 'true') {
    throw new Error('USE_REAL_HACIENDA=true is forbidden in automated tests.');
  }

  return {
    databaseUrl,
    databaseName,
    hostname,
    port: parsed.port || '5432',
    roleName,
    runId,
    runTokenHash: hashRunToken(runToken),
  };
}

export function installGuardedTestDatabaseEnvironment(
  env: TestEnvironment = process.env,
): GuardedTestDatabase {
  const guarded = assertSafeTestDatabase(env);
  env.DATABASE_URL = guarded.databaseUrl;
  env.USE_REAL_HACIENDA = 'false';
  return guarded;
}

export async function assertDisposableDatabaseMarker(
  prisma: PrismaClient,
  env: TestEnvironment = process.env,
): Promise<GuardedTestDatabase> {
  const guarded = assertSafeTestDatabase(env);
  let rows: DisposableDatabaseMarkerRow[];
  try {
    rows = await prisma.$queryRaw<DisposableDatabaseMarkerRow[]>(
      Prisma.raw(
        'SELECT run_id, run_token_hash, database_name, role_name, expires_at ' +
          'FROM billing_test_safety.marker WHERE marker_id = 1',
      ),
    );
  } catch {
    throw new Error('Disposable database marker is missing or unreadable.');
  }
  if (rows.length !== 1) {
    throw new Error('Disposable database marker must contain exactly one active marker.');
  }
  const marker = rows[0];
  const expiresAt = new Date(marker.expires_at);
  if (
    !valuesMatch(marker.run_id, guarded.runId) ||
    !valuesMatch(marker.run_token_hash, guarded.runTokenHash) ||
    !valuesMatch(marker.database_name, guarded.databaseName) ||
    !valuesMatch(marker.role_name, guarded.roleName) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new Error(
      'Disposable database marker does not match the current run/token or is expired.',
    );
  }
  return guarded;
}

export function assertWave7FinalValidationDatabase(
  env: TestEnvironment = process.env,
): GuardedTestDatabase {
  return assertSafeTestDatabase(env);
}
