import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/application/audit.service';
import { TenantContext } from '../../infrastructure/tenant/tenant-context';
import type { ApiKey } from '../../modules/api-keys/domain/entities/api-key.entity';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Optional()
    private readonly auditService?: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.auditService) return next.handle();

    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      ip: string;
      correlationId?: string;
      user?: { userId?: string; tenantId?: string };
      apiKey?: ApiKey;
      headers: Record<string, string | undefined>;
    }>();

    const httpMethod = request.method;
    const url = request.url;
    const action = this.buildCategoricalAction(context, httpMethod);
    const correlationId = request.correlationId;
    const tenantId = TenantContext.getTenantIdOrNull();
    const actor = request.user?.userId ?? request.apiKey?.keyPrefix ?? 'anonymous';
    const apiKeyId = request.apiKey?.id;

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<{ statusCode: number }>();
          this.auditService?.record({
            tenantId: tenantId ?? undefined,
            apiKeyId,
            actor,
            action,
            endpoint: url,
            httpMethod,
            statusCode: response.statusCode,
            ipAddress: request.ip,
            correlationId,
            durationMs: Date.now() - startTime,
            eventClass: 'TECHNICAL',
          });
        },
        error: (err: { status?: number }) => {
          this.auditService?.record({
            tenantId: tenantId ?? undefined,
            apiKeyId,
            actor,
            action,
            endpoint: url,
            httpMethod,
            statusCode: err?.status ?? 500,
            ipAddress: request.ip,
            correlationId,
            durationMs: Date.now() - startTime,
            eventClass: 'TECHNICAL',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
          });
        },
      }),
    );
  }

  private buildCategoricalAction(context: ExecutionContext, httpMethod: string): string {
    const controllerName = (context.getClass().name || 'unknown-controller').replace(
      /Controller$/i,
      '',
    );
    const handlerName = context.getHandler().name || 'unknown-handler';
    const rawAction = `${httpMethod}.${controllerName}.${handlerName}`;

    return rawAction
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }
}
