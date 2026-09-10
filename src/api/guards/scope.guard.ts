import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import type { ApiKey } from '../../modules/api-keys/domain/entities/api-key.entity';

/**
 * ScopeGuard — fail-closed API key scope enforcement (DEC-002).
 *
 * Rules:
 * 1. No scopes declared → allow (open to all authenticated principals).
 * 2. Scopes declared + request.apiKey ABSENT → DENY (fail-closed).
 *    - Absence of apiKey does NOT prove JWT auth. Must not pass-through.
 * 3. Scopes declared + apiKey present + ALL scopes present → allow.
 * 4. Scopes declared + apiKey present + ANY scope missing → DENY.
 *
 * AND semantics (DEC-001): all declared scopes must be present.
 * Must be placed AFTER ApiKeyAuthGuard in the @UseGuards() chain.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No scopes declared → open to all authenticated principals
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ apiKey?: ApiKey }>();

    // FAIL-CLOSED: scopes required but no API key principal → deny
    if (!req.apiKey) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SCOPE',
        message: `This endpoint requires API key authentication with scope(s): ${required.join(', ')}`,
      });
    }

    // AND semantics: all declared scopes must be present
    const hasAll = required.every((s) => req.apiKey!.scopes.includes(s));
    if (!hasAll) {
      const missing = required.filter((s) => !req.apiKey!.scopes.includes(s));
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SCOPE',
        message: `API key is missing required scope(s): ${missing.join(', ')}`,
      });
    }

    return true;
  }
}
