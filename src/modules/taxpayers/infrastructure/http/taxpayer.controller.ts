import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { GetTaxpayerHandler } from '../../application/use-cases/get-taxpayer/get-taxpayer.handler';
import { GetTaxpayerParamsDto } from './dtos/get-taxpayer.params.dto';
import { TaxpayerResponseDto } from './dtos/taxpayer-response.dto';

@ApiTags('Taxpayers')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('taxpayers')
export class TaxpayerController {
  constructor(private readonly getTaxpayerHandler: GetTaxpayerHandler) {}

  @Get(':identification')
  @HttpCode(HttpStatus.OK)
  @Scopes('taxpayers:read')
  @ApiOperation({ summary: 'Look up a Costa Rica taxpayer by identification number' })
  @ApiOkResponse({ type: TaxpayerResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  @ApiForbiddenResponse({ description: 'API key missing taxpayers:read scope' })
  async getTaxpayer(@Param() params: GetTaxpayerParamsDto): Promise<TaxpayerResponseDto> {
    const result = await this.getTaxpayerHandler.execute(params.identification);
    return {
      identification: result.identification,
      name: result.name,
      found: result.found,
      identificationType: result.identificationType,
      taxRegime: result.taxRegime,
      taxSituation: result.taxSituation,
      economicActivities: result.economicActivities?.map((a) => ({
        code: a.code,
        description: a.description,
        status: a.status,
        type: a.type,
      })),
    };
  }
}
