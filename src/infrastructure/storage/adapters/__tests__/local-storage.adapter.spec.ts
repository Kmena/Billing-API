import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { join } from 'path';
import { LocalStorageAdapter } from '../local-storage.adapter';
import { DisposableTestStorage, provisionDisposableTestStorage } from '../../test-storage-safety';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('LocalStorageAdapter restart durability', () => {
  let lease: DisposableTestStorage;

  beforeEach(() => {
    lease = provisionDisposableTestStorage();
  });

  afterEach(() => {
    lease.dispose();
  });

  it('fails closed when the configured storage root does not exist', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const missing = join(lease.rootPath, 'missing-root');
      const provider = new LocalStorageAdapter(missing, 'secret-1');

      await expect(provider.ensureReady()).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('fails closed when the required mount marker is absent', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1', '.storage-marker');

    await expect(provider.ensureReady()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts an accessible root only when its required mount marker exists', async () => {
    await fs.writeFile(
      join(lease.rootPath, '.storage-marker'),
      'BILLING_LOCAL_FISCAL_STORAGE_ROOT_V1\\n',
    );
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1', '.storage-marker');

    await expect(provider.ensureReady()).resolves.toBeUndefined();
  });

  it('fails closed when the filesystem root is not writable', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    const access = jest
      .spyOn(fs, 'access')
      .mockRejectedValueOnce(Object.assign(new Error('read-only storage'), { code: 'EACCES' }));

    await expect(provider.ensureReady()).rejects.toMatchObject({ code: 'EACCES' });
    access.mockRestore();
  });

  it('keeps concurrent artifact reads byte-identical', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    const bytes = Buffer.from('<artifact>concurrent</artifact>');
    const key = 'durability/concurrent/artifact.xml';
    await provider.upload({ key, bytes, contentType: 'application/xml' });

    const copies = await Promise.all(Array.from({ length: 16 }, () => provider.download(key)));
    expect(copies.every((copy) => sha256(copy) === sha256(bytes))).toBe(true);
  });
  it('retrieves the same object with the same checksum after adapter recreation', async () => {
    const key = 'durability/doc-1/artifact.xml';
    const bytes = Buffer.from('<artifact>durable</artifact>');

    const firstProvider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    await firstProvider.upload({
      key,
      bytes,
      contentType: 'application/xml',
      metadata: { sha256: sha256(bytes) },
    });

    const restartedProvider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    const recovered = await restartedProvider.download(key);

    expect(recovered.equals(bytes)).toBe(true);
    expect(sha256(recovered)).toBe(sha256(bytes));
  });

  it('publishes an object once, accepts byte-identical replay and refuses overwrite', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    const key = 'tenant-a/company-a/document-a/signed.xml';
    const original = Buffer.from('<signed>original</signed>');

    await expect(
      provider.upload({ key, bytes: original, contentType: 'application/xml' }),
    ).resolves.toBe(key);
    await expect(
      provider.upload({ key, bytes: Buffer.from(original), contentType: 'application/xml' }),
    ).resolves.toBe(key);
    await expect(
      provider.upload({
        key,
        bytes: Buffer.from('<signed>replacement</signed>'),
        contentType: 'application/xml',
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_OBJECT_CONFLICT' });
    await expect(provider.download(key)).resolves.toEqual(original);
  });

  it('never exposes a partial canonical object when publication fails', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    const key = 'tenant-a/company-a/document-b/signed.xml';
    const link = jest
      .spyOn(fs, 'link')
      .mockRejectedValueOnce(Object.assign(new Error('interrupted publish'), { code: 'EIO' }));

    await expect(
      provider.upload({
        key,
        bytes: Buffer.from('<signed>interrupted</signed>'),
        contentType: 'application/xml',
      }),
    ).rejects.toMatchObject({ code: 'EIO' });
    await expect(provider.download(key)).rejects.toMatchObject({ code: 'ENOENT' });
    const documentDirectory = join(lease.rootPath, 'tenant-a', 'company-a', 'document-b');
    await expect(fs.readdir(documentDirectory)).resolves.toEqual([]);
    link.mockRestore();
  });

  it('rejects path traversal and keeps tenant/company keys isolated', async () => {
    const provider = new LocalStorageAdapter(lease.rootPath, 'secret-1');
    await expect(
      provider.upload({
        key: '../outside.xml',
        bytes: Buffer.from('escape'),
        contentType: 'application/xml',
      }),
    ).rejects.toThrow('escapes the configured root');

    const tenantAKey = 'tenant-a/company-a/document.xml';
    const tenantBKey = 'tenant-b/company-b/document.xml';
    await provider.upload({
      key: tenantAKey,
      bytes: Buffer.from('tenant-a'),
      contentType: 'application/xml',
    });
    await provider.upload({
      key: tenantBKey,
      bytes: Buffer.from('tenant-b'),
      contentType: 'application/xml',
    });
    await expect(provider.download(tenantAKey)).resolves.toEqual(Buffer.from('tenant-a'));
    await expect(provider.download(tenantBKey)).resolves.toEqual(Buffer.from('tenant-b'));
  });
});
