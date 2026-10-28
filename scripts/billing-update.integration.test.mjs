import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runUpdate } from './billing-update.mjs';

function command(file, args, cwd) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${file} ${args[0]} failed`);
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'billing-update-sim-'));
  const remote = path.join(root, 'remote.git');
  const checkout = path.join(root, 'checkout');
  command('git', ['init', '--bare', '-b', 'main', remote], root);
  command('git', ['clone', remote, checkout], root);
  command('git', ['config', 'user.email', 'simulated@billing.invalid'], checkout);
  command('git', ['config', 'user.name', 'Billing simulation'], checkout);
  writeFileSync(path.join(checkout, 'version.txt'), 'one\n');
  command('git', ['add', 'version.txt'], checkout);
  command('git', ['commit', '-m', 'base'], checkout);
  command('git', ['push', 'origin', 'main'], checkout);
  const previousSha = command('git', ['rev-parse', 'HEAD'], checkout);
  writeFileSync(path.join(checkout, 'version.txt'), 'two\n');
  command('git', ['add', 'version.txt'], checkout);
  command('git', ['commit', '-m', 'approved'], checkout);
  command('git', ['push', 'origin', 'main'], checkout);
  const approvedSha = command('git', ['rev-parse', 'HEAD'], checkout);
  command('git', ['reset', '--hard', previousSha], checkout);

  const phaseScript = path.join(root, 'phase.cjs');
  writeFileSync(
    phaseScript,
    `
const fs = require('node:fs');
const [phase, root] = process.argv.slice(2);
fs.appendFileSync(require('node:path').join(root, 'phases.txt'), phase + '\\n');
if (phase === process.env.BILLING_SIMULATED_FAIL) process.exit(17);
if (phase === 'backup') {
  const manifest = require('node:path').join(root, 'manifest.json');
  fs.writeFileSync(manifest, '{"synthetic":true}\\n');
  process.stdout.write(manifest + '\\n');
}
`,
  );
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
    checkout,
    approvedSha,
    resultLog: path.join(root, 'update.jsonl'),
    ...Object.fromEntries(
      phases.map((phase) => [phase, { file: process.execPath, args: [phaseScript, phase, root] }]),
    ),
  };
  return { root, checkout, previousSha, approvedSha, config };
}

test('real disposable Git checkout and simulated services update and journal the approved SHA', () => {
  const f = fixture();
  try {
    assert.equal(runUpdate(f.config).mode, 'CHECK_ONLY');
    assert.equal(runUpdate(f.config, undefined, true).mode, 'UPDATED');
    assert.equal(command('git', ['rev-parse', 'HEAD'], f.checkout), f.approvedSha);
    const events = readFileSync(f.config.resultLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.status),
      ['STARTED', 'SUCCEEDED'],
    );
    assert.equal(events.at(-1).targetSha, f.approvedSha);
    assert.deepEqual(readFileSync(path.join(f.root, 'phases.txt'), 'utf8').trim().split('\n'), [
      'configurationCheck',
      'migrationPreflight',
      'backup',
      'restoreVerification',
      'updateApi',
      'updateWorkers',
      'healthCheck',
    ]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('simulated API failure stops worker and health and records failed phase', () => {
  const f = fixture();
  try {
    process.env.BILLING_SIMULATED_FAIL = 'updateApi';
    assert.throws(() => runUpdate(f.config, undefined, true), /COMMAND_FAILED_updateApi/);
    const events = readFileSync(f.config.resultLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).status, 'FAILED');
    assert.equal(events.at(-1).phase, 'updateApi');
    assert.equal(
      readFileSync(path.join(f.root, 'phases.txt'), 'utf8').includes('updateWorkers'),
      false,
    );
  } finally {
    delete process.env.BILLING_SIMULATED_FAIL;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('simulated migration, worker and health failures stop at their exact phase', () => {
  for (const failAt of ['migrationPreflight', 'updateWorkers', 'healthCheck']) {
    const f = fixture();
    try {
      process.env.BILLING_SIMULATED_FAIL = failAt;
      assert.throws(() => runUpdate(f.config, undefined, true), new RegExp(`COMMAND_FAILED_${failAt}`));
      const events = readFileSync(f.config.resultLog, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(events.at(-1).status, 'FAILED');
      assert.equal(events.at(-1).phase, failAt);
      assert.equal(readFileSync(path.join(f.root, 'phases.txt'), 'utf8').trim().split('\n').at(-1), failAt);
      if (failAt === 'migrationPreflight')
        assert.equal(command('git', ['rev-parse', 'HEAD'], f.checkout), f.previousSha);
    } finally {
      delete process.env.BILLING_SIMULATED_FAIL;
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
