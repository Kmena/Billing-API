import { Body, Controller, HttpCode, HttpStatus, Param, ParseEnumPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import {
  FiscalIdentityEvidenceLookupOperation,
  FiscalIdentityEvidenceLookupResponse,
  FiscalIdentityEvidenceLookupService,
} from '../../application/fiscal-identity-evidence-lookup.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';
import { FiscalIdentityEvidenceLookupDto } from './dtos/fiscal-identity-evidence-lookup.dto';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Documents')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalIdentityEvidenceLookupController {
  constructor(private readonly lookup: FiscalIdentityEvidenceLookupService) {}

  @Post('identity-by-fiscal-evidence')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Verified pre-existing fiscal identity using canonical fiscal evidence.' })
  async findByFiscalEvidence(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Body() body: FiscalIdentityEvidenceLookupDto,
  ): Promise<FiscalIdentityEvidenceLookupResponse> {
    return this.lookup.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      idempotencyKey: body.idempotencyKey,
      operation: body.operation as FiscalIdentityEvidenceLookupOperation,
      equivalenceContractVersion: body.equivalenceContractVersion,
      fiscalPayload: body.fiscalPayload,
    });
  }
}