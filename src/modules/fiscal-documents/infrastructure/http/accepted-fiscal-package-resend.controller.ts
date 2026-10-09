import {
  Controller,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { AcceptedFiscalPackageResendService } from '../../application/delivery/accepted-fiscal-package-resend.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Deliveries')
@ApiHeader({ name: 'X-API-Key', required: true })
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('companies/:companyId/fiscal-documents/:environment/invoices')
export class AcceptedFiscalPackageResendController {
  constructor(private readonly acceptedPackageService: AcceptedFiscalPackageResendService) {}

  /** Empty request contract: all identity, recipient and artifact data are server-derived. */
  @Post(':fiscalDocumentId/accepted-package-resend')
  @Scopes('fiscal-deliveries:resend')
  @HttpCode(202)
  async resendAcceptedPackage(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
  ) {
    return this.acceptedPackageService.request({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      fiscalDocumentId,
      apiKeyId: request.apiKey.id,
      apiKeyPrefix: request.apiKey.keyPrefix,
    });
  }
}
