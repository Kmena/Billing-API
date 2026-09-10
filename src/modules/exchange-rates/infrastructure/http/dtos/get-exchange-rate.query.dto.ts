import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

// AUD-API-001: Hacienda only publishes USD (dolar) exchange rates.
// Accepting arbitrary ISO 4217 codes would silently return USD data labeled as a different currency.
const SUPPORTED_CURRENCIES = ['USD'] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export class GetExchangeRateQueryDto {
  @ApiPropertyOptional({
    example: 'USD',
    description: 'Currency code. Only USD is currently supported by Hacienda public API.',
    default: 'USD',
    enum: SUPPORTED_CURRENCIES,
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES, { message: 'Only USD is currently supported' })
  currency?: SupportedCurrency = 'USD';

  @ApiPropertyOptional({
    example: '2025-01-15',
    description: 'Date in YYYY-MM-DD format. Defaults to today (UTC) when not provided.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
