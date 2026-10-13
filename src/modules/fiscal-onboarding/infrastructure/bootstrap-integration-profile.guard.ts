import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { ApiKeyRequest } from '../../../api/guards/api-key-auth.guard';
import { INVENTORI_BOOTSTRAP_PROFILE } from '../domain/inventori-fiscal-profile';

@Injectable()
export class BootstrapIntegrationProfileGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    if (request.apiKey.integrationProfile !== INVENTORI_BOOTSTRAP_PROFILE) {
      throw new ForbiddenException({
        code: 'BOOTSTRAP_PROFILE_NOT_AUTHORIZED',
        message: 'The API key is not authorized for fiscal bootstrap.',
      });
    }
    return true;
  }
}
