import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const IMAGE = 'postgres:15-alpine';
const SAFETY_LABEL = 'com.billing.test-safety';
const RUN_LABEL = 'com.billing.test-run-id';
const EXPIRES_LABEL = 'com.billing.test-expires-at';
const STORAGE_MARKER_FILE = '.billing-test-storage-marker.json';

function secret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

function sanitize(value, secrets) {
  let output = String(value ?? '');
  for (const item of secrets) {
    if (item) output = output.split(item).join('[REDACTED]');
  }
  return output;
}

function docker(args, secrets = [], allowFailure = false) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      'Docker command failed: ' +
        sanitize(result.stderr || result.stdout || 'unknown error', secrets).trim(),
    );
  }
  return result;
}

function waitForPostgres(containerName, bootstrapRole, secrets) {
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = docker(
      ['exec', containerName, 'pg_isready', '-U', bootstrapRole, '-d', 'postgres'],
      secrets,
      true,
    );
    consecutiveReadyChecks = result.status === 0 ? consecutiveReadyChecks + 1 : 0;
    if (consecutiveReadyChecks >= 3) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('Disposable PostgreSQL did not become stably ready.');
}

function psql(containerName, role, database, sql, secrets, password) {
  docker(
    [
      'exec',
      '-e',
      'PGPASSWORD=' + password,
      containerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      role,
      '-d',
      database,
      '-c',
      sql,
    ],
    secrets,
  );
}

export function provisionDisposablePostgres() {
  const runId = 'p0' + randomBytes(6).toString('hex');
  const databaseName = 'billing_p0_' + runId + '_test';
  const roleName = 'billing_p0_' + runId + '_role';
  const containerName = 'billing-p0-' + runId;
  const bootstrapRole = 'billing_p0_bootstrap';
  const bootstrapPassword = secret();
  const rolePassword = secret();
  const runToken = secret(32);
  const runTokenHash = createHash('sha256').update(runToken, 'utf8').digest('hex');
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const secrets = [bootstrapPassword, rolePassword, runToken];

  docker(
    [
      'run',
      '--detach',
      '--name',
      containerName,
      '--label',
      SAFETY_LABEL + '=true',
      '--label',
      RUN_LABEL + '=' + runId,
      '--label',
      EXPIRES_LABEL + '=' + expiresAt,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
      '-e',
      'POSTGRES_DB=postgres',
      '-e',
      'POSTGRES_USER=' + bootstrapRole,
      '-e',
      'POSTGRES_PASSWORD=' + bootstrapPassword,
      '-p',
      '127.0.0.1::5432',
      IMAGE,
    ],
    secrets,
  );

  try {
    waitForPostgres(containerName, bootstrapRole, secrets);
    psql(
      containerName,
      bootstrapRole,
      'postgres',
      'CREATE ROLE "' +
        roleName +
        '" LOGIN PASSWORD \'' +
        rolePassword +
        '\' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;',
      secrets,
      bootstrapPassword,
    );
    psql(
      containerName,
      bootstrapRole,
      'postgres',
      'CREATE DATABASE "' + databaseName + '" OWNER "' + roleName + '";',
      secrets,
      bootstrapPassword,
    );

    const markerSql =
      'CREATE SCHEMA billing_test_safety; ' +
      'CREATE TABLE billing_test_safety.marker (' +
      'marker_id smallint PRIMARY KEY CHECK (marker_id = 1), ' +
      'run_id text NOT NULL, run_token_hash char(64) NOT NULL, ' +
      'database_name text NOT NULL, role_name text NOT NULL, ' +
      'created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL); ' +
      'CREATE TABLE billing_test_safety.tenant_ownership (' +
      'tenant_id uuid PRIMARY KEY, run_id text NOT NULL, ' +
      'run_token_hash char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ' +
      'expires_at timestamptz NOT NULL); ' +
      'INSERT INTO billing_test_safety.marker ' +
      '(marker_id, run_id, run_token_hash, database_name, role_name, created_at, expires_at) VALUES ' +
      "(1, '" +
      runId +
      "', '" +
      runTokenHash +
      "', '" +
      databaseName +
      "', '" +
      roleName +
      "', now(), '" +
      expiresAt +
      "');";
    psql(containerName, roleName, databaseName, markerSql, secrets, rolePassword);

    const portResult = docker(['port', containerName, '5432/tcp'], secrets);
    const portMatch = String(portResult.stdout).trim().match(/127\.0\.0\.1:(\d+)/);
    if (!portMatch) throw new Error('Could not determine disposable PostgreSQL host port.');

    const databaseUrl =
      'postgresql://' +
      encodeURIComponent(roleName) +
      ':' +
      encodeURIComponent(rolePassword) +
      '@127.0.0.1:' +
      portMatch[1] +
      '/' +
      databaseName;

    const state = {
      version: 1,
      containerName,
      image: IMAGE,
      runId,
      runToken,
      databaseName,
      roleName,
      databaseUrl,
      expiresAt,
      labels: {
        [SAFETY_LABEL]: 'true',
        [RUN_LABEL]: runId,
        [EXPIRES_LABEL]: expiresAt,
      },
    };
    const statePath = join(tmpdir(), 'billing-p0-state-' + runId + '.json');
    writeFileSync(statePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(statePath, 0o600);
    } catch {
      // Windows ACLs govern this file; chmod may be unavailable.
    }

    return { state, statePath };
  } catch (error) {
    docker(['rm', '--force', containerName], secrets, true);
    throw error;
  }
}

