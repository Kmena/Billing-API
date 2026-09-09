import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';

enum ApiKeyEnvEnum {
  LIVE = 'LIVE',
  TEST = 'TEST',
}

export class CreateApiKeyRequestDto {
  @ApiProperty({ example: 'Production Integration Key' })
  @IsString()
  @Length(2, 255)
  name!: string;

  @ApiProperty({ enum: ApiKeyEnvEnum, example: 'LIVE' })
  @IsEnum(ApiKeyEnvEnum)
  environment!: string;

  @ApiProperty({
    type: [String],
    example: ['invoices:read', 'invoices:write'],
    description: 'Permission scopes for this API key',
  })
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Optional expiry date. If not set, the key never expires.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
