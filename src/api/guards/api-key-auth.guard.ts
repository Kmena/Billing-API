import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
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
  constructor(
    private readonly validateApiKeyHandler: ValidateApiKeyHandler,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
      apiKey?: ApiKey;
      user?: { tenantId: string };
    }>();

    const rawKey = request.headers['x-api-key'];

    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header.');
    }

    try {
      const { apiKey } = await this.validateApiKeyHandler.execute({ rawKey });

      await this.assertCompanyAuthorization(request, apiKey);
      this.assertEnvironmentAuthorization(request, apiKey);

      // Expose the API-key principal only after the shared tenant/company/
      // environment policy has passed. ScopeGuard runs after this guard.
      request.apiKey = apiKey;
      request.user = { tenantId: apiKey.tenantId };

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        throw err;
      }
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
  private async assertCompanyAuthorization(
    request: {
      params?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
      originalUrl?: string;
      url?: string;
    },
    apiKey: ApiKey,
  ): Promise<void> {
    const companyId =
      this.readString(request.params?.companyId) ?? this.readString(request.body?.companyId);
    if (!companyId) return;

    const company = await this.prisma.company.findFirst({
      where: { id: companyId, status: 'ACTIVE' },
      select: { id: true, tenantId: true },
    });
    if (!company || company.tenantId !== apiKey.tenantId) {
      this.throwCompanyVisibilityNotFound(request);
    }

    const authorizedCompany = await this.prisma.company.findFirst({
      where: {
        id: companyId,
        tenantId: apiKey.tenantId,
        status: 'ACTIVE',
        authorizedApiKeys: { some: { apiKeyId: apiKey.id } },
      },
      select: { id: true },
    });
    if (!authorizedCompany) {
      // This company belongs to the caller's tenant but is not assigned to the
      // key. It is an authorization failure, rather than an identity lookup.
      throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
    }
  }

  private throwCompanyVisibilityNotFound(request: { originalUrl?: string; url?: string }): never {
    const path = request.originalUrl ?? request.url ?? '';
    if (
      path.includes('/identity-by-idempotency') ||
      path.includes('/identity-by-fiscal-evidence')
    ) {
      throw new NotFoundException({ code: 'FISCAL_IDENTITY_NOT_FOUND' });
    }
    throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
  }
  private assertEnvironmentAuthorization(
    request: {
      params?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
      originalUrl?: string;
      url?: string;
    },
    apiKey: ApiKey,
  ): void {
    const environment =
      this.readString(request.params?.environment) ?? this.readString(request.body?.environment);
    if (!environment) return;

    const expectedEnvironment = apiKey.environment === 'TEST' ? 'SANDBOX' : 'PRODUCTION';
    if (environment !== expectedEnvironment) {
      throw new ForbiddenException({
        code: 'API_KEY_ENVIRONMENT_NOT_AUTHORIZED',
        message: 'API key is not authorized for the requested fiscal environment.',
      });
    }
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
