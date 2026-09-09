import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IApiKeyRepository, API_KEY_REPOSITORY } from '../../../domain/ports/api-key.repository';
import { ApiKeyInvalidException } from '../../../domain/exceptions/api-key-invalid.exception';
import { ApiKeyRevokedException } from '../../../domain/exceptions/api-key-revoked.exception';
import { ApiKeyExpiredException } from '../../../domain/exceptions/api-key-expired.exception';
import { ApiKey } from '../../../domain/entities/api-key.entity';

export interface ValidateApiKeyCommand {
  readonly rawKey: string; // Full key: bk_{env}_{prefix}_{secret}
}

export interface ValidateApiKeyResult {
  readonly apiKey: ApiKey;
}

/**
 * Validates an API key provided in the X-API-Key header.
 * Format: bk_{env}_{8-char-prefix}_{32-char-secret}
 * Lookup: by keyPrefix (plaintext, fast), verify with argon2id.
 */
@Injectable()
export class ValidateApiKeyHandler {
  constructor(
    @Inject(API_KEY_REPOSITORY)
    private readonly apiKeyRepository: IApiKeyRepository,
  ) {}

  async execute(command: ValidateApiKeyCommand): Promise<ValidateApiKeyResult> {
    const parts = command.rawKey.split('_');
    // Expected format: bk_{env}_{prefix}_{secret} → 4 parts
    if (parts.length !== 4 || parts[0] !== 'bk') {
      throw new ApiKeyInvalidException();
    }

    const [, , prefix, secret] = parts;

    if (!prefix || !secret) {
      throw new ApiKeyInvalidException();
    }

    const apiKey = await this.apiKeyRepository.findByPrefix(prefix);

    if (!apiKey) {
      throw new ApiKeyInvalidException();
    }

    // Check status before expensive hash verification
    if (apiKey.isRevoked) {
      throw new ApiKeyRevokedException();
    }

    if (apiKey.isExpired) {
      throw new ApiKeyExpiredException();
    }

    // Verify the full key against the stored argon2id hash
    const isValid = await argon2.verify(apiKey.keyHash, command.rawKey);
    if (!isValid) {
      throw new ApiKeyInvalidException();
    }

    // Record last used timestamp (fire-and-forget style — don't block auth)
    apiKey.recordUsage();
    this.apiKeyRepository.save(apiKey).catch(() => {
      // Non-critical — log internally but don't fail auth
    });

    return { apiKey };
  }
}
