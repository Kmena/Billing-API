import { Controller, Get, Param, ParseEnumPipe, Query, Request, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import {
  FiscalIdentityLookupOperation,
  FiscalIdentityLookupResponse,
  FiscalIdentityLookupService,
} from '../../application/fiscal-identity-lookup.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';
import { FiscalIdentityLookupQueryDto } from './dtos/fiscal-identity-lookup.dto';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Documents')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalIdentityLookupController {
  constructor(private readonly lookup: FiscalIdentityLookupService) {}

  @Get('identity-by-idempotency')
  @ApiOkResponse({ description: 'Verified pre-existing fiscal identity.' })
  async findByIdempotency(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Query() query: FiscalIdentityLookupQueryDto,
  ): Promise<FiscalIdentityLookupResponse> {
    return this.lookup.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      idempotencyKey: query.idempotencyKey,
      operation: query.operation as FiscalIdentityLookupOperation,
      requestHash: query.requestHash.toLowerCase(),
    });
  }
}
