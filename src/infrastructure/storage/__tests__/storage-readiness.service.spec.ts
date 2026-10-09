import { StorageReadinessService } from '../storage-readiness.service';

describe('StorageReadinessService', () => {
  it('proves the configured store is ready during bootstrap', async () => {
    const storage = { ensureReady: jest.fn().mockResolvedValue(undefined) };
    const service = new StorageReadinessService(storage as never);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(storage.ensureReady).toHaveBeenCalledTimes(1);
  });

  it('fails startup when the configured store is unavailable', async () => {
    const storage = { ensureReady: jest.fn().mockRejectedValue(new Error('bucket unavailable')) };
    const service = new StorageReadinessService(storage as never);

    await expect(service.onApplicationBootstrap()).rejects.toThrow('bucket unavailable');
  });
});
