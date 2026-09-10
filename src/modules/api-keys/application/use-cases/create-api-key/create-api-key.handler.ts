import { Inject, Injectable } from '@nestjs/common';
import { validateApiKeyScopes } from '../../../domain/value-objects/api-key-scope.vo';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { ApiKey, ApiKeyEnvironment } from '../../../domain/entities/api-key.entity';
import { IApiKeyRepository, API_KEY_REPOSITORY } from '../../../domain/ports/api-key.repository';

export interface CreateApiKeyCommand {
  readonly tenantId: string;
  readonly name: string;
  readonly environment: ApiKeyEnvironment;
  readonly scopes: string[];
  readonly expiresAt?: Date;
}

export interface CreateApiKeyResult {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly environment: string;
  readonly keyPrefix: string;
  // BR-001: secret is returned ONLY in the 201 response — never again
  readonly secret: string;
  readonly scopes: string[];
  readonly status: string;
  readonly expiresAt?: Date;
  readonly createdAt: Date;
}

/**
 * Generates the API key components.
 * Format: bk_{env}_{prefix8}_{secret32}
 * BR-001: prefix is stored plaintext for lookup, secret is hashed with argon2id.
 */
function generateApiKeyComponents(environment: ApiKeyEnvironment): {
  prefix: string;
  secret: string;
  fullKey: string;
} {
  const env = environment === 'LIVE' ? 'live' : 'test';
  const prefix = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secret = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const fullKey = `bk_${env}_${prefix}_${secret}`;
  return { prefix, secret, fullKey };
}

@Injectable()
export class CreateApiKeyHandler {
  constructor(
    @Inject(API_KEY_REPOSITORY)
    private readonly apiKeyRepository: IApiKeyRepository,
  ) {}

  async execute(command: CreateApiKeyCommand): Promise<CreateApiKeyResult> {
    // FR-012: Validate requested scopes against allowed list
    validateApiKeyScopes(command.scopes);

    const { prefix, fullKey } = generateApiKeyComponents(command.environment);

    // Hash the full key with argon2id — BR-001: one-way hash
    const keyHash = await argon2.hash(fullKey, { type: argon2.argon2id });

    const apiKey = ApiKey.create(
      uuidv4(),
      command.tenantId,
      command.name,
      command.environment,
      prefix,
      keyHash,
      command.scopes,
      command.expiresAt,
    );

    await this.apiKeyRepository.save(apiKey);

    return {
      id: apiKey.id,
      tenantId: apiKey.tenantId,
      name: apiKey.name,
      environment: apiKey.environment,
      keyPrefix: apiKey.keyPrefix,
      secret: fullKey, // BR-001: shown ONCE in 201 response — stored as hash only
      scopes: apiKey.scopes,
      status: apiKey.status,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }
}
