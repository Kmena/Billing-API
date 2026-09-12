import { Body, Controller, Param, ParseEnumPipe, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import { FiscalDocumentService } from '../../application/fiscal-document.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../../domain/fiscal.constants';
import {
  ConfigureFiscalSequenceDto,
  UpsertDefaultIssuancePointDto,
} from './dtos/fiscal-document.dtos';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;
const documentTypes = { INVOICE: 'INVOICE', TICKET: 'TICKET' } as const;

@ApiTags('Fiscal Configuration')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies/:companyId/fiscal/:environment')
export class FiscalManagementController {
  constructor(private readonly fiscalDocumentService: FiscalDocumentService) {}

  @Put('issuance-points/default')
  async upsertDefaultIssuancePoint(
    @Request() request: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Body() body: UpsertDefaultIssuancePointDto,
  ) {
    return this.fiscalDocumentService.ensureDefaultIssuancePoint({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      name: body.name,
      actor: request.user.role,
    });
  }

  @Put('sequences/:documentType')
  async configureSequence(
    @Request() request: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Param('documentType', new ParseEnumPipe(documentTypes)) documentType: FiscalDocumentType,
    @Body() body: ConfigureFiscalSequenceDto,
  ) {
    return this.fiscalDocumentService.configureSequence({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      documentType,
      nextValue: body.nextValue,
      actor: request.user.role,
    });
  }
}
