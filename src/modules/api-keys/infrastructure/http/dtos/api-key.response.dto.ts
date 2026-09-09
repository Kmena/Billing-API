import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * BR-001: secret field only appears in CreateApiKeyResponseDto (201 response).
 * ApiKeyListItemDto and ApiKeyResponseDto NEVER include secret or keyHash.
 */
export class CreateApiKeyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['LIVE', 'TEST'] })
  environment!: string;

  @ApiProperty({ description: 'Key prefix used for lookup (plaintext, 8 chars)' })
  keyPrefix!: string;

  @ApiProperty({
    description:
      'The full API key secret. Shown ONLY ONCE — store it securely. Cannot be retrieved again.',
    example: 'bk_live_a1b2c3d4_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  secret!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Used in GET /api-keys list — keyHash and secret are NEVER included.
 */
export class ApiKeyListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['LIVE', 'TEST'] })
  environment!: string;

  @ApiProperty()
  keyPrefix!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] })
  status!: string;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiPropertyOptional()
  lastUsedAt?: Date;

  @ApiProperty()
  createdAt!: Date;
}
