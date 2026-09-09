import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompanyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  legalName!: string;

  @ApiPropertyOptional()
  tradeName?: string;

  @ApiProperty({ enum: ['FISICA', 'JURIDICA', 'DIMEX', 'NITE'] })
  identificationType!: string;

  @ApiProperty()
  identificationNumber!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
