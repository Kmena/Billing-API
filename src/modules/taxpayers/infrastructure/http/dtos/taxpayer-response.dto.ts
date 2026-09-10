import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TaxpayerActivityDto {
  @ApiProperty({ example: '9609.0', description: 'Economic activity code (NOT a CABYS code)' })
  code!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 'A', description: 'A=active, I=inactive' })
  status!: string;

  @ApiPropertyOptional({ example: 'P', description: 'P=principal, S=secondary' })
  type?: string;
}

export class TaxpayerResponseDto {
  @ApiProperty({ example: '3101234567' })
  identification!: string;

  @ApiProperty({ example: 'EMPRESA DEMO S.A.' })
  name!: string;

  @ApiProperty({ example: true })
  found!: boolean;

  @ApiPropertyOptional({ example: '02', description: '01=FISICA, 02=JURIDICA, 03=DIMEX, 04=NITE' })
  identificationType?: string;

  @ApiPropertyOptional({ example: 'Régimen general' })
  taxRegime?: string;

  @ApiPropertyOptional({ example: 'Inscrito' })
  taxSituation?: string;

  @ApiPropertyOptional({ type: [TaxpayerActivityDto] })
  economicActivities?: TaxpayerActivityDto[];
}
