import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateTenantRequestDto {
  @ApiProperty({
    description: 'Display name of the tenant organization',
    example: 'Acme Corporation',
    minLength: 2,
    maxLength: 255,
  })
  @IsString()
  @Length(2, 255)
  name!: string;

  @ApiPropertyOptional({
    description:
      'URL-safe slug identifier. Auto-generated from name if not provided. Immutable after creation.',
    example: 'acme-corporation',
    minLength: 3,
    maxLength: 100,
    pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
  })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{3}$/, {
    message: 'slug must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)',
  })
  slug?: string;
}
