import { MockHaciendaAuthAdapter } from '../mock-hacienda-auth.adapter';
describe('MockHaciendaAuthAdapter', () => {
  const credentials = { username: 'opaque-atv-user', password: 'secret' };
  it.each([['INVALID_CREDENTIALS'], ['UNAVAILABLE']] as const)(
    'returns normalized %s validation result',
    async (behavior) => {
      const adapter = new MockHaciendaAuthAdapter();
      adapter.behavior = behavior;
      const result = await adapter.validateConnection(credentials, 'PRODUCTION');
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe(
        behavior === 'INVALID_CREDENTIALS' ? 'INVALID_CREDENTIALS' : 'IDP_UNAVAILABLE',
      );
    },
  );
  it('returns a token for successful validation', async () => {
    const result = await new MockHaciendaAuthAdapter().validateConnection(credentials, 'SANDBOX');
    expect(result.isValid).toBe(true);
    expect(result.token?.accessToken).toBeDefined();
  });
});
