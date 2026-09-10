import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GetTaxpayerParamsDto {
  @ApiProperty({
    example: '3101234567',
    description: 'Costa Rica taxpayer identification number (9–12 digits)',
  })
  @IsString()
  @Matches(/^\d{9,12}$/, { message: 'identification must be 9 to 12 digits' })
  identification!: string;
}
