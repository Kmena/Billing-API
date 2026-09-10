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

  // Fase 1: Hacienda verification fields (nullable — DEC-003)
  @ApiPropertyOptional({ nullable: true })
  haciendaName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  haciendaVerifiedAt?: Date | null;

  @ApiPropertyOptional({
    enum: ['VERIFIED', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR', 'SKIPPED'],
    nullable: true,
    description:
      'Hacienda taxpayer verification outcome (DEC-003 — replaces deprecated warning field)',
  })
  haciendaVerificationStatus?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
