import { Body, Controller, Get, Headers, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { FiscalDocumentService } from '../../application/fiscal-document.service';
import { FiscalDocumentType } from '../../domain/fiscal.constants';
import { CreatePublicFiscalDocumentDto } from './dtos/fiscal-document.dtos';

@ApiTags('Fiscal Documents')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller()
export class FiscalPublicDocumentsController {
  constructor(private readonly fiscalDocumentService: FiscalDocumentService) {}

  @Get('fiscal-documents/:id')
  async getDocument(@Request() request: ApiKeyRequest, @Param('id') id: string) {
    return this.fiscalDocumentService.getDocument({
      tenantId: request.user.tenantId,
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
    });
  }

  @Post('invoices')
  @Scopes('invoices:write')
  async createInvoice(
    @Request() request: ApiKeyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreatePublicFiscalDocumentDto,
  ) {
    return this.createDocument(request, 'INVOICE', body, idempotencyKey);
  }

  @Post('tickets')
  @Scopes('tickets:write')
  async createTicket(
    @Request() request: ApiKeyRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreatePublicFiscalDocumentDto,
  ) {
    return this.createDocument(request, 'TICKET', body, idempotencyKey);
  }

  private async createDocument(
    request: ApiKeyRequest,
    type: FiscalDocumentType,
    body: CreatePublicFiscalDocumentDto,
    idempotencyKey?: string,
  ) {
    return this.fiscalDocumentService.createDocument({
      tenantId: request.user.tenantId,
      companyId: body.companyId,
      environment: body.environment,
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
