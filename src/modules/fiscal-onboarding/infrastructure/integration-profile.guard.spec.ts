import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { IntegrationProfileGuard } from './integration-profile.guard';
import { INVENTORI_FISCAL_PROFILE } from '../domain/inventori-fiscal-profile';

function contextFor(integrationProfile?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ apiKey: { integrationProfile } }),
    }),
  } as unknown as ExecutionContext;
}

describe('IntegrationProfileGuard', () => {
  const guard = new IntegrationProfileGuard();

  it('allows only the approved versioned profile', () => {
    expect(guard.canActivate(contextFor(INVENTORI_FISCAL_PROFILE))).toBe(true);
  });

  it.each([undefined, '', 'inventori-fiscal-v2'])('denies profile %s', (profile) => {
    expect(() => guard.canActivate(contextFor(profile))).toThrow(ForbiddenException);
    try {
      guard.canActivate(contextFor(profile));
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'INTEGRATION_PROFILE_NOT_AUTHORIZED',
      });
    }
  });
});
