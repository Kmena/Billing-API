import { createHash } from 'crypto';
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
});
