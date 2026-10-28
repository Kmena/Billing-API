import assert from 'node:assert/strict';
import test from 'node:test';
import { runUpdate } from './billing-update.mjs';

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const phases = [
  'configurationCheck',
  'migrationPreflight',
  'backup',
  'restoreVerification',
  'updateApi',
  'updateWorkers',
  'healthCheck',
];
const config = {
  version: 1,
  environment: 'staging',
  checkout: '/srv/billing',
  resultLog: '/var/log/billing/update.jsonl',
  approvedSha: SHA2,
  ...Object.fromEntries(phases.map((phase) => [phase, { file: `/approved/${phase}`, args: [] }])),
};

function harness(failAt) {
  const calls = [];
  const run = (file, args) => {
    const name = file === 'git' ? args[2] : file.split('/').at(-1);
    calls.push(name);
    if (name === failAt) throw new Error(`failed: ${name}`);
    if (name === 'symbolic-ref') return 'main';
    if (name === 'status') return '';
    if (name === 'rev-parse') return args.includes('HEAD') ? SHA1 : SHA2;
    if (name === 'backup') return '/tmp/synthetic-backup-manifest.json';
    return '';
  };
  return { calls, run };
}

test('check is read-only and apply runs each gate in order', () => {
  const check = harness();
  assert.equal(runUpdate(config, check.run, false).mode, 'CHECK_ONLY');
  assert.equal(check.calls.includes('fetch'), false);
  assert.equal(check.calls.includes('migrationPreflight'), false);
  const apply = harness();
  assert.equal(
    runUpdate(
      config,
      apply.run,
      true,
      () => {},
      () => {},
    ).mode,
    'UPDATED',
  );
  assert.deepEqual(apply.calls.slice(-8), [
    'configurationCheck',
    'migrationPreflight',
    'backup',
    'restoreVerification',
    'merge',
    'updateApi',
    'updateWorkers',
    'healthCheck',
  ]);
});

test('each failed gate stops every later action', () => {
  for (const gate of ['fetch', ...phases.slice(0, 3), 'merge', ...phases.slice(3)]) {
    const { calls, run } = harness(gate);
    assert.throws(
      () =>
        runUpdate(
          config,
          run,
          true,
          () => {},
          () => {},
        ),
      /failed:/,
    );
    assert.equal(calls.at(-1), gate);
  }
});

test('unapproved main, unclean checkout and missing commands fail closed', () => {
  assert.throws(
    () => runUpdate({ ...config, approvedSha: SHA1 }, harness().run, true, () => {}),
    /MAIN_NOT_APPROVED/,
  );
  assert.throws(
    () => runUpdate({ ...config, backup: undefined }, harness().run, true, () => {}),
    /BACKUP_MISSING/,
  );
  const dirty = harness();
  assert.throws(
    () =>
      runUpdate(
        config,
        (file, args) => (args[2] === 'status' ? ' M changed' : dirty.run(file, args)),
        true,
        () => {},
      ),
    /NOT_CLEAN/,
  );
  const missingManifest = harness();
  assert.throws(
    () =>
      runUpdate(
        config,
        (file, args) => (file === '/approved/backup' ? '' : missingManifest.run(file, args)),
        true,
        () => {},
      ),
    /BACKUP_MANIFEST_MISSING/,
  );
});

test('result journal records applied SHA and exact failed phase without command output', () => {
  const events = [];
  const record = (_config, event) => events.push(event);
  assert.equal(runUpdate(config, harness().run, true, record, () => {}).mode, 'UPDATED');
  assert.deepEqual(
    events.map((event) => event.status),
    ['STARTED', 'SUCCEEDED'],
  );
  assert.equal(events.at(-1).targetSha, SHA2);
  const failed = harness('updateWorkers');
  assert.throws(
    () => runUpdate(config, failed.run, true, record, () => {}),
    /failed: updateWorkers/,
  );
  assert.equal(events.at(-1).status, 'FAILED');
  assert.equal(events.at(-1).phase, 'updateWorkers');
  assert.equal(events.at(-1).targetSha, SHA2);
  assert.equal(JSON.stringify(events).includes('failed:'), false);
});

test('staging and result log are required', () => {
  assert.throws(
    () => runUpdate({ ...config, environment: 'production' }, harness().run),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => runUpdate({ ...config, resultLog: undefined }, harness().run),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => runUpdate({ ...config, resultLog: '/srv/billing/update.jsonl' }, harness().run),
    /CONFIG_INVALID/,
  );
});

test('a backup path without a regular manifest blocks checkout update', () => {
  const { calls, run } = harness();
  assert.throws(() => runUpdate(config, run, true, () => {}), /BACKUP_MANIFEST_UNAVAILABLE/);
  assert.equal(calls.includes('merge'), false);
});
