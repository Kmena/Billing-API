import { EnvSecretProvider } from '../adapters/env-secret-provider.adapter';

describe('EnvSecretProvider', () => {
  let provider: EnvSecretProvider;

  beforeEach(() => {
    provider = new EnvSecretProvider();
  });

  describe('getSecret()', () => {
    it('returns the value of an existing environment variable', async () => {
      process.env.TEST_SECRET_KEY = 'test-secret-value';

      const value = await provider.getSecret('TEST_SECRET_KEY');

      expect(value).toBe('test-secret-value');

      delete process.env.TEST_SECRET_KEY;
    });

    it('throws when the environment variable is not set', async () => {
      delete process.env.NONEXISTENT_SECRET_KEY;

      await expect(provider.getSecret('NONEXISTENT_SECRET_KEY')).rejects.toThrow(
        "Secret 'NONEXISTENT_SECRET_KEY' is not defined",
      );
    });

    it('throws when the environment variable is empty', async () => {
      process.env.EMPTY_SECRET_KEY = '';

      await expect(provider.getSecret('EMPTY_SECRET_KEY')).rejects.toThrow(
        "Secret 'EMPTY_SECRET_KEY' is not defined",
      );

      delete process.env.EMPTY_SECRET_KEY;
    });
  });
});
