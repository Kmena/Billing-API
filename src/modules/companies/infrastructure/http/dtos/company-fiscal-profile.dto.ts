import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpsertCompanyFiscalProfileRequestDto {
  @ApiProperty({ example: '620210' })
  @Matches(/^\d{6}$/)
  economicActivityCode!: string;

  @ApiPropertyOptional({ example: '3101234567' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  proveedorSistemas?: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]$/)
  province!: string;

  @ApiProperty({ example: '01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(0[1-9]|[1-9][0-9])$/)
  canton!: string;

  @ApiProperty({ example: '01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(0[1-9]|[1-9][0-9])$/)
  district!: string;

  @ApiPropertyOptional({ example: 'Carmen' })
  @IsOptional()
  @IsString()
  @Length(5, 50)
  barrio?: string;

  @ApiProperty({ example: 'Avenida central, edificio fiscal, segundo piso' })
  @IsString()
  @IsNotEmpty()
  @Length(5, 250)
  otrasSenas!: string;

  @ApiProperty({ example: 'facturacion@example.co.cr' })
  @IsString()
  @Length(3, 160)
  @Matches(/^\s*\w+([-+.']\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*\s*$/)
  email!: string;

  @ApiPropertyOptional({ example: '506' })
  @IsOptional()
  @Matches(/^\d{1,3}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '22223333' })
  @IsOptional()
  @Matches(/^\d{3,20}$/)
  phoneNumber?: string;
}

export class CompanyFiscalProfileResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() economicActivityCode!: string;
  @ApiPropertyOptional() proveedorSistemas?: string | null;
  @ApiProperty() province!: string;
  @ApiProperty() canton!: string;
  @ApiProperty() district!: string;
  @ApiPropertyOptional() barrio?: string | null;
  @ApiProperty() otrasSenas!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional() phoneCountryCode?: string | null;
  @ApiPropertyOptional() phoneNumber?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
