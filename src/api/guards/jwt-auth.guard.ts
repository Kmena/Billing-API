import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { JwtRequest } from '../strategies/jwt.strategy';

/**
 * Validates the Bearer JWT token from the Authorization header.
 * On success, populates request.user with { userId, tenantId, role }.
 * TenantContext is established by TenantContextInterceptor (applied globally).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = JwtRequest>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Authentication required. Please provide a valid JWT token.');
    }
    return user;
  }
}
