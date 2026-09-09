import { TenantContext, TenantContextNotSetException } from '../tenant-context';

describe('TenantContext', () => {
  describe('run() and getTenantId()', () => {
    it('makes tenantId available inside run()', async () => {
      let capturedId: string | null = null;

      await TenantContext.run('tenant-abc', async () => {
        capturedId = TenantContext.getTenantId();
      });

      expect(capturedId).toBe('tenant-abc');
    });

    it('throws TenantContextNotSetException outside of run()', () => {
      expect(() => TenantContext.getTenantId()).toThrow(TenantContextNotSetException);
    });

    it('propagates context through nested async calls', async () => {
      let capturedId: string | null = null;

      await TenantContext.run('tenant-xyz', async () => {
        // Simulate nested async operations
        await Promise.resolve();
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            capturedId = TenantContext.getTenantId();
            resolve();
          }, 0);
        });
      });

      expect(capturedId).toBe('tenant-xyz');
    });

    it('isolates context between parallel runs', async () => {
      const results: string[] = [];

      await Promise.all([
        TenantContext.run('tenant-1', async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          results.push(TenantContext.getTenantId());
        }),
        TenantContext.run('tenant-2', async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          results.push(TenantContext.getTenantId());
        }),
      ]);

      expect(results).toContain('tenant-1');
      expect(results).toContain('tenant-2');
      // Each run gets its own isolated context
      expect(results).toHaveLength(2);
    });

    it('restores previous context (or none) after run() completes', async () => {
      await TenantContext.run('tenant-outer', async () => {
        expect(TenantContext.getTenantId()).toBe('tenant-outer');
      });

      // After the run, no context is available
      expect(() => TenantContext.getTenantId()).toThrow(TenantContextNotSetException);
    });
  });

  describe('getTenantIdOrNull()', () => {
    it('returns the tenantId when context is set', async () => {
      let result: string | null = null;

      await TenantContext.run('tenant-nullable', async () => {
        result = TenantContext.getTenantIdOrNull();
      });

      expect(result).toBe('tenant-nullable');
    });

    it('returns null when no context is set', () => {
      const result = TenantContext.getTenantIdOrNull();
      expect(result).toBeNull();
    });
  });
});
