import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

enum IdentificationTypeEnum {
  FISICA = 'FISICA',
  JURIDICA = 'JURIDICA',
  DIMEX = 'DIMEX',
  NITE = 'NITE',
}

export class CreateCompanyRequestDto {
  @ApiProperty({ example: 'Acme Costa Rica S.A.' })
  @IsString()
  @Length(2, 255)
  legalName!: string;

  @ApiPropertyOptional({ example: 'Acme CR' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  tradeName?: string;

  @ApiProperty({
    enum: IdentificationTypeEnum,
    example: 'JURIDICA',
    description: 'Costa Rica identification type',
  })
  @IsEnum(IdentificationTypeEnum)
  identificationType!: string;

  @ApiProperty({
    example: '3101234567',
    description:
      'Identification number (FISICA: 9 digits, JURIDICA: 10 digits, DIMEX: 11-12 digits, NITE: 10 digits)',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'identificationNumber must contain only digits' })
  @Length(9, 12)
  identificationNumber!: string;
}
