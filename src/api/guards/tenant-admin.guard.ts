import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Reusable JWT privilege boundary for fiscal-administration mutations.
 * Read-only endpoints remain protected by JwtAuthGuard alone.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role !== 'TENANT_ADMIN') {
      throw new ForbiddenException({ code: 'TENANT_ADMIN_REQUIRED' });
    }
    return true;
  }
}
