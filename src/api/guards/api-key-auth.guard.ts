import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ValidateApiKeyHandler } from '../../modules/api-keys/application/use-cases/validate-api-key/validate-api-key.handler';
import type { ApiKey } from '../../modules/api-keys/domain/entities/api-key.entity';
import { ApiKeyExpiredException } from '../../modules/api-keys/domain/exceptions/api-key-expired.exception';
import { ApiKeyRevokedException } from '../../modules/api-keys/domain/exceptions/api-key-revoked.exception';
import { ApiKeyInvalidException } from '../../modules/api-keys/domain/exceptions/api-key-invalid.exception';

export interface ApiKeyRequest {
  apiKey: ApiKey;
  user: {
    tenantId: string;
  };
}

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly validateApiKeyHandler: ValidateApiKeyHandler) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      apiKey?: ApiKey;
      user?: { tenantId: string };
    }>();

    const rawKey = request.headers['x-api-key'];

    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header.');
    }

    try {
      const { apiKey } = await this.validateApiKeyHandler.execute({ rawKey });

      // Expose the full ApiKey object on request for ScopeGuard (Fase 1) — TASK-009 requirement
      request.apiKey = apiKey;
      request.user = { tenantId: apiKey.tenantId };

      return true;
    } catch (err) {
      if (err instanceof ApiKeyExpiredException) {
        throw new UnauthorizedException({ code: 'API_KEY_EXPIRED', message: err.message });
      }
      if (err instanceof ApiKeyRevokedException) {
        throw new UnauthorizedException({ code: 'API_KEY_REVOKED', message: err.message });
      }
      if (err instanceof ApiKeyInvalidException) {
        throw new UnauthorizedException({ code: 'API_KEY_INVALID', message: err.message });
      }
      throw new UnauthorizedException('API key authentication failed.');
    }
  }
}
