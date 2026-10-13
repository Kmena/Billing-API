import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { ApiKeyRequest } from '../../../api/guards/api-key-auth.guard';
import { INVENTORI_FISCAL_PROFILE } from '../domain/inventori-fiscal-profile';

@Injectable()
export class IntegrationProfileGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    if (request.apiKey.integrationProfile !== INVENTORI_FISCAL_PROFILE) {
      throw new ForbiddenException({
        code: 'INTEGRATION_PROFILE_NOT_AUTHORIZED',
        message: 'The API key is not authorized for the requested integration profile.',
      });
    }
    return true;
  }
}
