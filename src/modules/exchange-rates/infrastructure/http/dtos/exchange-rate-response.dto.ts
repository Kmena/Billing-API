import { ApiProperty } from '@nestjs/swagger';

export class ExchangeRateResponseDto {
  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '2025-01-15', description: 'Rate date in YYYY-MM-DD format' })
  date!: string;

  @ApiProperty({ example: 515.5, description: 'Buy rate (compra) in Costa Rican colones' })
  buyRate!: number;

  @ApiProperty({ example: 519.5, description: 'Sell rate (venta) in Costa Rican colones' })
  sellRate!: number;
}
