/**
 * FiscalDeliveriesController — F4 delivery history and manual resend API.
 *
 * F4 — TASK-013
 * List delivery history and manual resend for FE/TE documents.
 * Enforces authentication, tenant/company isolation, scope authorization.
 * Manual resend preserves immutable fiscal artifacts.
 * History is append-only.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsEnum } from 'class-validator';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { DeliveryRequestService } from '../../application/delivery/delivery-request.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

class RequestResendBodyDto {
  @IsEnum(['INITIAL_DOCUMENT', 'HACIENDA_RESPONSE'])
  kind!: 'INITIAL_DOCUMENT' | 'HACIENDA_RESPONSE';
}

@ApiTags('Fiscal Deliveries')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalDeliveriesController {
  constructor(private readonly deliveryRequestService: DeliveryRequestService) {}

  @Get('invoices/:id/deliveries')
  @Scopes('invoices:read')
  async listInvoiceDeliveries(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.deliveryRequestService.listDeliveries(request.user.tenantId, companyId, id);
  }

  @Get('tickets/:id/deliveries')
  @Scopes('tickets:read')
  async listTicketDeliveries(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.deliveryRequestService.listDeliveries(request.user.tenantId, companyId, id);
  }

  @Post('invoices/:id/deliveries')
  @Scopes('invoices:write')
  @HttpCode(202)
  async resendInvoiceDelivery(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
    @Body() body: RequestResendBodyDto,
  ) {
    return this.deliveryRequestService.requestResend({
      tenantId: request.user.tenantId,
      companyId,
      fiscalDocumentId: id,
      deliveryKind: body.kind,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }

  @Post('tickets/:id/deliveries')
  @Scopes('tickets:write')
  @HttpCode(202)
  async resendTicketDelivery(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
    @Body() body: RequestResendBodyDto,
  ) {
    return this.deliveryRequestService.requestResend({
      tenantId: request.user.tenantId,
      companyId,
      fiscalDocumentId: id,
      deliveryKind: body.kind,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }
}
