import { createHash, randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve } from 'path';

export const TEST_STORAGE_MARKER_FILE = '.billing-test-storage-marker.json';

interface TestStorageMarker {
  readonly version: 1;
  readonly runId: string;
  readonly runTokenHash: string;
  readonly rootPath: string;
  readonly expiresAt: string;
}

export interface DisposableTestStorage {
  readonly rootPath: string;
  readonly runId: string;
  dispose(): void;
}

type TestStorageEnvironment = NodeJS.ProcessEnv;

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_]{7,31}$/;
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function requireTestRun(env: TestStorageEnvironment): { runId: string; runToken: string } {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Disposable storage is available only when NODE_ENV=test.');
  }
  if (env.USE_REAL_HACIENDA === 'true') {
    throw new Error('USE_REAL_HACIENDA=true is forbidden in automated tests.');
  }
  const runId = env.BILLING_TEST_RUN_ID;
  const runToken = env.BILLING_TEST_RUN_TOKEN;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('Test storage requires a valid BILLING_TEST_RUN_ID.');
  }
  if (!runToken || !RUN_TOKEN_PATTERN.test(runToken)) {
    throw new Error('Test storage requires a temporary BILLING_TEST_RUN_TOKEN.');
  }
  return { runId, runToken };
}

export function assertRealHaciendaDisabledInTests(env: TestStorageEnvironment = process.env): void {
  if (env.NODE_ENV === 'test' && env.USE_REAL_HACIENDA === 'true') {
    throw new Error('USE_REAL_HACIENDA=true is forbidden in automated tests.');
  }
}

export function assertSafeTestLocalStorage(
  storagePath: string,
  env: TestStorageEnvironment = process.env,
): string {
  const { runId, runToken } = requireTestRun(env);
  const rootPath = resolve(storagePath);
  const tempPath = resolve(tmpdir());
  const normalStoragePath = resolve(process.cwd(), 'storage');

  if (
    rootPath === tempPath ||
    !isWithin(tempPath, rootPath) ||
    isWithin(normalStoragePath, rootPath) ||
    isWithin(rootPath, normalStoragePath)
  ) {
    throw new Error('Test storage must be an isolated child of the OS temp directory.');
  }

  let marker: TestStorageMarker;
  try {
    marker = JSON.parse(
      readFileSync(join(rootPath, TEST_STORAGE_MARKER_FILE), 'utf8'),
    ) as TestStorageMarker;
  } catch {
    throw new Error('Disposable test storage marker is missing or unreadable.');
  }

  const expiresAt = new Date(marker.expiresAt);
  if (
    marker.version !== 1 ||
    marker.runId !== runId ||
    marker.runTokenHash !== tokenHash(runToken) ||
    resolve(marker.rootPath) !== rootPath ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new Error('Disposable test storage marker does not match this run or is expired.');
  }

  return rootPath;
}

export function assertSafeTestS3Storage(
  endpoint: string | undefined,
  bucket: string,
  env: TestStorageEnvironment = process.env,
): void {
  const { runId, runToken } = requireTestRun(env);
  if (!endpoint) {
    throw new Error('Automated S3 storage tests require an explicit LocalStack endpoint.');
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Automated S3 storage tests require a valid LocalStack endpoint.');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Automated S3 storage tests may use LocalStack on a local host only.');
  }

  const expectedPrefix = 'billing-p0-' + runId + '-';
  if (!bucket.startsWith(expectedPrefix)) {
    throw new Error('Automated S3 storage tests require a run-owned bucket.');
  }
  if (env.BILLING_TEST_S3_MARKER !== tokenHash(runToken)) {
    throw new Error('Automated S3 storage tests require a marker bound to the run token.');
  }
}

export function provisionDisposableTestStorage(
  env: TestStorageEnvironment = process.env,
): DisposableTestStorage {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Disposable storage provisioning requires NODE_ENV=test.');
  }
  assertRealHaciendaDisabledInTests(env);

  const previous = {
    runId: env.BILLING_TEST_RUN_ID,
    runToken: env.BILLING_TEST_RUN_TOKEN,
    storagePath: env.LOCAL_STORAGE_PATH,
    useRealHacienda: env.USE_REAL_HACIENDA,
    s3Marker: env.BILLING_TEST_S3_MARKER,
  };
  const runId = env.BILLING_TEST_RUN_ID ?? 's0' + randomBytes(6).toString('hex');
  const runToken = env.BILLING_TEST_RUN_TOKEN ?? randomBytes(32).toString('base64url');
  env.BILLING_TEST_RUN_ID = runId;
  env.BILLING_TEST_RUN_TOKEN = runToken;
  env.USE_REAL_HACIENDA = 'false';
  requireTestRun(env);
  env.BILLING_TEST_S3_MARKER = tokenHash(runToken);

  const rootPath = mkdtempSync(join(tmpdir(), 'billing-p0-storage-' + runId + '-'));
  const marker: TestStorageMarker = {
    version: 1,
    runId,
    runTokenHash: tokenHash(runToken),
    rootPath,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
  writeFileSync(join(rootPath, TEST_STORAGE_MARKER_FILE), JSON.stringify(marker), {
    encoding: 'utf8',
    mode: 0o600,
  });
  env.LOCAL_STORAGE_PATH = rootPath;

  return {
    rootPath,
    runId,
    dispose(): void {
      assertSafeTestLocalStorage(rootPath, env);
      rmSync(rootPath, { recursive: true, force: true });
      if (previous.runId === undefined) delete env.BILLING_TEST_RUN_ID;
      else env.BILLING_TEST_RUN_ID = previous.runId;
      if (previous.runToken === undefined) delete env.BILLING_TEST_RUN_TOKEN;
      else env.BILLING_TEST_RUN_TOKEN = previous.runToken;
      if (previous.storagePath === undefined) delete env.LOCAL_STORAGE_PATH;
      else env.LOCAL_STORAGE_PATH = previous.storagePath;
      if (previous.useRealHacienda === undefined) delete env.USE_REAL_HACIENDA;
      else env.USE_REAL_HACIENDA = previous.useRealHacienda;
      if (previous.s3Marker === undefined) delete env.BILLING_TEST_S3_MARKER;
      else env.BILLING_TEST_S3_MARKER = previous.s3Marker;
    },
  };
}
