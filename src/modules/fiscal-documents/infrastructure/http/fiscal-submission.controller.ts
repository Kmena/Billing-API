import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';
import { SubmitFiscalDocumentService } from '../../application/submission/submit-fiscal-document.service';
import { GetFiscalSubmissionStatusService } from '../../application/submission/get-fiscal-submission-status.service';
import { RequestFiscalSubmissionReconciliationService } from '../../application/submission/request-fiscal-submission-reconciliation.service';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Submission')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalSubmissionController {
  constructor(
    private readonly submitFiscalDocumentService: SubmitFiscalDocumentService,
    private readonly getStatusService: GetFiscalSubmissionStatusService,
    private readonly reconcileService: RequestFiscalSubmissionReconciliationService,
  ) {}

  @Post('invoices/:id/submit')
  @Scopes('invoices:write')
  @HttpCode(202)
  @ApiOkResponse({ description: 'Fiscal invoice submission was requested.' })
  async submitInvoice(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.submitFiscalDocumentService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'INVOICE',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }

  @Post('tickets/:id/submit')
  @Scopes('tickets:write')
  @HttpCode(202)
  @ApiOkResponse({ description: 'Fiscal ticket submission was requested.' })
  async submitTicket(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.submitFiscalDocumentService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'TICKET',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }

  @Get('invoices/:id/submission')
  @Scopes('invoices:write')
  async getInvoiceSubmission(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.getStatusService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'INVOICE',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
    });
  }

  @Get('tickets/:id/submission')
  @Scopes('tickets:write')
  async getTicketSubmission(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.getStatusService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'TICKET',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
    });
  }

  @Post('invoices/:id/submission/reconcile')
  @Scopes('invoices:write')
  @HttpCode(202)
  async reconcileInvoiceSubmission(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.reconcileService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'INVOICE',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
    });
  }

  @Post('tickets/:id/submission/reconcile')
  @Scopes('tickets:write')
  @HttpCode(202)
  async reconcileTicketSubmission(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.reconcileService.execute({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType: 'TICKET',
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
    });
  }
}