export function destroyDisposablePostgres(state, statePath) {
  const secrets = [state.runToken, state.databaseUrl];
  const inspect = docker(
    [
      'inspect',
      '--format',
      '{{ index .Config.Labels "' +
        SAFETY_LABEL +
        '" }}|{{ index .Config.Labels "' +
        RUN_LABEL +
        '" }}',
      state.containerName,
    ],
    secrets,
  );
  const identity = String(inspect.stdout).trim();
  if (identity !== 'true|' + state.runId) {
    throw new Error('Refusing to destroy container without matching disposable safety labels.');
  }
  docker(['rm', '--force', state.containerName], secrets);
  if (statePath) rmSync(statePath, { force: true });
}

function provisionDisposableStorage(state) {
  const rootPath = mkdtempSync(join(tmpdir(), 'billing-p0-storage-' + state.runId + '-'));
  writeFileSync(
    join(rootPath, STORAGE_MARKER_FILE),
    JSON.stringify({
      version: 1,
      runId: state.runId,
      runTokenHash: createHash('sha256').update(state.runToken, 'utf8').digest('hex'),
      rootPath,
      expiresAt: state.expiresAt,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return rootPath;
}

function destroyDisposableStorage(state) {
  if (!state.storagePath) return;
  const markerPath = join(state.storagePath, STORAGE_MARKER_FILE);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.runId !== state.runId || marker.rootPath !== state.storagePath) {
    throw new Error('Refusing to destroy storage without a matching disposable marker.');
  }
  rmSync(state.storagePath, { recursive: true, force: true });
}

function childEnvironment(state) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    RUN_DB_TESTS: '1',
    BILLING_TEST_DATABASE_URL: state.databaseUrl,
    BILLING_TEST_RUN_ID: state.runId,
    BILLING_TEST_RUN_TOKEN: state.runToken,
    BILLING_TEST_DATABASE_ROLE: state.roleName,
    DATABASE_URL: state.databaseUrl,
    USE_REAL_HACIENDA: 'false',
    SECRET_PROVIDER: 'env',
    JWT_SECRET: process.env.JWT_SECRET ?? 'billing-p0-disposable-jwt-secret-32-characters',
    STORAGE_TYPE: 'local',
    FISCAL_WORKER_ENABLE_IN_TESTS: process.env.FISCAL_WORKER_ENABLE_IN_TESTS ?? 'true',
    NODE_OPTIONS: ((process.env.NODE_OPTIONS ?? '') + ' --experimental-vm-modules').trim(),
    LOCAL_STORAGE_PATH: state.storagePath,
    BILLING_TEST_S3_MARKER: createHash('sha256')
      .update(state.runToken, 'utf8')
      .digest('hex'),
  };
}

function runCommand(state, command, args) {
  const executable =
    process.platform === 'win32' && command === 'npx'
      ? 'npx.cmd'
      : process.platform === 'win32' && command === 'npm'
        ? 'npm.cmd'
        : command;
  return spawnSync(executable, args, {
    cwd: process.cwd(),
    env: childEnvironment(state),
    stdio: 'inherit',
    windowsHide: true,
  });
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (action === 'run') {
    const separator = rest.indexOf('--');
    const command = separator >= 0 ? rest[separator + 1] : rest[0];
    const args = separator >= 0 ? rest.slice(separator + 2) : rest.slice(1);
    if (!command) throw new Error('Usage: disposable-postgres.mjs run -- <command> [args...]');

    const { state, statePath } = provisionDisposablePostgres();
    state.storagePath = provisionDisposableStorage(state);
    console.log(
      JSON.stringify({
        disposableDatabase: state.databaseName,
        role: state.roleName,
        container: state.containerName,
        image: state.image,
        expiresAt: state.expiresAt,
      }),
    );
    let result;
    try {
      result = runCommand(state, command, args);
    } finally {
      try {
        destroyDisposableStorage(state);
      } finally {
        destroyDisposablePostgres(state, statePath);
      }
    }
    process.exitCode = result.status ?? 1;
    return;
  }

  throw new Error('Only the guarded run action is supported.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Disposable PostgreSQL failed.');
    process.exitCode = 1;
  }
}
