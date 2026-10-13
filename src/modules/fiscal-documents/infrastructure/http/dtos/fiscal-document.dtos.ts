import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  Max,
  MaxLength,
  MinLength,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFiscalLineDto {
  @ApiProperty() @IsInt() @Min(1) lineNumber!: number;
  @ApiProperty() @Matches(/^\d{13}$/) cabysCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiProperty() @IsString() @IsNotEmpty() unitMeasure!: string;
  @ApiProperty() @Matches(/^\d+(\.\d{1,5})?$/) quantity!: string;
  @ApiProperty() @Matches(/^\d+(\.\d{1,5})?$/) unitPrice!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d+(\.\d{1,5})?$/) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}$/) discountCode?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  discountNature?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  discountOther?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d+(\.\d{1,5})?$/) taxAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}$/) taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}$/) taxRateCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d+(\.\d{1,5})?$/) taxRate?: string;
}

export class CreateFiscalDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() receiver?: Record<string, unknown>;
  @ApiProperty({ enum: ['CRC', 'USD'] }) @IsIn(['CRC', 'USD']) currency!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d+(\.\d{1,5})?$/) exchangeRate?: string;
  @ApiProperty() @Matches(/^\d{2}$/) saleCondition!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(99999) creditTermDays?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}$/) paymentMethod?: string;
  @ApiProperty({ type: [CreateFiscalLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFiscalLineDto)
  lines!: CreateFiscalLineDto[];
}

export class CreatePublicFiscalDocumentDto extends CreateFiscalDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @ApiProperty({ enum: ['PRODUCTION', 'SANDBOX'] })
  @IsIn(['PRODUCTION', 'SANDBOX'])
  environment!: 'PRODUCTION' | 'SANDBOX';
}

export class UpsertDefaultIssuancePointDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
}

export class ConfigureFiscalSequenceDto {
  @ApiProperty() @Matches(/^\d{1,10}$/) nextValue!: string;
}
