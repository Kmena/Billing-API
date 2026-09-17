/**
 * FiscalArtifactsController — F4 protected artifact list and download API.
 *
 * F4 — TASK-009
 * Enforces authentication, tenant/company isolation, scope authorization.
 * Never exposes internal storage keys.
 * Content-Disposition uses official filename convention (FR-027).
 * SHA-256 integrity verified before streaming (TASK-015).
 * Download audited (FR-022).
 */
import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import { Response as ExpressResponse } from 'express';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { FiscalArtifactService } from '../../application/artifacts/fiscal-artifact.service';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;

@ApiTags('Fiscal Artifacts')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/fiscal-documents/:environment')
export class FiscalArtifactsController {
  constructor(
    private readonly fiscalArtifactService: FiscalArtifactService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * List fiscal artifacts for an invoice.
   * Returns metadata only — no internal storage keys.
   */
  @Get('invoices/:id/artifacts')
  @Scopes('invoices:read')
  async listInvoiceArtifacts(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.fiscalArtifactService.listArtifacts(request.user.tenantId, companyId, id);
  }

  /**
   * List fiscal artifacts for a ticket.
   * Returns metadata only — no internal storage keys.
   */
  @Get('tickets/:id/artifacts')
  @Scopes('tickets:read')
  async listTicketArtifacts(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') id: string,
  ) {
    return this.fiscalArtifactService.listArtifacts(request.user.tenantId, companyId, id);
  }

  /**
   * Download a fiscal artifact by artifact ID.
   * Streams artifact bytes after integrity verification.
   * Content-Disposition uses official filename (FR-027).
   * Audited (FR-022).
   * Never exposes internal storage key.
   */
  @Get('invoices/:id/artifacts/:artifactId/download')
  @Scopes('invoices:read')
  async downloadInvoiceArtifact(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') _id: string,
    @Param('artifactId') artifactId: string,
    @Response() res: ExpressResponse,
  ) {
    return this.streamArtifact(request, companyId, artifactId, res);
  }

  /**
   * Download a fiscal artifact for a ticket.
   */
  @Get('tickets/:id/artifacts/:artifactId/download')
  @Scopes('tickets:read')
  async downloadTicketArtifact(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) _environment: HaciendaEnvironment,
    @Param('id') _id: string,
    @Param('artifactId') artifactId: string,
    @Response() res: ExpressResponse,
  ) {
    return this.streamArtifact(request, companyId, artifactId, res);
  }

  private async streamArtifact(
    request: ApiKeyRequest,
    companyId: string,
    artifactId: string,
    res: ExpressResponse,
  ): Promise<void> {
    const download = await this.fiscalArtifactService.downloadArtifact(
      request.user.tenantId,
      companyId,
      artifactId,
    );

    const contentDisposition = this.fiscalArtifactService.buildContentDisposition(
      download.externalFilename,
    );

    // Audit the download event
    this.auditService.record({
      tenantId: request.user.tenantId,
      companyId,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
      action: 'fiscal-artifact.download',
      eventClass: EventClass.FISCAL_AUDIT,
      resource: `FiscalArtifact:${artifactId}`,
      metadata: {
        artifactId,
        filename: download.externalFilename,
        sizeBytes: download.sizeBytes,
      },
    });

    res
      .set('Content-Type', download.contentType)
      .set('Content-Disposition', contentDisposition)
      .set('Content-Length', String(download.sizeBytes))
      .set('Cache-Control', 'no-store')
      .send(download.bytes);
  }
}
