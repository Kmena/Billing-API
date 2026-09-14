import {
  Body,
  Controller,
  Headers,
  Param,
  ParseEnumPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { FiscalDocumentService } from '../../application/fiscal-document.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../../domain/fiscal.constants';
import { CreateFiscalDocumentDto } from './dtos/fiscal-document.dtos';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Documents')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalDocumentsController {
  constructor(private readonly fiscalDocumentService: FiscalDocumentService) {}

  @Post('invoices')
  @Scopes('invoices:write')
  async createInvoice(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateFiscalDocumentDto,
  ) {
    return this.createDocument(request, companyId, environment, 'INVOICE', body, idempotencyKey);
  }

  @Post('tickets')
  @Scopes('tickets:write')
  async createTicket(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateFiscalDocumentDto,
  ) {
    return this.createDocument(request, companyId, environment, 'TICKET', body, idempotencyKey);
  }

  private async createDocument(
    request: ApiKeyRequest,
    companyId: string,
    environment: HaciendaEnvironment,
    type: FiscalDocumentType,
    body: CreateFiscalDocumentDto,
    idempotencyKey?: string,
  ) {
    return this.fiscalDocumentService.createDocument({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      type,
      receiver: body.receiver,
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      saleCondition: body.saleCondition,
      paymentMethod: body.paymentMethod,
      lines: body.lines,
      idempotencyKey,
      apiKeyId: request.apiKey.id,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }
}
