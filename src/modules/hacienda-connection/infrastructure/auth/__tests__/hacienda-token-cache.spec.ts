import { ConfigService } from '@nestjs/config';
import { HaciendaTokenCache } from '../hacienda-token-cache.service';

describe('HaciendaTokenCache', () => {
  const companyId = 'company-a';
  let cache: HaciendaTokenCache;
  beforeEach(() => {
    cache = new HaciendaTokenCache(
      new ConfigService({ haciendaAuth: { tokenExpirySafetyMarginMs: 30000 } }),
    );
  });
  it('separates production and sandbox tokens', () => {
    cache.setToken(companyId, 'PRODUCTION', {
      accessToken: 'prod',
      expiresAt: new Date(Date.now() + 60000),
    });
    cache.setToken(companyId, 'SANDBOX', {
      accessToken: 'sandbox',
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(cache.getToken(companyId, 'PRODUCTION')).toBe('prod');
    expect(cache.getToken(companyId, 'SANDBOX')).toBe('sandbox');
    cache.invalidate(companyId, 'PRODUCTION');
    expect(cache.getToken(companyId, 'PRODUCTION')).toBeNull();
    expect(cache.getToken(companyId, 'SANDBOX')).toBe('sandbox');
  });
  it('does not return expired or near-expiry tokens', () => {
    cache.setToken(companyId, 'PRODUCTION', {
      accessToken: 'near',
      expiresAt: new Date(Date.now() + 30000),
    });
    expect(cache.getToken(companyId, 'PRODUCTION')).toBeNull();
  });
});
