import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CabysSearchQueryDto {
  @ApiProperty({
    example: 'servicios',
    description: 'Search query — minimum 3 characters (per Hacienda API documentation, BR-010)',
    minLength: 3,
  })
  @IsString()
  @MinLength(3, { message: 'search query must be at least 3 characters (Hacienda minimum)' })
  search!: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Maximum results to return (1–50, default 10)',
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 10;
}
