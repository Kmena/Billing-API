import { ApiKey } from '../entities/api-key.entity';

export interface IApiKeyRepository {
  findById(id: string): Promise<ApiKey | null>;
  findByPrefix(keyPrefix: string): Promise<ApiKey | null>;
  findAllForTenant(tenantId: string): Promise<ApiKey[]>;
  save(apiKey: ApiKey): Promise<void>;
}

export const API_KEY_REPOSITORY = Symbol('IApiKeyRepository');
