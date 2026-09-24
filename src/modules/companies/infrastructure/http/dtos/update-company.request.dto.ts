import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Identification type values must match the Prisma enum strings exactly.
 * The company domain and Prisma layer use these string values — NOT the
 * numeric Costa Rica codes ('01'|'02'|...) used in certificate OIDs.
 */
enum IdentificationTypeEnum {
  FISICA = 'FISICA',
  JURIDICA = 'JURIDICA',
  DIMEX = 'DIMEX',
  NITE = 'NITE',
}

export class UpdateCompanyRequestDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  tradeName?: string;

  @IsOptional()
  @IsEnum(IdentificationTypeEnum)
  identificationType?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9,12}$/, { message: 'identificationNumber must be 9–12 digits' })
  identificationNumber?: string;
}
