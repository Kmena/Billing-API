import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CreateFiscalDocumentDto } from '../../../fiscal-documents/infrastructure/http/dtos/fiscal-document.dtos';

export enum FiscalOnboardingEnvironmentDto {
  SANDBOX = 'SANDBOX',
  PRODUCTION = 'PRODUCTION',
}

export enum FiscalOnboardingDocumentTypeDto {
  INVOICE = 'INVOICE',
  TICKET = 'TICKET',
}

export class ProvisionFiscalIssuerDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9:_-]+$/)
  externalCompanyKey!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty() @IsString() @Length(2, 255) legalName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) tradeName?: string;
  @ApiProperty({ enum: ['FISICA', 'JURIDICA', 'DIMEX', 'NITE'] })
  @IsEnum({ FISICA: 'FISICA', JURIDICA: 'JURIDICA', DIMEX: 'DIMEX', NITE: 'NITE' })
  identificationType!: 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE';
  @ApiProperty() @IsString() @Length(9, 20) identificationNumber!: string;
}

export class BootstrapFiscalIssuerDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  @Matches(/^[A-Za-z0-9:_-]+$/)
  externalCompanyKey!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  existingCompanyId?: string;

  @ApiProperty() @IsString() @Length(2, 255) legalName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) tradeName?: string;
  @ApiProperty({ enum: ['FISICA', 'JURIDICA', 'DIMEX', 'NITE'] })
  @IsEnum({ FISICA: 'FISICA', JURIDICA: 'JURIDICA', DIMEX: 'DIMEX', NITE: 'NITE' })
  identificationType!: 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE';
  @ApiProperty() @IsString() @Length(9, 20) identificationNumber!: string;
  @ApiProperty({ enum: FiscalOnboardingEnvironmentDto })
  @IsEnum(FiscalOnboardingEnvironmentDto)
  environment!: FiscalOnboardingEnvironmentDto;
}

export class UpdateFiscalIssuerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 255) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) tradeName?: string;
  @ApiPropertyOptional({ enum: ['FISICA', 'JURIDICA', 'DIMEX', 'NITE'] })
  @IsOptional()
  @IsEnum({ FISICA: 'FISICA', JURIDICA: 'JURIDICA', DIMEX: 'DIMEX', NITE: 'NITE' })
  identificationType?: 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(9, 20) identificationNumber?: string;
}

export class UpsertFiscalProfileV1Dto {
  @ApiProperty() @IsString() @Length(1, 20) economicActivityCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) proveedorSistemas?: string;
  @ApiProperty() @Matches(/^\d$/) province!: string;
  @ApiProperty() @Matches(/^\d{2}$/) canton!: string;
  @ApiProperty() @Matches(/^\d{2}$/) district!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) barrio?: string;
  @ApiProperty() @IsString() @Length(5, 250) otrasSenas!: string;
  @ApiProperty() @IsEmail() @Length(3, 160) email!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,3}$/) phoneCountryCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4,20}$/) phoneNumber?: string;
}

export class SetActivityEnabledV1Dto {
  @ApiProperty() @IsBoolean() billingEnabled!: boolean;
}

export class SetDefaultActivityV1Dto {
  @ApiProperty() @IsString() @Length(1, 20) code!: string;
}

export class ConfigureHaciendaCredentialsV1Dto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) username?: string;
  @ApiPropertyOptional({ format: 'password' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;
}

/**
 * Deliberately empty: the route binding supplies tenant, company and
 * environment, and ValidationPipe rejects attempts to override them.
 */
export class DisableHaciendaConnectionV1Dto {}

export class CreateFiscalBranchDto {
  @ApiProperty() @Matches(/^\d{3}$/) code!: string;
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
}

export class CreateFiscalTerminalDto {
  @ApiProperty() @Matches(/^\d{5}$/) code!: string;
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
}

export class SetFiscalResourceActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class SelectDefaultIssuancePointDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() terminalId!: string;
}

export class ConfigureInitialSequenceV1Dto {
  @ApiProperty({ minimum: 1, maximum: 9999999999 })
  @IsInt()
  @Min(1)
  @Max(9999999999)
  nextValue!: number;
}

export class FiscalTestInvoiceV1Dto extends CreateFiscalDocumentDto {
  @ApiProperty({ enum: ['HACIENDA_SANDBOX_SUBMISSION'] })
  @IsIn(['HACIENDA_SANDBOX_SUBMISSION'])
  mode!: 'HACIENDA_SANDBOX_SUBMISSION';

  @ApiProperty({ enum: ['CONSUME_SANDBOX_CONSECUTIVE'] })
  @IsIn(['CONSUME_SANDBOX_CONSECUTIVE'])
  confirmation!: 'CONSUME_SANDBOX_CONSECUTIVE';
}
