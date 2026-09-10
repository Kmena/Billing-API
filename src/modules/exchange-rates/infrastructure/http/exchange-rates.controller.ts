import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { GetExchangeRateHandler } from '../../application/use-cases/get-exchange-rate/get-exchange-rate.handler';
import { GetExchangeRateQueryDto } from './dtos/get-exchange-rate.query.dto';
import { ExchangeRateResponseDto } from './dtos/exchange-rate-response.dto';

@ApiTags('Exchange Rates')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly getExchangeRateHandler: GetExchangeRateHandler) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Scopes('exchange-rates:read')
  @ApiOperation({
    summary: 'Get Costa Rica exchange rate from Hacienda',
    description:
      'Returns buy and sell rates for the specified currency (default: USD) and date (default: today UTC).',
  })
  @ApiOkResponse({ type: ExchangeRateResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  @ApiForbiddenResponse({ description: 'API key missing exchange-rates:read scope' })
  async getExchangeRate(@Query() query: GetExchangeRateQueryDto): Promise<ExchangeRateResponseDto> {
    const result = await this.getExchangeRateHandler.execute({
      currency: query.currency,
      date: query.date,
    });
    return {
      currency: result.currency,
      date: result.date,
      buyRate: result.buyRate,
      sellRate: result.sellRate,
    };
  }
}
