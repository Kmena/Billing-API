// Synthetic PostgreSQL only. No host port, network or persistent volume is created.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const name = `billing-backup-test-${randomBytes(6).toString('hex')}`;
function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Disposable Docker step failed: ${args[0]}`);
  return result.stdout;
}
function sql(database, query) {
  return docker([
    'exec',
    name,
    'psql',
    '-X',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    database,
    '-c',
    query,
  ])
    .toString()
    .trim();
}

let created = false;
try {
  docker([
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    'com.billing.test-safety=true',
    '--network',
    'none',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:15-alpine',
  ]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
      { windowsHide: true },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.equal(ready, true, 'Disposable PostgreSQL did not become ready');
  sql('postgres', 'CREATE DATABASE billing_fixture');
  sql(
    'billing_fixture',
    "CREATE TABLE synthetic_invoice (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO synthetic_invoice VALUES (1, 'fictional-only'), (2, 'restore-check')",
  );
  const expected = sql(
    'billing_fixture',
    "SELECT md5(string_agg(id::text || ':' || payload, ',' ORDER BY id)) FROM synthetic_invoice",
  );
  const dump = docker(['exec', name, 'pg_dump', '-U', 'postgres', '-Fc', '-d', 'billing_fixture']);
  assert.ok(dump.length > 0);
  const digest = createHash('sha256').update(dump).digest('hex');
  assert.equal(createHash('sha256').update(dump).digest('hex'), digest);
  sql('postgres', 'CREATE DATABASE billing_restore');
  docker(
    [
      'exec',
      '-i',
      name,
      'pg_restore',
      '--exit-on-error',
      '--no-owner',
      '-U',
      'postgres',
      '-d',
      'billing_restore',
    ],
    dump,
  );
  const restored = sql(
    'billing_restore',
    "SELECT md5(string_agg(id::text || ':' || payload, ',' ORDER BY id)) FROM synthetic_invoice",
  );
  assert.equal(restored, expected);
  process.stdout.write(
    JSON.stringify({
      status: 'PASS_DISPOSABLE',
      dumpSha256: digest,
      sourceRows: 2,
      restoredRows: 2,
      contentEqual: true,
    }) + '\n',
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (created) {
    const label = docker([
      'inspect',
      '--format',
      '{{ index .Config.Labels "com.billing.test-safety" }}',
      name,
    ])
      .toString()
      .trim();
    assert.equal(label, 'true');
    docker(['rm', '--force', name]);
  }
}
