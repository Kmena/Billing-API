import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { ApiKeyAuthGuard } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { GetCabysItemHandler } from '../../application/use-cases/get-cabys-item/get-cabys-item.handler';
import { SearchCabysHandler } from '../../application/use-cases/search-cabys/search-cabys.handler';
import { CabysItemResponseDto, CabysSearchResponseDto } from './dtos/cabys-item-response.dto';
import { CabysSearchQueryDto } from './dtos/cabys-search-query.dto';

class CabysCodeParamDto {
  @Matches(/^\d{13}$/, { message: 'CABYS code must be exactly 13 digits' })
  code!: string;
}

@ApiTags('CABYS')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('cabys')
export class CabysController {
  constructor(
    private readonly getCabysItemHandler: GetCabysItemHandler,
    private readonly searchCabysHandler: SearchCabysHandler,
  ) {}

  // Declare @Get() (search) BEFORE @Get(':code') to avoid route collision
  @Get()
  @HttpCode(HttpStatus.OK)
  @Scopes('cabys:read')
  @ApiOperation({ summary: 'Search CABYS catalogue by description (minimum 3 characters)' })
  @ApiOkResponse({ type: CabysSearchResponseDto })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse({ description: 'Missing cabys:read scope' })
  async searchCabys(@Query() query: CabysSearchQueryDto): Promise<CabysSearchResponseDto> {
    const result = await this.searchCabysHandler.execute(query.search, query.limit);
    return { items: result.items, total: result.total };
  }

  @Get(':code')
  @HttpCode(HttpStatus.OK)
  @Scopes('cabys:read')
  @ApiOperation({ summary: 'Look up a CABYS item by 13-digit code' })
  @ApiOkResponse({ type: CabysItemResponseDto })
  @ApiNotFoundResponse({ description: 'CABYS code not found' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse({ description: 'Missing cabys:read scope' })
  async getCabysItem(@Param() params: CabysCodeParamDto): Promise<CabysItemResponseDto> {
    const item = await this.getCabysItemHandler.execute(params.code);
    return {
      code: item.code,
      description: item.description,
      taxRate: item.taxRate,
      category: item.category,
    };
  }
}
