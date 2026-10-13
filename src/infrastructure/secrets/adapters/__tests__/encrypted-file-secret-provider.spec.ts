import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  EncryptedFileSecretProvider,
  initializeEncryptedFileSecretStore,
} from '../encrypted-file-secret-provider.adapter';
import {
  backupEncryptedSecretStore,
  restoreEncryptedSecretStore,
} from '../../local-secret-store-backup';

describe('EncryptedFileSecretProvider', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function fixture() {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-secret-store-'));
    roots.push(parent);
    const rootPath = path.join(parent, 'store');
    const masterKeyPath = path.join(parent, 'operator-key', 'master.key');
    await initializeEncryptedFileSecretStore({ rootPath, masterKeyPath });
    return {
      parent,
      rootPath,
      masterKeyPath,
      provider: new EncryptedFileSecretProvider({ rootPath, masterKeyPath }),
    };
  }

  it('persists synthetic Hacienda credentials, certificate and PIN across provider restarts', async () => {
    const f = await fixture();
    const values = {
      'hacienda/credentials/sandbox': JSON.stringify({
        username: 'synthetic-user',
        password: 'synthetic-password',
      }),
      'hacienda/certificate/sandbox': JSON.stringify({
        p12Base64: Buffer.from('synthetic-p12').toString('base64'),
      }),
      'hacienda/certificate-pin/sandbox': 'synthetic-pin',
    };
    for (const [reference, value] of Object.entries(values))
      await f.provider.storeSecret(reference, value);

    const restarted = new EncryptedFileSecretProvider({
      rootPath: f.rootPath,
      masterKeyPath: f.masterKeyPath,
    });
    await restarted.ensureReady();
    for (const [reference, value] of Object.entries(values)) {
      await expect(restarted.getSecret(reference)).resolves.toBe(value);
    }

    const diskText = (await readAllFiles(f.rootPath)).join('\n');
    for (const value of Object.values(values)) expect(diskText).not.toContain(value);
    expect(diskText).not.toContain('synthetic-password');
    expect(diskText).not.toContain('synthetic-pin');
  });

  it('shares one durable store consistently across API and worker instances', async () => {
    const f = await fixture();
    const api = new EncryptedFileSecretProvider({
      rootPath: f.rootPath,
      masterKeyPath: f.masterKeyPath,
    });
    const worker = new EncryptedFileSecretProvider({
      rootPath: f.rootPath,
      masterKeyPath: f.masterKeyPath,
    });
    await api.storeSecret('shared/runtime-secret', 'synthetic-v1');
    await expect(worker.getSecret('shared/runtime-secret')).resolves.toBe('synthetic-v1');
    await worker.storeSecret('shared/runtime-secret', 'synthetic-v2');
    await expect(api.getSecret('shared/runtime-secret')).resolves.toBe('synthetic-v2');
    await expect(api.verifyAllSecrets()).resolves.toEqual({ active: 1, deleted: 0, versions: 2 });
  });

  it('serializes concurrent writes and retains immutable versions', async () => {
    const f = await fixture();
    const first = new EncryptedFileSecretProvider({
      rootPath: f.rootPath,
      masterKeyPath: f.masterKeyPath,
    });
    const second = new EncryptedFileSecretProvider({
      rootPath: f.rootPath,
      masterKeyPath: f.masterKeyPath,
    });
    await Promise.all([
      first.storeSecret('concurrent/reference', 'synthetic-a'),
      second.storeSecret('concurrent/reference', 'synthetic-b'),
    ]);
    await expect(f.provider.verifyAllSecrets()).resolves.toEqual({
      active: 1,
      deleted: 0,
      versions: 2,
    });
    await expect(f.provider.getSecret('concurrent/reference')).resolves.toMatch(/^synthetic-[ab]$/);
  });

  it('tombstones deletes without exposing or silently falling back', async () => {
    const f = await fixture();
    await f.provider.storeSecret('delete/reference', 'synthetic-delete');
    await f.provider.deleteSecret('delete/reference');
    await expect(f.provider.getSecret('delete/reference')).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
    });
    await expect(f.provider.verifyAllSecrets()).resolves.toEqual({
      active: 0,
      deleted: 1,
      versions: 2,
    });
  });

  it('fails closed for a wrong key, a missing marker and a colocated key', async () => {
    const f = await fixture();
    const wrongKeyPath = path.join(f.parent, 'wrong.key');
    await fs.writeFile(wrongKeyPath, crypto.randomBytes(32), { mode: 0o600 });
    await expect(
      new EncryptedFileSecretProvider({
        rootPath: f.rootPath,
        masterKeyPath: wrongKeyPath,
      }).ensureReady(),
    ).rejects.toMatchObject({ code: 'SECRET_MASTER_KEY_MISMATCH' });

    await fs.rename(
      path.join(f.rootPath, '.billing-secret-store-root'),
      path.join(f.rootPath, '.marker-away'),
    );
    await expect(f.provider.ensureReady()).rejects.toMatchObject({
      code: 'SECRET_STORE_MARKER_MISSING',
    });
    expect(
      () =>
        new EncryptedFileSecretProvider({
          rootPath: f.rootPath,
          masterKeyPath: path.join(f.rootPath, 'key'),
        }),
    ).toThrow(expect.objectContaining({ code: 'SECRET_MASTER_KEY_COLOCATED' }));
  });

  it('fails closed for a missing mount and a missing master key', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-secret-missing-'));
    roots.push(parent);
    const missingStore = new EncryptedFileSecretProvider({
      rootPath: path.join(parent, 'missing-store'),
      masterKeyPath: path.join(parent, 'missing.key'),
    });
    await expect(missingStore.ensureReady()).rejects.toMatchObject({
      code: 'SECRET_STORE_MISSING',
    });

    const f = await fixture();
    await fs.unlink(f.masterKeyPath);
    await expect(f.provider.ensureReady()).rejects.toMatchObject({
      code: 'SECRET_MASTER_KEY_UNAVAILABLE',
    });
  });

  it('detects record corruption and ignores an interrupted temporary file', async () => {
    const f = await fixture();
    await f.provider.storeSecret('corrupt/reference', 'synthetic-corruption');
    const version = (await findFiles(f.rootPath)).find((name) => /v\d{8}\.json$/.test(name));
    expect(version).toBeDefined();
    await fs.writeFile(path.join(f.rootPath, '.interrupted.tmp'), 'incomplete', 'utf8');
    await expect(f.provider.ensureReady()).resolves.toBeUndefined();
    await fs.appendFile(version!, 'tamper');
    await expect(f.provider.getSecret('corrupt/reference')).rejects.toMatchObject({
      code: 'SECRET_INTEGRITY_FAILED',
    });
  });

  it('preserves the last committed value when an orphan immutable version precedes a retry', async () => {
    const f = await fixture();
    await f.provider.storeSecret('interrupted/reference', 'synthetic-v1');
    const firstVersion = (await findFiles(f.rootPath)).find((name) =>
      /v00000001\.json$/.test(name),
    );
    expect(firstVersion).toBeDefined();
    await fs.copyFile(firstVersion!, path.join(path.dirname(firstVersion!), 'v00000002.json'));

    await f.provider.storeSecret('interrupted/reference', 'synthetic-v3');

    await expect(f.provider.getSecret('interrupted/reference')).resolves.toBe('synthetic-v3');
    await expect(f.provider.verifyAllSecrets()).resolves.toEqual({
      active: 1,
      deleted: 0,
      versions: 2,
    });
  });

  it('backs up encrypted data only and restores it with the separately supplied key', async () => {
    const f = await fixture();
    await f.provider.storeSecret('backup/reference', 'synthetic-backup-value');
    const backup = path.join(f.parent, 'backup');
    const restored = path.join(f.parent, 'restored');
    const result = await backupEncryptedSecretStore({
      sourcePath: f.rootPath,
      destinationPath: backup,
    });
    expect(result.files).toBeGreaterThan(1);
    const backupText = (await readAllFiles(backup)).join('\n');
    expect(backupText).not.toContain('synthetic-backup-value');
    expect(
      (await findFiles(backup)).some((name) => /(?:master.?key|\.key|\.p12|\.pfx)$/i.test(name)),
    ).toBe(false);

    await expect(
      restoreEncryptedSecretStore({
        backupPath: backup,
        destinationPath: restored,
        masterKeyPath: f.masterKeyPath,
      }),
    ).resolves.toMatchObject({ activeSecrets: 1, deletedSecrets: 0, versions: 1 });
    const restoredProvider = new EncryptedFileSecretProvider({
      rootPath: restored,
      masterKeyPath: f.masterKeyPath,
    });
    await expect(restoredProvider.getSecret('backup/reference')).resolves.toBe(
      'synthetic-backup-value',
    );
  });

  it('rejects corrupted backups and wrong-key restores', async () => {
    const f = await fixture();
    await f.provider.storeSecret('backup/rejection', 'synthetic-value');
    const backup = path.join(f.parent, 'backup-reject');
    await backupEncryptedSecretStore({ sourcePath: f.rootPath, destinationPath: backup });
    const record = (await findFiles(backup)).find((name) => /v\d{8}\.json$/.test(name));
    await fs.appendFile(record!, 'tamper');
    await expect(
      restoreEncryptedSecretStore({
        backupPath: backup,
        destinationPath: path.join(f.parent, 'corrupt-restore'),
        masterKeyPath: f.masterKeyPath,
      }),
    ).rejects.toThrow('integrity');

    const cleanBackup = path.join(f.parent, 'backup-clean');
    await backupEncryptedSecretStore({ sourcePath: f.rootPath, destinationPath: cleanBackup });
    const wrongKeyPath = path.join(f.parent, 'wrong-restore.key');
    await fs.writeFile(wrongKeyPath, crypto.randomBytes(32), { mode: 0o600 });
    await expect(
      restoreEncryptedSecretStore({
        backupPath: cleanBackup,
        destinationPath: path.join(f.parent, 'wrong-key-restore'),
        masterKeyPath: wrongKeyPath,
      }),
    ).rejects.toMatchObject({ code: 'SECRET_MASTER_KEY_MISMATCH' });
  });

  it('refuses to initialize over an existing directory without removing its contents', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-secret-init-'));
    roots.push(parent);
    const existing = path.join(parent, 'existing');
    const sentinel = path.join(existing, 'do-not-delete.txt');
    await fs.mkdir(existing);
    await fs.writeFile(sentinel, 'preserve', 'utf8');
    await expect(
      initializeEncryptedFileSecretStore({
        rootPath: existing,
        masterKeyPath: path.join(parent, 'key'),
      }),
    ).rejects.toBeDefined();
    await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('preserve');
  });

  it('rejects ambiguous references and has no AWS or LocalStack dependency', async () => {
    const f = await fixture();
    await expect(f.provider.storeSecret('../escape', 'synthetic')).rejects.toMatchObject({
      code: 'SECRET_REFERENCE_INVALID',
    });
    await expect(f.provider.storeSecret('valid/reference', 'synthetic')).resolves.toBeUndefined();
    expect(EncryptedFileSecretProvider.toString()).not.toMatch(
      /localstack|aws-sdk|parameterstore/i,
    );
  });
});

async function findFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await findFiles(absolute)));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

async function readAllFiles(root: string): Promise<string[]> {
  return Promise.all((await findFiles(root)).map((file) => fs.readFile(file, 'utf8')));
}
