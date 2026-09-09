import { Inject, Injectable } from '@nestjs/common';
import { IApiKeyRepository, API_KEY_REPOSITORY } from '../../../domain/ports/api-key.repository';
import { ApiKeyNotFoundException } from '../../../domain/exceptions/api-key-not-found.exception';
import { TenantContext } from '../../../../../infrastructure/tenant/tenant-context';

export interface RevokeApiKeyCommand {
  readonly id: string;
  readonly revokedBy: string; // userId of the actor performing the revocation
}

/**
 * Revokes an API key.
 * BR-005: Idempotent — revoking an already-revoked key does not throw.
 */
@Injectable()
export class RevokeApiKeyHandler {
  constructor(
    @Inject(API_KEY_REPOSITORY)
    private readonly apiKeyRepository: IApiKeyRepository,
  ) {}

  async execute(command: RevokeApiKeyCommand): Promise<void> {
    const tenantId = TenantContext.getTenantId();
    const apiKey = await this.apiKeyRepository.findById(command.id);

    // Tenant isolation: 404 if not found or belongs to different tenant
    if (!apiKey || apiKey.tenantId !== tenantId) {
      throw new ApiKeyNotFoundException(command.id);
    }

    // BR-005: Idempotent — revoke() handles already-revoked state
    apiKey.revoke(command.revokedBy);
    await this.apiKeyRepository.save(apiKey);
  }
}
