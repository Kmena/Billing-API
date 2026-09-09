import { Inject, Injectable } from '@nestjs/common';
import { IApiKeyRepository, API_KEY_REPOSITORY } from '../../../domain/ports/api-key.repository';

export interface ListApiKeysQuery {
  readonly tenantId: string;
}

export interface ApiKeyListItem {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly keyPrefix: string;
  // BR-001: keyHash and secret are NEVER included in list responses
  readonly scopes: string[];
  readonly status: string;
  readonly expiresAt?: Date;
  readonly lastUsedAt?: Date;
  readonly createdAt: Date;
}

@Injectable()
export class ListApiKeysHandler {
  constructor(
    @Inject(API_KEY_REPOSITORY)
    private readonly apiKeyRepository: IApiKeyRepository,
  ) {}

  async execute(query: ListApiKeysQuery): Promise<ApiKeyListItem[]> {
    const apiKeys = await this.apiKeyRepository.findAllForTenant(query.tenantId);

    return apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      environment: key.environment,
      keyPrefix: key.keyPrefix,
      // BR-001: keyHash and secret explicitly excluded
      scopes: key.scopes,
      status: key.status,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
    }));
  }
}
