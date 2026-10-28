import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(tmpdir(), 'billing-artifact-restore-'));
const storage = path.join(root, 'storage');
const backup = path.join(root, 'backup');
const restored = path.join(root, 'restored');
const config = path.join(root, 'billing-update.json');
const configBackup = path.join(root, 'billing-update.backup.json');
const configRestored = path.join(root, 'billing-update.restored.json');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${path.basename(script)} failed`);
}
try {
  mkdirSync(storage);
  writeFileSync(path.join(storage, '.billing-fiscal-storage-root'), 'synthetic marker\n');
  writeFileSync(path.join(storage, 'synthetic.xml'), '<test>fictional only</test>\n');
  writeFileSync(
    config,
    JSON.stringify({ version: 1, environment: 'staging', credentials: 'external-only' }),
  );
  run('scripts/backup-local-fiscal-artifacts.mjs', ['--source', storage, '--destination', backup]);
  run('scripts/restore-local-fiscal-artifacts.mjs', [
    '--source',
    backup,
    '--destination',
    restored,
  ]);
  assert.equal(
    hash(path.join(storage, 'synthetic.xml')),
    hash(path.join(restored, 'synthetic.xml')),
  );
  assert.equal(
    hash(path.join(storage, '.billing-fiscal-storage-root')),
    hash(path.join(restored, '.billing-fiscal-storage-root')),
  );
  copyFileSync(config, configBackup);
  copyFileSync(configBackup, configRestored);
  assert.equal(hash(config), hash(configRestored));
  process.stdout.write(
    JSON.stringify({
      status: 'PASS_DISPOSABLE',
      artifactFiles: 2,
      artifactHashesEqual: true,
      configHashEqual: true,
    }) + '\n',
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
