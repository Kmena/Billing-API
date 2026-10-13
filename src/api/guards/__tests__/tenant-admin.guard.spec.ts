import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantAdminGuard } from '../tenant-admin.guard';

function contextFor(role?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('TenantAdminGuard', () => {
  const guard = new TenantAdminGuard();

  it('allows TENANT_ADMIN', () => {
    expect(guard.canActivate(contextFor('TENANT_ADMIN'))).toBe(true);
  });

  it.each(['MEMBER', 'READ_ONLY', undefined])('denies %s', (role) => {
    expect(() => guard.canActivate(contextFor(role))).toThrow(ForbiddenException);
  });
});
