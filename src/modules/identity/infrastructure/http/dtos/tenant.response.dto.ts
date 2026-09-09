import { ApiProperty } from '@nestjs/swagger';

export class TenantResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'Acme Corporation' })
  name!: string;

  @ApiProperty({ example: 'acme-corporation' })
  slug!: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ example: 'TRIAL', enum: ['TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] })
  plan!: string;

  @ApiProperty({ example: '2025-01-15T10:30:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2025-01-15T10:30:00.000Z' })
  updatedAt?: Date;
}
