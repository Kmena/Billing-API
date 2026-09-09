import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { from } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { TenantContext } from '../../infrastructure/tenant/tenant-context';

/**
 * Wraps every request handler in TenantContext.run() when a tenantId is available.
 * This ensures that all async operations within a request (use cases, repositories)
 * have access to the tenant context via AsyncLocalStorage.
 *
 * The tenantId is populated by JwtAuthGuard or ApiKeyAuthGuard on request.user.tenantId.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: { tenantId?: string };
      apiKey?: { tenantId?: string };
    }>();

    const tenantId = request.user?.tenantId ?? request.apiKey?.tenantId;

    if (!tenantId) {
      // No tenant context needed (e.g., health checks, public endpoints)
      return next.handle();
    }

    return from(TenantContext.run(tenantId, () => lastValueFrom(next.handle()))).pipe(
      switchMap((result) => from(Promise.resolve(result))),
    );
  }
}
